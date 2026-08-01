// Máquina de estados da conversa. Cada estado limita quais ferramentas o
// modelo enxerga: quanto menor o leque, menor a chance de comportamento
// estranho, e mais fácil descobrir onde a conversa estava quando algo deu
// errado.

import type { NomeFerramenta } from "../ferramentas/catalogo.js";

export const ESTADOS = [
  "recepcao",
  "descoberta",
  "apresentacao",
  "avaliacao_usado",
  "negociacao",
  "fechamento",
  "atendimento_humano",
  "retomada",
  "encerrada",
] as const;

export type EstadoConversa = (typeof ESTADOS)[number];

export const EVENTOS = [
  "intencao_identificada",
  "produto_escolhido",
  "pediu_desconto",
  "ofereceu_aparelho",
  "avaliacao_concluida",
  "aparelho_recusado",
  "acordo",
  "impasse",
  "escalar",
  "humano_devolveu",
  "silencio",
  "cliente_voltou",
  "encerrar",
] as const;

export type EventoConversa = (typeof EVENTOS)[number];

export const FERRAMENTAS_POR_ESTADO: Readonly<Record<EstadoConversa, readonly NomeFerramenta[]>> = {
  recepcao: [],
  descoberta: ["consultar_estoque"],
  apresentacao: ["consultar_estoque", "detalhar_produto", "simular_parcelamento"],
  avaliacao_usado: ["iniciar_avaliacao_usado", "cotar_usado"],
  negociacao: ["avaliar_desconto", "simular_parcelamento", "montar_proposta_troca"],
  fechamento: ["reservar_produto", "registrar_lead", "agendar_visita"],
  atendimento_humano: [],
  retomada: ["registrar_lead"],
  encerrada: [],
};

/** Escalar e encerrar valem de qualquer estado, sem exceção. */
const FERRAMENTAS_SEMPRE: readonly NomeFerramenta[] = ["escalar_humano"];

const TRANSICOES: Readonly<Record<EstadoConversa, Partial<Record<EventoConversa, EstadoConversa>>>> = {
  recepcao: {
    intencao_identificada: "descoberta",
    ofereceu_aparelho: "avaliacao_usado",
    escalar: "atendimento_humano",
    encerrar: "encerrada",
  },
  descoberta: {
    produto_escolhido: "apresentacao",
    ofereceu_aparelho: "avaliacao_usado",
    pediu_desconto: "negociacao",
    escalar: "atendimento_humano",
    silencio: "retomada",
    encerrar: "encerrada",
  },
  apresentacao: {
    pediu_desconto: "negociacao",
    ofereceu_aparelho: "avaliacao_usado",
    acordo: "fechamento",
    escalar: "atendimento_humano",
    silencio: "retomada",
    encerrar: "encerrada",
  },
  avaliacao_usado: {
    avaliacao_concluida: "negociacao",
    aparelho_recusado: "apresentacao",
    escalar: "atendimento_humano",
    silencio: "retomada",
    encerrar: "encerrada",
  },
  negociacao: {
    acordo: "fechamento",
    impasse: "atendimento_humano",
    ofereceu_aparelho: "avaliacao_usado",
    escalar: "atendimento_humano",
    silencio: "retomada",
    encerrar: "encerrada",
  },
  fechamento: {
    escalar: "atendimento_humano",
    encerrar: "encerrada",
    silencio: "retomada",
  },
  atendimento_humano: {
    humano_devolveu: "descoberta",
    encerrar: "encerrada",
  },
  retomada: {
    cliente_voltou: "descoberta",
    escalar: "atendimento_humano",
    encerrar: "encerrada",
  },
  encerrada: {
    cliente_voltou: "recepcao",
  },
};

/**
 * Aplica um evento ao estado atual. Evento que não faz sentido no estado é
 * ignorado de propósito: a conversa fica onde está, e o log registra.
 */
export function transicionar(estado: EstadoConversa, evento: EventoConversa): EstadoConversa {
  return TRANSICOES[estado][evento] ?? estado;
}

export function transicaoValida(estado: EstadoConversa, evento: EventoConversa): boolean {
  return TRANSICOES[estado][evento] !== undefined;
}

/** A IA pode usar esta ferramenta agora? */
export function podeUsar(estado: EstadoConversa, ferramenta: NomeFerramenta): boolean {
  if (FERRAMENTAS_SEMPRE.includes(ferramenta)) return true;
  return FERRAMENTAS_POR_ESTADO[estado].includes(ferramenta);
}

export function ferramentasDisponiveis(estado: EstadoConversa): NomeFerramenta[] {
  return [...FERRAMENTAS_POR_ESTADO[estado], ...FERRAMENTAS_SEMPRE];
}

/** Estados em que o agente não fala: quem responde é o vendedor. */
export function agenteEstaMudo(estado: EstadoConversa): boolean {
  return estado === "atendimento_humano" || estado === "encerrada";
}

export interface SituacaoEscalonamento {
  readonly falhasAuditor: number;
  readonly rodadasNegociacao: number;
  readonly clienteFrustrado: boolean;
  readonly clientePediuHumano: boolean;
  readonly avaliacaoHumanaNecessaria: boolean;
  readonly valorAcimaAlcada: boolean;
}

export interface LimitesEscalonamento {
  readonly maxFalhasAuditor: number;
  readonly maxRodadasNegociacao: number;
}

export type MotivoEscalonamento =
  | "frustracao"
  | "fora_de_escopo"
  | "falha_auditor"
  | "valor_acima_alcada"
  | "pedido_do_cliente"
  | "avaliacao_humana_necessaria";

/**
 * Decide se a conversa precisa de gente. A ordem é a de gravidade: pedido
 * explícito do cliente e falha do auditor vêm antes de qualquer outra coisa.
 */
export function motivoParaEscalar(
  situacao: SituacaoEscalonamento,
  limites: LimitesEscalonamento,
): MotivoEscalonamento | null {
  if (situacao.clientePediuHumano) return "pedido_do_cliente";
  if (situacao.falhasAuditor >= limites.maxFalhasAuditor) return "falha_auditor";
  if (situacao.clienteFrustrado) return "frustracao";
  if (situacao.valorAcimaAlcada) return "valor_acima_alcada";
  if (situacao.avaliacaoHumanaNecessaria) return "avaliacao_humana_necessaria";
  if (situacao.rodadasNegociacao > limites.maxRodadasNegociacao) return "fora_de_escopo";
  return null;
}
