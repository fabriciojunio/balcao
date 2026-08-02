import { contextoDe, type ContextoAuditoria } from "./auditor/index.js";
import {
  agenteEstaMudo,
  motivoParaEscalar,
  transicionar,
  type EstadoConversa,
  type EventoConversa,
  type MotivoEscalonamento,
} from "./dominio/conversa.js";
import type { PoliticaPreco, TabelaParcelamento } from "./dominio/preco.js";
import type { RegraTroca } from "./dominio/troca.js";
import { executarFerramenta, type DependenciasFerramentas } from "./ferramentas/executor.js";
import type { Logger } from "./log.js";
import { montarMensagens, montarPrompt, versaoDoPrompt } from "./modelo/prompt.js";
import { contextoComValores, eventoDaResposta, processarResposta } from "./pipeline.js";
import { avaliarEscopo } from "./dominio/escopo.js";
import { triar } from "./dominio/triagem.js";
import { mesclarDefeitos } from "./dominio/visao.js";
import type {
  AnalisadorDeImagem,
  Canal,
  ClienteModelo,
  ConversaRegistro,
  Relogio,
  RepositorioAuditoria,
  RepositorioAvaliacoes,
  RepositorioConversas,
  RepositorioEscalonamentos,
  RepositorioEstoque,
  RepositorioLeads,
  RepositorioPropostas,
  RepositorioTabelaTroca,
  Transcritor,
} from "./portas.js";
import { erro, ok, type Result } from "./result.js";
import type { ConfigTenant } from "./tenant/schema.js";

export interface DependenciasOrquestrador {
  readonly config: ConfigTenant;
  readonly politica: PoliticaPreco;
  readonly tabelaParcelamento: TabelaParcelamento;
  readonly regraTroca: RegraTroca;
  readonly contextoBase: ContextoAuditoria;

  readonly conversas: RepositorioConversas;
  readonly estoque: RepositorioEstoque;
  readonly tabelaTroca: RepositorioTabelaTroca;
  readonly avaliacoes: RepositorioAvaliacoes;
  readonly propostas: RepositorioPropostas;
  readonly leads: RepositorioLeads;
  readonly escalonamentos: RepositorioEscalonamentos;
  readonly auditoria: RepositorioAuditoria;

  readonly modelo: ClienteModelo;
  readonly canal: Canal;
  /** Sem transcritor, áudio vira passagem para humano. */
  readonly transcritor?: Transcritor;
  /** Sem leitor de imagem, foto vira passagem para humano. */
  readonly visao?: AnalisadorDeImagem;
  readonly relogio: Relogio;
  readonly log: Logger;

  /** Interruptor geral do painel. */
  readonly agenteAtivo: () => boolean;
  readonly maxTentativas?: number;
  readonly maxPassos?: number;
}

export interface MensagemRecebida {
  readonly telefone: string;
  readonly texto: string;
  readonly idExterno?: string;
  readonly nome?: string;
  readonly tipo?: "texto" | "audio" | "imagem" | "outro";
  readonly midiaId?: string;
}

export interface ResultadoAtendimento {
  readonly conversaId: string;
  readonly estado: EstadoConversa;
  readonly respostas: readonly string[];
  readonly escalou: boolean;
  readonly motivoEscalonamento?: MotivoEscalonamento;
  readonly ignorada?: "duplicada" | "agente_desligado" | "atendimento_humano" | "opt_out";
}

