// O caminho que toda resposta percorre entre o modelo e o WhatsApp.
// Falhou duas vezes, chama gente: não existe terceira tentativa.

import { z } from "zod";
import {
  auditarMensagem,
  aplicarMarcadores,
  resumirViolacoes,
  type ContextoAuditoria,
  type Violacao,
} from "./auditor/index.js";
import type { Centavos } from "./dinheiro.js";
import { EVENTOS, podeUsar, type EstadoConversa, type EventoConversa } from "./dominio/conversa.js";
import { ehNomeDeFerramenta, type NomeFerramenta } from "./ferramentas/catalogo.js";

/**
 * Formato fechado da resposta do modelo. Texto livre só existe dentro de
 * `texto`, e mesmo ali os números são marcadores.
 */
export const respostaModeloSchema = z.discriminatedUnion("acao", [
  z.object({
    acao: z.literal("responder"),
    texto: z.string().min(1),
    consulta_id: z.string().optional(),
    evento: z.string().optional(),
  }),
  z.object({
    acao: z.literal("chamar_ferramenta"),
    ferramenta: z.string().min(1),
    argumentos: z.record(z.string(), z.unknown()).default({}),
    evento: z.string().optional(),
  }),
  z.object({
    acao: z.literal("escalar"),
    motivo: z.string().min(1),
    resumo: z.string().default(""),
  }),
]);

export type RespostaModelo = z.infer<typeof respostaModeloSchema>;

export type Decisao =
  | { readonly tipo: "enviar"; readonly texto: string }
  | { readonly tipo: "chamar_ferramenta"; readonly ferramenta: NomeFerramenta; readonly argumentos: Record<string, unknown> }
  | { readonly tipo: "repetir"; readonly motivo: string; readonly violacoes: readonly Violacao[] }
  | { readonly tipo: "escalar"; readonly motivo: string; readonly detalhe: string };

export interface EntradaPipeline {
  /** O que o modelo devolveu, ainda sem validar. */
  readonly bruto: unknown;
  readonly estado: EstadoConversa;
  /** Valores prontos para substituir os marcadores, já formatados. */
  readonly valores: Readonly<Record<string, string>>;
  readonly contexto: ContextoAuditoria;
  /** Tentativa atual, começando em 1. */
  readonly tentativa: number;
  readonly maxTentativas: number;
}

function esgotou(entrada: EntradaPipeline): boolean {
  return entrada.tentativa >= entrada.maxTentativas;
}

function repetirOuEscalar(entrada: EntradaPipeline, motivo: string, detalhe: string, violacoes: readonly Violacao[] = []): Decisao {
  if (esgotou(entrada)) {
    return { tipo: "escalar", motivo: "falha_auditor", detalhe: `${motivo}: ${detalhe}` };
  }
  return { tipo: "repetir", motivo: `${motivo}: ${detalhe}`, violacoes };
}

/**
 * Decide o que fazer com a resposta do modelo.
 * Nunca devolve texto para envio sem ele ter passado por marcadores e
 * auditoria; não há caminho alternativo.
 */
export function processarResposta(entrada: EntradaPipeline): Decisao {
  const parsed = respostaModeloSchema.safeParse(entrada.bruto);
  if (!parsed.success) {
    return repetirOuEscalar(
      entrada,
      "formato_invalido",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }

  const resposta = parsed.data;

  if (resposta.acao === "escalar") {
    return { tipo: "escalar", motivo: resposta.motivo, detalhe: resposta.resumo };
  }

  if (resposta.acao === "chamar_ferramenta") {
    if (!ehNomeDeFerramenta(resposta.ferramenta)) {
      return repetirOuEscalar(entrada, "ferramenta_inexistente", resposta.ferramenta);
    }
    if (!podeUsar(entrada.estado, resposta.ferramenta)) {
      return repetirOuEscalar(
        entrada,
        "ferramenta_fora_do_estado",
        `${resposta.ferramenta} não está disponível em ${entrada.estado}`,
      );
    }
    return { tipo: "chamar_ferramenta", ferramenta: resposta.ferramenta, argumentos: resposta.argumentos };
  }

  const resolvido = aplicarMarcadores(resposta.texto, entrada.valores);
  if (!resolvido.ok) {
    return repetirOuEscalar(entrada, "marcador", resolvido.error.message);
  }

  const auditoria = auditarMensagem(resolvido.value.texto, entrada.contexto);
  if (!auditoria.aprovado) {
    return repetirOuEscalar(entrada, "auditoria", resumirViolacoes(auditoria), auditoria.violacoes);
  }

  return { tipo: "enviar", texto: resolvido.value.texto };
}

/**
 * Evento que o modelo sinalizou, se for um evento conhecido. O orquestrador
 * aplica antes de decidir, porque a conversa pode ter mudado de fase na mesma
 * mensagem em que o cliente pede a próxima coisa.
 */
export function eventoDaResposta(bruto: unknown): EventoConversa | null {
  const evento = (bruto as { evento?: unknown })?.evento;
  if (typeof evento !== "string") return null;
  return (EVENTOS as readonly string[]).includes(evento) ? (evento as EventoConversa) : null;
}

export interface ValoresDaRodada {
  readonly monetarios?: readonly Centavos[];
  readonly percentuais?: readonly number[];
  readonly parcelas?: readonly number[];
  readonly numeros?: readonly number[];
}

/** Soma ao contexto base os valores que as ferramentas devolveram nesta rodada. */
export function contextoComValores(
  base: ContextoAuditoria,
  rodada: ValoresDaRodada,
): ContextoAuditoria {
  return {
    ...base,
    monetariosPermitidos: [...base.monetariosPermitidos, ...(rodada.monetarios ?? [])],
    percentuaisPermitidos: [...base.percentuaisPermitidos, ...(rodada.percentuais ?? [])],
    parcelasPermitidas: [...base.parcelasPermitidas, ...(rodada.parcelas ?? [])],
    numerosPermitidos: [...base.numerosPermitidos, ...(rodada.numeros ?? [])],
  };
}
