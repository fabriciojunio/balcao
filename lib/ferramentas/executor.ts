import { formatarBRL, formatarPercentual, reais, type Centavos } from "../dinheiro.js";
import type { EventoConversa, MotivoEscalonamento } from "../dominio/conversa.js";
import {
  avaliarDesconto,
  opcoesDeParcelamento,
  simularParcelamento,
  type PoliticaPreco,
  type TabelaParcelamento,
} from "../dominio/preco.js";
import { montarPropostaTroca, valoresDaProposta } from "../dominio/proposta.js";
import { mesclarDefeitos, type LeituraDeImagem } from "../dominio/visao.js";
import {
  CHECKLIST_PADRAO,
  cotarUsado,
  defeitosDeRespostas,
  estadoDeRespostas,
  interpretarResposta,
  proximaPergunta,
  type CotacaoAceita,
  type RegraTroca,
} from "../dominio/troca.js";
import type {
  ConversaRegistro,
  ProdutoEmEstoque,
  Relogio,
  RepositorioAvaliacoes,
  RepositorioEstoque,
  RepositorioLeads,
  RepositorioPropostas,
  RepositorioTabelaTroca,
} from "../portas.js";
import type { ValoresDaRodada } from "../pipeline.js";
import { erro, ok, type Result } from "../result.js";
import type { ConfigTenant } from "../tenant/schema.js";
import { CATALOGO, type NomeFerramenta } from "./catalogo.js";

export interface DependenciasFerramentas {
  readonly config: ConfigTenant;
  readonly politica: PoliticaPreco;
  readonly tabelaParcelamento: TabelaParcelamento;
  readonly regraTroca: RegraTroca;
  readonly estoque: RepositorioEstoque;
  readonly tabelaTroca: RepositorioTabelaTroca;
  readonly avaliacoes: RepositorioAvaliacoes;
  readonly propostas: RepositorioPropostas;
  readonly leads: RepositorioLeads;
  readonly relogio: Relogio;
  readonly versaoModelo: string;
  readonly versaoPrompt: string;
}

export interface ResultadoFerramenta {
  /** Resumo objetivo devolvido ao modelo, sempre em JSON. */
  readonly textoParaModelo: string;
  /** Marcadores que o modelo pode usar no texto. */
  readonly valores: Record<string, string>;
  /** O que o auditor passa a aceitar nesta rodada. */
  readonly rodada: ValoresDaRodada;
  readonly memoria?: Record<string, string>;
  readonly evento?: EventoConversa;
  readonly escalar?: MotivoEscalonamento;
  readonly incrementaRodadaNegociacao?: boolean;
  /** Imagem que acompanha a mensagem aprovada, como a foto do produto. */
  readonly anexo?: { readonly url: string };
}

const DIGITOS = /\d+/g;

/** Números que a própria ferramenta escreveu e o auditor pode liberar. */
function numerosNoTexto(texto: string): number[] {
  return (texto.match(DIGITOS) ?? []).map(Number).filter(Number.isFinite);
}

function dataLegivel(data: Date, fuso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(data)
    .replace(", ", " às ");
}

function json(valor: unknown): string {
  return JSON.stringify(valor);
}

function estoqueVelho(produto: ProdutoEmEstoque, deps: DependenciasFerramentas): boolean {
  const idadeSegundos = (deps.relogio.agora().getTime() - produto.sincronizadoEm.getTime()) / 1000;
  return idadeSegundos > deps.config.estoque.idade_maxima_dado_segundos;
}

export interface ContextoFerramenta {
  readonly conversa: ConversaRegistro;
  readonly deps: DependenciasFerramentas;
}

type Manipulador = (argumentos: unknown, ctx: ContextoFerramenta) => Promise<Result<ResultadoFerramenta>>;

// ---------------------------------------------------------------------------