export async function atender(
  entrada: MensagemRecebida,
  deps: DependenciasOrquestrador,
): Promise<Result<ResultadoAtendimento>> {
  const maxTentativas = deps.maxTentativas ?? deps.config.escalonamento.max_falhas_auditor;
  const maxPassos = deps.maxPassos ?? 5;

  if (entrada.idExterno !== undefined && (await deps.conversas.mensagemJaProcessada(entrada.idExterno))) {
    return ok({ conversaId: "", estado: "recepcao", respostas: [], escalou: false, ignorada: "duplicada" });
  }

  let conversa = await deps.conversas.abrirOuRecuperar(entrada.telefone, entrada.nome);
  const log = deps.log.filho({ conversaId: conversa.id, estado: conversa.estado });

  const ehTexto = (entrada.tipo ?? "texto") === "texto";
  const agenteVaiAgir = deps.agenteAtivo() && !agenteEstaMudo(conversa.estado);

  // Transcrever áudio e ler foto custa dinheiro e tempo. Com o agente
  // desligado ou com um vendedor no comando, nem começa.
  const midia: MidiaResolvida =
    ehTexto || agenteVaiAgir
      ? await resolverMidia(entrada, conversa, deps, log)
      : { texto: rotuloDeMidia(entrada.tipo ?? "outro") };

  // Pedido de saída vale sempre: com o agente desligado, com vendedor no
  // comando, em qualquer estado. É revogação de consentimento, não é
  // preferência de atendimento.
  const triagem = triar(midia.texto);
  await deps.conversas.registrarMensagem(conversa.id, "entrada", midia.texto, entrada.idExterno);
  if (midia.memoria !== undefined) {
    conversa = await deps.conversas.atualizar(conversa.id, {
      memoria: { ...conversa.memoria, ...midia.memoria },
    });
  }

  if (triagem.tipo === "opt_out") {
    await deps.leads.registrar({ conversaId: conversa.id, interesse: "opt-out", aceitaContato: false });
    await deps.auditoria.registrar("opt_out", { trecho: triagem.trecho }, conversa.id);
    await enviar(conversa, deps.config.textos.despedida_opt_out, deps);
    conversa = await deps.conversas.atualizar(conversa.id, { estado: "encerrada" });
    return ok({
      conversaId: conversa.id,
      estado: "encerrada",
      respostas: [deps.config.textos.despedida_opt_out],
      escalou: false,
      ignorada: "opt_out",
    });
  }

  // Pedido ilícito nunca passa pelo modelo e sempre fica registrado, mesmo
  // com um vendedor no comando: o dono precisa saber que foi pedido.
  const escopo = avaliarEscopo(midia.texto);
  if (escopo.tipo === "ilicito") {
    await deps.auditoria.registrar("fora_de_escopo_ilicito", { termo: escopo.termo }, conversa.id);

    // Com o agente desligado ou com vendedor no comando, o registro fica mas
    // o sistema não responde: quem fala ali é a loja.
    if (!agenteVaiAgir) {
      return ok({
        conversaId: conversa.id,
        estado: conversa.estado,
        respostas: [],
        escalou: false,
        ignorada: deps.agenteAtivo() ? "atendimento_humano" : "agente_desligado",
      });
    }

    await enviar(conversa, deps.config.textos.assunto_recusado, deps);
    conversa = await escalar(conversa, "fora_de_escopo", `pedido recusado: ${escopo.termo}`, deps);
    return ok({
      conversaId: conversa.id,
      estado: conversa.estado,
      respostas: [deps.config.textos.assunto_recusado],
      escalou: true,
      motivoEscalonamento: "fora_de_escopo",
    });
  }

  if (!deps.agenteAtivo()) {
    // Escala uma vez só. Sem isso, cada mensagem com o agente desligado
    // criaria um item novo na fila e o painel viraria uma parede de repetição.
    const jaEstaComHumano = agenteEstaMudo(conversa.estado);
    if (!jaEstaComHumano) {
      conversa = await escalar(conversa, "pedido_do_cliente", "agente desligado no painel", deps);
    }
    return ok({
      conversaId: conversa.id,
      estado: conversa.estado,
      respostas: [],
      escalou: !jaEstaComHumano,
      ignorada: "agente_desligado",
    });
  }

  if (agenteEstaMudo(conversa.estado)) {
    return ok({
      conversaId: conversa.id,
      estado: conversa.estado,
      respostas: [],
      escalou: false,
      ignorada: "atendimento_humano",
    });
  }

  const respostas: string[] = [];

  if (escopo.tipo === "fora_do_assunto") {
    const desvios = Number(conversa.memoria.desvios_de_assunto ?? "0") + 1;
    conversa = await deps.conversas.atualizar(conversa.id, {
      memoria: { ...conversa.memoria, desvios_de_assunto: String(desvios) },
    });
    await enviar(conversa, deps.config.textos.fora_do_assunto, deps);

    // Insistiu duas vezes fora do assunto: quem resolve isso é um vendedor.
    if (desvios >= 2) {
      conversa = await escalar(conversa, "fora_de_escopo", `fora do assunto: ${escopo.termo}`, deps);
      return ok({
        conversaId: conversa.id,
        estado: conversa.estado,
        respostas: [deps.config.textos.fora_do_assunto],
        escalou: true,
        motivoEscalonamento: "fora_de_escopo",
      });
    }

    return ok({
      conversaId: conversa.id,
      estado: conversa.estado,
      respostas: [deps.config.textos.fora_do_assunto],
      escalou: false,
    });
  }

  if (midia.escalar !== undefined || triagem.tipo === "escalar") {
    const motivo = midia.escalar ?? (triagem.tipo === "escalar" ? triagem.motivo : "fora_de_escopo");
    const aviso = midia.aviso ?? deps.config.textos.chamando_vendedor;
    await enviar(conversa, aviso, deps);
    conversa = await escalar(conversa, motivo, midia.texto.slice(0, 200), deps);
    return ok({
      conversaId: conversa.id,
      estado: conversa.estado,
      respostas: [aviso],
      escalou: true,
      motivoEscalonamento: motivo,
    });
  }

  if (midia.aviso !== undefined) {
    await enviar(conversa, midia.aviso, deps);
    respostas.push(midia.aviso);
  }

  // Aviso de atendimento automatizado: exigência de conformidade, texto fixo
  // da loja, não passa pelo modelo nem pelo auditor.
  const historicoInicial = await deps.conversas.historico(conversa.id, 50);
  if (!historicoInicial.some((m) => m.direcao === "saida")) {
    const aviso = deps.config.conformidade.aviso_inicial;
    await enviar(conversa, aviso, deps);
    respostas.push(aviso);
  }

  let contexto = deps.contextoBase;
  let valores: Record<string, string> = {};
  const retornosFerramenta: string[] = [];
  let tentativa = 1;
  let escalonamentoPendente: MotivoEscalonamento | null = null;
  let anexo: string | undefined;

  for (let passo = 0; passo < maxPassos; passo++) {
    const historico = await deps.conversas.historico(conversa.id, 20);
    const mensagens = montarMensagens({
      config: deps.config,
      estado: conversa.estado,
      memoria: conversa.memoria,
      historico,
      retornosFerramenta,
    });

    const saida = await deps.modelo.gerar({
      mensagens,
      temperatura: deps.config.modelo.temperatura,
      tetoTokens: deps.config.modelo.teto_tokens_conversa,
    });

    if (!saida.ok) {
      log.error("modelo.falhou", { motivo: saida.error.message });
      escalonamentoPendente = "fora_de_escopo";
      break;
    }

    const evento = eventoDaResposta(saida.value.conteudo);
    if (evento !== null) {
      conversa = await aplicarEvento(conversa, evento, deps);
    }

    const decisao = processarResposta({
      bruto: saida.value.conteudo,
      estado: conversa.estado,
      valores,
      contexto,
      tentativa,
      maxTentativas,
    });

    if (decisao.tipo === "enviar") {
      await enviar(conversa, decisao.texto, deps, anexo);
      respostas.push(decisao.texto);
      break;
    }

    if (decisao.tipo === "repetir") {
      tentativa += 1;
      conversa = await deps.conversas.atualizar(conversa.id, {
        falhasAuditor: conversa.falhasAuditor + 1,
      });
      await deps.auditoria.registrar(
        "bloqueio_auditor",
        { motivo: decisao.motivo, violacoes: decisao.violacoes },
        conversa.id,
      );
      log.warn("auditor.bloqueou", { motivo: decisao.motivo });
      continue;
    }

    if (decisao.tipo === "escalar") {
      escalonamentoPendente = normalizarMotivo(decisao.motivo);
      break;
    }

    const resultado = await executarFerramenta(decisao.ferramenta, decisao.argumentos, {
      conversa,
      deps: dependenciasFerramentas(deps, saida.value.versao),
    });

    if (!resultado.ok) {
      log.warn("ferramenta.argumentos_invalidos", {
        ferramenta: decisao.ferramenta,
        motivo: resultado.error.message,
      });
      retornosFerramenta.push(JSON.stringify({ erro: "argumentos_invalidos" }));
      tentativa += 1;
      continue;
    }

    const r = resultado.value;
    await deps.auditoria.registrar("ferramenta", { nome: decisao.ferramenta }, conversa.id);

    retornosFerramenta.push(r.textoParaModelo);
    valores = { ...valores, ...r.valores };
    contexto = contextoComValores(contexto, r.rodada);

    if (r.memoria !== undefined || r.incrementaRodadaNegociacao === true) {
      conversa = await deps.conversas.atualizar(conversa.id, {
        ...(r.memoria === undefined ? {} : { memoria: { ...conversa.memoria, ...r.memoria } }),
        ...(r.incrementaRodadaNegociacao === true
          ? { rodadasNegociacao: conversa.rodadasNegociacao + 1 }
          : {}),
      });
    }
    if (r.evento !== undefined) conversa = await aplicarEvento(conversa, r.evento, deps);
    if (r.escalar !== undefined) escalonamentoPendente = r.escalar;
    if (r.anexo !== undefined) anexo = r.anexo.url;
  }

  const motivoAutomatico = motivoParaEscalar(
    {
      falhasAuditor: conversa.falhasAuditor,
      rodadasNegociacao: conversa.rodadasNegociacao,
      clienteFrustrado: false,
      clientePediuHumano: false,
      avaliacaoHumanaNecessaria: escalonamentoPendente === "avaliacao_humana_necessaria",
      valorAcimaAlcada: escalonamentoPendente === "valor_acima_alcada",
    },
    {
      maxFalhasAuditor: deps.config.escalonamento.max_falhas_auditor,
      maxRodadasNegociacao: deps.config.escalonamento.max_rodadas_negociacao,
    },
  );

  const motivo = escalonamentoPendente ?? motivoAutomatico;
  if (motivo !== null) {
    await enviar(conversa, deps.config.textos.chamando_vendedor, deps);
    respostas.push(deps.config.textos.chamando_vendedor);
    conversa = await escalar(conversa, motivo, `estado ${conversa.estado}`, deps);
    return {
      ...ok({
        conversaId: conversa.id,
        estado: conversa.estado,
        respostas,
        escalou: true,
        motivoEscalonamento: motivo,
      }),
    };
  }

  return ok({ conversaId: conversa.id, estado: conversa.estado, respostas, escalou: false });
}

