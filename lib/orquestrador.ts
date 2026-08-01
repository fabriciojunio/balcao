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
import type {
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
}

export interface ResultadoAtendimento {
  readonly conversaId: string;
  readonly estado: EstadoConversa;
  readonly respostas: readonly string[];
  readonly escalou: boolean;
  readonly motivoEscalonamento?: MotivoEscalonamento;
  readonly ignorada?: "duplicada" | "agente_desligado" | "atendimento_humano";
}

const TEXTO_ESCALONAMENTO = "Vou chamar um vendedor para te ajudar, só um instante.";

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
  await deps.conversas.registrarMensagem(conversa.id, "entrada", entrada.texto, entrada.idExterno);

  const log = deps.log.filho({ conversaId: conversa.id, estado: conversa.estado });

  if (!deps.agenteAtivo()) {
    await escalar(conversa, "pedido_do_cliente", "agente desligado no painel", deps);
    return ok({
      conversaId: conversa.id,
      estado: "atendimento_humano",
      respostas: [],
      escalou: true,
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
      await enviar(conversa, decisao.texto, deps);
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
    await enviar(conversa, TEXTO_ESCALONAMENTO, deps);
    respostas.push(TEXTO_ESCALONAMENTO);
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
): Promise<void> {
  const envio = await deps.canal.enviar(conversa.telefone, texto);
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