const consultarEstoque: Manipulador = async (argumentos, { deps }) => {
  const a = argumentos as { termo: string; memoria_gb?: number; cor?: string; preco_maximo_reais?: number };
  const encontrados = await deps.estoque.buscar({
    termo: a.termo,
    ...(a.memoria_gb === undefined ? {} : { memoriaGb: a.memoria_gb }),
    ...(a.cor === undefined ? {} : { cor: a.cor }),
    ...(a.preco_maximo_reais === undefined ? {} : { precoMaximo: reais(a.preco_maximo_reais) }),
  });

  const disponiveis = encontrados.filter((p) => p.quantidade > 0);
  if (disponiveis.some((p) => estoqueVelho(p, deps))) {
    return ok({
      textoParaModelo: json({ erro: "estoque_desatualizado" }),
      valores: {},
      rodada: {},
      escalar: "fora_de_escopo",
    });
  }

  if (disponiveis.length === 0) {
    return ok({
      textoParaModelo: json({ encontrados: 0, aviso: "sem unidade disponível para este termo" }),
      valores: {},
      rodada: {},
    });
  }

  const topo = disponiveis.slice(0, 3);
  const valores: Record<string, string> = {};
  const monetarios: Centavos[] = [];
  const numeros: number[] = [];

  topo.forEach((p, i) => {
    valores[`produto_${i + 1}`] = p.descricao;
    valores[`preco_${i + 1}`] = formatarBRL(p.precoTabela);
    monetarios.push(p.precoTabela);
    numeros.push(...numerosNoTexto(p.descricao));
  });
  valores.produto = topo[0]!.descricao;
  valores.preco_avista = formatarBRL(topo[0]!.precoTabela);

  return ok({
    textoParaModelo: json({
      encontrados: topo.map((p, i) => ({
        marcador_produto: `produto_${i + 1}`,
        marcador_preco: `preco_${i + 1}`,
        cor: p.cor ?? null,
        memoria_gb: p.memoriaGb ?? null,
      })),
    }),
    valores,
    rodada: {
      monetarios,
      numeros,
      // Escassez só é dizível quando o estoque comprova. Fora disso é
      // publicidade enganosa (art. 37 do CDC).
      ...(topo[0]!.quantidade === 1 ? { afirmacoes: ["ultima_unidade"] } : {}),
    },
    memoria: { produto_id: topo[0]!.id, produto_descricao: topo[0]!.descricao },
    evento: topo.length === 1 ? "produto_escolhido" : undefined,
  });
};

const detalharProduto: Manipulador = async (argumentos, { deps }) => {
  const { produto_id } = argumentos as { produto_id: string };
  const produto = await deps.estoque.porId(produto_id);
  if (produto === null || produto.quantidade <= 0) {
    return ok({ textoParaModelo: json({ erro: "produto_indisponivel" }), valores: {}, rodada: {} });
  }

  const garantia = produto.garantiaMeses ?? 12;
  return ok({
    textoParaModelo: json({
      marcador_produto: "produto",
      marcador_preco: "preco_avista",
      marcador_garantia: "garantia",
      unidades: produto.quantidade,
    }),
    valores: {
      produto: produto.descricao,
      preco_avista: formatarBRL(produto.precoTabela),
      garantia: `${garantia} meses`,
    },
    rodada: {
      monetarios: [produto.precoTabela],
      numeros: [garantia, produto.quantidade, ...numerosNoTexto(produto.descricao)],
      ...(produto.quantidade === 1 ? { afirmacoes: ["ultima_unidade"] } : {}),
    },
    memoria: { produto_id: produto.id, produto_descricao: produto.descricao },
    evento: "produto_escolhido",
  });
};

async function valorEmFoco(
  argumentoReais: number | undefined,
  ctx: ContextoFerramenta,
): Promise<Centavos | null> {
  if (argumentoReais !== undefined) return reais(argumentoReais);
  const produtoId = ctx.conversa.memoria.produto_id;
  if (produtoId === undefined) return null;
  const produto = await ctx.deps.estoque.porId(produtoId);
  return produto?.precoTabela ?? null;
}

const simularParcelamentoFerramenta: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { valor_reais?: number; parcelas?: number };
  const valor = await valorEmFoco(a.valor_reais, ctx);
  if (valor === null) {
    return ok({ textoParaModelo: json({ erro: "sem_valor_para_simular" }), valores: {}, rodada: {} });
  }

  const opcoes =
    a.parcelas === undefined
      ? opcoesDeParcelamento(valor, ctx.deps.tabelaParcelamento)
      : [];

  if (a.parcelas !== undefined) {
    const r = simularParcelamento(valor, a.parcelas, ctx.deps.tabelaParcelamento);
    if (!r.ok) {
      return ok({
        textoParaModelo: json({
          erro: "parcelamento_indisponivel",
          parcelas_disponiveis: r.error.detalhes?.parcelasDisponiveis ?? [],
        }),
        valores: {},
        rodada: {},
      });
    }
    opcoes.push(r.value);
  }

  const escolhida = opcoes[opcoes.length - 1]!;
  const maior = opcoes.reduce((a1, b) => (b.parcelas > a1.parcelas ? b : a1), escolhida);

  return ok({
    textoParaModelo: json({
      marcador_parcelas: "parcelas",
      marcador_valor_parcela: "valor_parcela",
      marcador_total: "total",
    }),
    valores: {
      parcelas: `${maior.parcelas}x`,
      valor_parcela: formatarBRL(maior.valorParcela),
      total: formatarBRL(maior.total),
    },
    rodada: {
      monetarios: opcoes.flatMap((o) => [o.total, o.valorParcela, o.primeiraParcela]),
      parcelas: opcoes.map((o) => o.parcelas),
    },
  });
};