function dependenciasFerramentas(
  deps: DependenciasOrquestrador,
  versaoModelo: string,
): DependenciasFerramentas {
  return {
    config: deps.config,
    politica: deps.politica,
    tabelaParcelamento: deps.tabelaParcelamento,
    regraTroca: deps.regraTroca,
    estoque: deps.estoque,
    tabelaTroca: deps.tabelaTroca,
    avaliacoes: deps.avaliacoes,
    propostas: deps.propostas,
    leads: deps.leads,
    relogio: deps.relogio,
    versaoModelo,
    versaoPrompt: versaoDoPrompt(
      montarPrompt({ config: deps.config, estado: "negociacao", memoria: {} }),
    ),
  };
}

async function aplicarEvento(
  conversa: ConversaRegistro,
  evento: EventoConversa,
  deps: DependenciasOrquestrador,
): Promise<ConversaRegistro> {
  const novo = transicionar(conversa.estado, evento);
  if (novo === conversa.estado) return conversa;
  return deps.conversas.atualizar(conversa.id, { estado: novo });
}

async function enviar(
  conversa: ConversaRegistro,
  texto: string,
  deps: DependenciasOrquestrador,
  anexo?: string,
): Promise<void> {
  // A legenda da imagem é o mesmo texto que passou pelo auditor.
  const envio =
    anexo !== undefined && deps.canal.enviarImagem !== undefined
      ? await deps.canal.enviarImagem(conversa.telefone, anexo, texto)
      : await deps.canal.enviar(conversa.telefone, texto);
  const idExterno = envio.ok ? envio.value.idExterno : undefined;
  await deps.conversas.registrarMensagem(conversa.id, "saida", texto, idExterno);
  if (!envio.ok) deps.log.error("canal.falha_no_envio", { motivo: envio.error.message });
}