const avaliarDescontoFerramenta: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { produto_id?: string; valor_pedido_reais?: number };
  const produtoId = a.produto_id ?? ctx.conversa.memoria.produto_id;
  if (produtoId === undefined) {
    return ok({ textoParaModelo: json({ erro: "sem_produto_em_foco" }), valores: {}, rodada: {} });
  }

  const produto = await ctx.deps.estoque.porId(produtoId);
  if (produto === null) {
    return ok({ textoParaModelo: json({ erro: "produto_indisponivel" }), valores: {}, rodada: {} });
  }

  const resultado = avaliarDesconto({
    produto,
    politica: ctx.deps.politica,
    rodada: ctx.conversa.rodadasNegociacao,
    ...(a.valor_pedido_reais === undefined ? {} : { valorPedido: reais(a.valor_pedido_reais) }),
  });

  return ok({
    textoParaModelo: json({
      situacao: resultado.situacao,
      motivo: resultado.motivo,
      marcador_preco: "preco_final",
      marcador_desconto: "desconto",
      exige_aprovacao_humana: resultado.exigeAprovacaoHumana,
    }),
    valores: {
      preco_final: formatarBRL(resultado.precoFinal),
      desconto: formatarBRL(resultado.descontoValor),
      desconto_percentual: formatarPercentual(resultado.descontoPercentual),
      produto: produto.descricao,
    },
    rodada: {
      monetarios: [resultado.precoFinal, resultado.descontoValor, resultado.precoTabela],
      percentuais: [resultado.descontoPercentual],
      numeros: numerosNoTexto(produto.descricao),
    },
    memoria: { produto_id: produto.id, preco_negociado: String(resultado.precoFinal) },
    incrementaRodadaNegociacao: true,
    ...(resultado.exigeAprovacaoHumana ? { escalar: "valor_acima_alcada" as const } : {}),
  });
};

const iniciarAvaliacaoUsado: Manipulador = async (argumentos, ctx) => {
  const { modelo_declarado } = argumentos as { modelo_declarado: string };
  const tabelado = await ctx.deps.tabelaTroca.buscar(modelo_declarado);
  if (tabelado === null) {
    return ok({
      textoParaModelo: json({ erro: "modelo_sem_tabela", modelo: modelo_declarado }),
      valores: {},
      rodada: {},
      escalar: "avaliacao_humana_necessaria",
    });
  }

  const avaliacao = await ctx.deps.avaliacoes.criar({
    conversaId: ctx.conversa.id,
    modeloDeclarado: tabelado.modelo,
    valorBase: tabelado.valorBase,
  });
  const pergunta = proximaPergunta([]);

  return ok({
    textoParaModelo: json({
      marcador_pergunta: "pergunta",
      total_perguntas: CHECKLIST_PADRAO.length,
      chave_atual: pergunta?.chave ?? null,
    }),
    valores: { pergunta: pergunta?.pergunta ?? "" },
    rodada: {},
    memoria: { avaliacao_id: avaliacao.id, usado_modelo: tabelado.modelo },
  });
};

const cotarUsadoFerramenta: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as {
    avaliacao_id?: string;
    respostas: Record<string, string>;
    resposta_livre?: string;
  };
  const avaliacaoId = a.avaliacao_id ?? ctx.conversa.memoria.avaliacao_id;
  if (avaliacaoId === undefined) {
    return ok({ textoParaModelo: json({ erro: "avaliacao_nao_iniciada" }), valores: {}, rodada: {} });
  }

  const avaliacao = await ctx.deps.avaliacoes.porId(avaliacaoId);
  if (avaliacao === null) {
    return ok({ textoParaModelo: json({ erro: "avaliacao_nao_encontrada" }), valores: {}, rodada: {} });
  }

  const respostas: Record<string, string> = { ...avaliacao.respostas, ...a.respostas };

  // A resposta livre do cliente é traduzida aqui, contra a pergunta pendente:
  // decidir a opção é regra de negócio, não é palpite do modelo.
  const emAberto = proximaPergunta(Object.keys(respostas));
  if (a.resposta_livre !== undefined && emAberto !== null) {
    const opcao = interpretarResposta(emAberto, a.resposta_livre);
    if (opcao !== null) respostas[emAberto.chave] = opcao;
  }

  const pendente = proximaPergunta(Object.keys(respostas));
  if (pendente !== null) {
    await ctx.deps.avaliacoes.concluir(avaliacaoId, { respostas });
    return ok({
      textoParaModelo: json({ marcador_pergunta: "pergunta", chave_atual: pendente.chave, faltam: true }),
      valores: { pergunta: pendente.pergunta },
      rodada: {},
    });
  }

  const declarados = defeitosDeRespostas(respostas);
  const leituraDaFoto = lerFotoDaMemoria(ctx);
  const mescla =
    leituraDaFoto === null
      ? null
      : mesclarDefeitos(declarados, leituraDaFoto, ctx.deps.config.troca.confianca_minima_foto);

  const cotacao = cotarUsado({
    modelo: avaliacao.modeloDeclarado,
    valorBase: avaliacao.valorBase,
    estadoDeclarado: estadoDeRespostas(respostas),
    defeitos: mescla === null ? declarados : mescla.defeitos,
    agora: ctx.deps.relogio.agora(),
    regra: ctx.deps.regraTroca,
  });

  if (cotacao.recusado) {
    await ctx.deps.avaliacoes.concluir(avaliacaoId, { respostas, recusado: true });
    return ok({
      textoParaModelo: json({ recusado: true, motivo: cotacao.motivo }),
      valores: {},
      rodada: {},
      evento: "aparelho_recusado",
    });
  }

  const exigeHumano = cotacao.exigeAvaliacaoHumana || (mescla?.exigeAvaliacaoHumana ?? false);
  await ctx.deps.avaliacoes.concluir(avaliacaoId, {
    respostas,
    valorApurado: cotacao.valor,
    validadeAte: cotacao.validadeAte,
    exigeAvaliacaoHumana: exigeHumano,
    recusado: false,
  });

  const validade = dataLegivel(cotacao.validadeAte, ctx.deps.config.tenant.fuso);
  const troca = ctx.deps.config.troca;

  return ok({
    textoParaModelo: json({
      marcador_faixa_min: "faixa_min",
      marcador_faixa_max: "faixa_max",
      marcador_validade: "validade",
      marcador_ressalva: "ressalva",
      obrigatorio: `a mensagem precisa conter a palavra ${troca.termo_ressalva}`,
      considerou_foto: mescla !== null,
      acrescentado_pela_foto: mescla?.acrescentadosPelaFoto ?? [],
      ressalvas: cotacao.ressalvas,
    }),
    valores: {
      faixa_min: formatarBRL(cotacao.faixaMin),
      faixa_max: formatarBRL(cotacao.faixaMax),
      validade: validade,
      usado: avaliacao.modeloDeclarado,
      ressalva: troca.texto_ressalva,
    },
    rodada: {
      monetarios: [cotacao.faixaMin, cotacao.faixaMax, cotacao.valor],
      numeros: [...numerosNoTexto(validade), ...numerosNoTexto(avaliacao.modeloDeclarado)],
      // Valor de troca sem a palavra "pré-avaliação" não sai daqui.
      ressalvaExigida: troca.termo_ressalva,
    },
    memoria: { cotacao_id: avaliacaoId, cotacao_valor: String(cotacao.valor) },
    evento: "avaliacao_concluida",
    ...(exigeHumano ? { escalar: "avaliacao_humana_necessaria" as const } : {}),
  });
};

/** Defeitos que a foto do cliente acusou, guardados nas anotações da conversa. */
function lerFotoDaMemoria(ctx: ContextoFerramenta): LeituraDeImagem | null {
  const { defeitos_foto, foto_inconclusiva } = ctx.conversa.memoria;
  if (defeitos_foto === undefined && foto_inconclusiva === undefined) return null;

  return {
    defeitos: (defeitos_foto ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "")
      .map((chave) => ({ chave, confianca: 1 })),
    inconclusiva: foto_inconclusiva === "1",
  };
}