async function escalar(
  conversa: ConversaRegistro,
  motivo: MotivoEscalonamento,
  resumo: string,
  deps: DependenciasOrquestrador,
): Promise<ConversaRegistro> {
  await deps.escalonamentos.criar(conversa.id, motivo, resumo);
  await deps.auditoria.registrar("escalonamento", { motivo, resumo }, conversa.id);
  deps.log.info("conversa.escalada", { motivo });
  return deps.conversas.atualizar(conversa.id, { estado: "atendimento_humano" });
}

const MOTIVOS: readonly MotivoEscalonamento[] = [
  "frustracao",
  "fora_de_escopo",
  "falha_auditor",
  "valor_acima_alcada",
  "pedido_do_cliente",
  "avaliacao_humana_necessaria",
];

function normalizarMotivo(motivo: string): MotivoEscalonamento {
  return MOTIVOS.includes(motivo as MotivoEscalonamento)
    ? (motivo as MotivoEscalonamento)
    : "fora_de_escopo";
}

/** Contexto de auditoria vazio, para quem monta o orquestrador sem tenant. */
export const contextoVazio: ContextoAuditoria = contextoDe({});

export { erro };

interface MidiaResolvida {
  readonly texto: string;
  readonly aviso?: string;
  readonly escalar?: MotivoEscalonamento;
  readonly memoria?: Record<string, string>;
}