const montarPropostaTrocaFerramenta: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { produto_id?: string; cotacao_id?: string; parcelas?: number };
  const produtoId = a.produto_id ?? ctx.conversa.memoria.produto_id;
  const cotacaoId = a.cotacao_id ?? ctx.conversa.memoria.cotacao_id;
  if (produtoId === undefined || cotacaoId === undefined) {
    return ok({ textoParaModelo: json({ erro: "faltam_produto_ou_cotacao" }), valores: {}, rodada: {} });
  }

  const [produto, avaliacao] = await Promise.all([
    ctx.deps.estoque.porId(produtoId),
    ctx.deps.avaliacoes.porId(cotacaoId),
  ]);
  if (produto === null || avaliacao === null || avaliacao.valorApurado === null || avaliacao.validadeAte === null) {
    return ok({ textoParaModelo: json({ erro: "cotacao_incompleta" }), valores: {}, rodada: {} });
  }

  const cotacao: CotacaoAceita = {
    recusado: false,
    modelo: avaliacao.modeloDeclarado,
    valorBase: avaliacao.valorBase,
    ajustesAplicados: [],
    ajusteTotal: 0,
    valor: avaliacao.valorApurado,
    faixaMin: avaliacao.valorApurado,
    faixaMax: avaliacao.valorApurado,
    validadeAte: avaliacao.validadeAte,
    exigeConferenciaFisica: ctx.deps.regraTroca.exigeConferenciaFisica,
    exigeAvaliacaoHumana: avaliacao.exigeAvaliacaoHumana,
    ressalvas: [],
  };

  const negociado = ctx.conversa.memoria.preco_negociado;
  const proposta = montarPropostaTroca({
    produto,
    politica: ctx.deps.politica,
    precoNegociado: negociado === undefined ? produto.precoTabela : Number(negociado),
    cotacao,
    tabelaParcelamento: ctx.deps.tabelaParcelamento,
    agora: ctx.deps.relogio.agora(),
    ...(a.parcelas === undefined ? {} : { parcelas: a.parcelas }),
  });

  if (!proposta.ok) {
    return ok({
      textoParaModelo: json({ erro: "proposta_invalida", motivo: proposta.error.message }),
      valores: {},
      rodada: {},
      escalar: "fora_de_escopo",
    });
  }

  const p = proposta.value;
  const registro = await ctx.deps.propostas.criar({
    conversaId: ctx.conversa.id,
    precoProduto: p.precoProduto,
    valorAparelhoUsado: p.valorAparelhoUsado,
    diferencaAPagar: p.diferencaAPagar,
    exigeAprovacaoHumana: p.exigeAprovacaoHumana,
    situacao: p.exigeAprovacaoHumana ? "aguardando_aprovacao" : "enviada",
    validadeAte: p.validadeAte,
    versaoModelo: ctx.deps.versaoModelo,
    versaoPrompt: ctx.deps.versaoPrompt,
  });

  const validade = dataLegivel(p.validadeAte, ctx.deps.config.tenant.fuso);
  const valores: Record<string, string> = {
    preco_produto: formatarBRL(p.precoProduto),
    valor_usado: formatarBRL(p.valorAparelhoUsado),
    diferenca: formatarBRL(p.diferencaAPagar),
    validade,
    produto: p.descricao,
  };
  if (p.parcelamento !== null) {
    valores.parcelas = `${p.parcelamento.parcelas}x`;
    valores.valor_parcela = formatarBRL(p.parcelamento.valorParcela);
  }

  valores.ressalva = ctx.deps.config.troca.texto_ressalva;

  return ok({
    textoParaModelo: json({
      proposta_id: registro.id,
      exige_aprovacao_humana: p.exigeAprovacaoHumana,
      marcador_ressalva: "ressalva",
      obrigatorio: `a mensagem precisa conter a palavra ${ctx.deps.config.troca.termo_ressalva}`,
      ressalvas: p.ressalvas,
      marcadores: Object.keys(valores),
    }),
    valores,
    rodada: {
      monetarios: valoresDaProposta(p),
      ...(p.parcelamento === null ? {} : { parcelas: [p.parcelamento.parcelas] }),
      numeros: [...numerosNoTexto(validade), ...numerosNoTexto(p.descricao)],
      ressalvaExigida: ctx.deps.config.troca.termo_ressalva,
    },
    memoria: { proposta_id: registro.id },
    ...(produto.fotoUrl === undefined ? {} : { anexo: { url: produto.fotoUrl } }),
    ...(p.exigeAprovacaoHumana ? { escalar: "valor_acima_alcada" as const } : {}),
  });
};