/**
 * Áudio vira texto e foto vira pré-avaliação. Sem transcritor ou sem leitor
 * de imagem, a mensagem vai para um vendedor em vez de ser descartada: no
 * Brasil, boa parte do que o cliente manda para empresa é áudio.
 */
async function resolverMidia(
  entrada: MensagemRecebida,
  conversa: ConversaRegistro,
  deps: DependenciasOrquestrador,
  log: Logger,
): Promise<MidiaResolvida> {
  const tipo = entrada.tipo ?? "texto";
  if (tipo === "texto") return { texto: entrada.texto };

  const { midiaId } = entrada;
  const baixar = deps.canal.baixarMidia;

  if (tipo === "outro" || midiaId === undefined || baixar === undefined) {
    return {
      texto: entrada.texto === "" ? "(o cliente enviou um arquivo)" : entrada.texto,
      aviso: deps.config.textos.midia_recebida,
      escalar: "fora_de_escopo",
    };
  }

  const arquivo = await baixar(midiaId);
  if (!arquivo.ok) {
    log.warn("midia.download_falhou", { tipo, motivo: arquivo.error.message });
    return { texto: entrada.texto, aviso: deps.config.textos.midia_recebida, escalar: "fora_de_escopo" };
  }

  if (tipo === "audio") {
    if (deps.transcritor === undefined) {
      return { texto: "(áudio)", aviso: deps.config.textos.audio_sem_transcricao, escalar: "fora_de_escopo" };
    }
    const transcricao = await deps.transcritor.transcrever(arquivo.value);
    if (!transcricao.ok) {
      log.warn("midia.transcricao_falhou", { motivo: transcricao.error.message });
      return { texto: "(áudio)", aviso: deps.config.textos.audio_sem_transcricao, escalar: "fora_de_escopo" };
    }
    await deps.auditoria.registrar("audio_transcrito", { caracteres: transcricao.value.length }, conversa.id);
    return { texto: transcricao.value };
  }

  // Foto: entra como pré-avaliação e só pode confirmar ou piorar o estado.
  if (!deps.config.troca.aceita_foto || deps.visao === undefined) {
    return {
      texto: entrada.texto === "" ? "(o cliente enviou uma foto do aparelho)" : entrada.texto,
      aviso: deps.config.textos.midia_recebida,
      escalar: "avaliacao_humana_necessaria",
    };
  }

  const leitura = await deps.visao.analisar(arquivo.value);
  if (!leitura.ok) {
    log.warn("midia.leitura_falhou", { motivo: leitura.error.message });
    return {
      texto: entrada.texto === "" ? "(o cliente enviou uma foto do aparelho)" : entrada.texto,
      aviso: deps.config.textos.midia_recebida,
      escalar: "avaliacao_humana_necessaria",
    };
  }

  const mescla = mesclarDefeitos([], leitura.value, deps.config.troca.confianca_minima_foto);
  await deps.auditoria.registrar(
    "foto_analisada",
    { defeitos: mescla.acrescentadosPelaFoto, inconclusiva: leitura.value.inconclusiva },
    conversa.id,
  );

  return {
    texto: entrada.texto === "" ? "(o cliente enviou uma foto do aparelho)" : entrada.texto,
    aviso: deps.config.textos.foto_em_avaliacao,
    memoria: {
      defeitos_foto: mescla.acrescentadosPelaFoto.join(","),
      foto_inconclusiva: leitura.value.inconclusiva ? "1" : "0",
    },
  };
}

/** Como a mensagem de mídia aparece no histórico quando não é processada. */
function rotuloDeMidia(tipo: string): string {
  if (tipo === "audio") return "(áudio do cliente)";
  if (tipo === "imagem") return "(foto do cliente)";
  return "(arquivo do cliente)";
}