const reservarProduto: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { produto_id?: string };
  const produtoId = a.produto_id ?? ctx.conversa.memoria.produto_id;
  if (produtoId === undefined) {
    return ok({ textoParaModelo: json({ erro: "sem_produto_em_foco" }), valores: {}, rodada: {} });
  }

  const minutos = ctx.deps.config.estoque.reserva_minutos;
  const expiraEm = new Date(ctx.deps.relogio.agora().getTime() + minutos * 60_000);
  const reserva = await ctx.deps.estoque.reservar(produtoId, ctx.conversa.id, expiraEm);

  if (!reserva.ok) {
    return ok({
      textoParaModelo: json({ erro: "sem_unidade_disponivel" }),
      valores: {},
      rodada: {},
    });
  }

  return ok({
    textoParaModelo: json({ reservado: true, marcador_prazo: "prazo_reserva" }),
    valores: { prazo_reserva: `${minutos} minutos` },
    rodada: { numeros: [minutos] },
    evento: "acordo",
  });
};

const registrarLead: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { nome?: string; interesse: string; aceita_contato?: boolean };
  await ctx.deps.leads.registrar({
    conversaId: ctx.conversa.id,
    interesse: a.interesse,
    aceitaContato: a.aceita_contato ?? false,
    ...(a.nome === undefined ? {} : { nome: a.nome }),
  });
  return ok({ textoParaModelo: json({ registrado: true }), valores: {}, rodada: {} });
};

const escalarHumano: Manipulador = async (argumentos) => {
  const a = argumentos as { motivo: MotivoEscalonamento; resumo: string };
  return ok({
    textoParaModelo: json({ escalado: true }),
    valores: {},
    rodada: {},
    escalar: a.motivo,
  });
};

const agendarVisita: Manipulador = async (argumentos, ctx) => {
  const a = argumentos as { data: string; periodo: "manha" | "tarde" };
  const horario = ctx.deps.config.tenant.horario;
  const dia = new Date(`${a.data}T12:00:00`);
  const diaSemana = dia.getDay();
  const aberto =
    diaSemana === 0 ? horario.domingo !== null : diaSemana === 6 ? horario.sabado !== null : horario.seg_sex !== null;

  if (!aberto) {
    return ok({ textoParaModelo: json({ erro: "loja_fechada_nesse_dia" }), valores: {}, rodada: {} });
  }

  const legivel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: ctx.deps.config.tenant.fuso,
    day: "2-digit",
    month: "2-digit",
  }).format(dia);

  return ok({
    textoParaModelo: json({ agendado: true, marcador_data: "data_visita" }),
    valores: { data_visita: `${legivel} de ${a.periodo === "manha" ? "manhã" : "tarde"}` },
    rodada: { numeros: numerosNoTexto(legivel) },
  });
};

const MANIPULADORES: Readonly<Record<NomeFerramenta, Manipulador>> = {
  consultar_estoque: consultarEstoque,
  detalhar_produto: detalharProduto,
  simular_parcelamento: simularParcelamentoFerramenta,
  avaliar_desconto: avaliarDescontoFerramenta,
  iniciar_avaliacao_usado: iniciarAvaliacaoUsado,
  cotar_usado: cotarUsadoFerramenta,
  montar_proposta_troca: montarPropostaTrocaFerramenta,
  reservar_produto: reservarProduto,
  registrar_lead: registrarLead,
  escalar_humano: escalarHumano,
  agendar_visita: agendarVisita,
};

/** Valida os argumentos contra o catálogo e executa a ferramenta. */
export async function executarFerramenta(
  nome: NomeFerramenta,
  argumentos: unknown,
  ctx: ContextoFerramenta,
): Promise<Result<ResultadoFerramenta>> {
  const parsed = CATALOGO[nome].entrada.safeParse(argumentos ?? {});
  if (!parsed.success) {
    return erro("VALIDACAO", `Argumentos inválidos para ${nome}.`, {
      problemas: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  const resultado = await MANIPULADORES[nome](parsed.data, ctx);
  if (!resultado.ok) return resultado;

  return ok({ ...resultado.value, textoParaModelo: comMarcadores(resultado.value) });
}

/** O retorno sempre anuncia quais marcadores o modelo pode usar. */
function comMarcadores(resultado: ResultadoFerramenta): string {
  const corpo = JSON.parse(resultado.textoParaModelo) as Record<string, unknown>;
  return json({ ...corpo, marcadores: Object.keys(resultado.valores) });
}
