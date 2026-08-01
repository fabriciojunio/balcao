// Cálculo das métricas de operação. Função pura sobre o que os repositórios
// devolvem, para o mesmo número sair igual no banco e em memória.

import type { Metricas } from "../portas.js";

export interface EventosDoPeriodo {
  readonly conversas: number;
  readonly conversasComEscalonamento: number;
  readonly motivos: readonly string[];
  readonly bloqueiosAuditor: number;
  readonly propostas: number;
  /** Segundos entre o escalonamento e o vendedor assumir. */
  readonly esperasSegundos: readonly number[];
}

/** Mediana simples. Devolve null quando não há amostra. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) return null;

  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);

  return ordenados.length % 2 === 0
    ? Math.round((ordenados[meio - 1]! + ordenados[meio]!) / 2)
    : ordenados[meio]!;
}

/** O Decreto 11.034/2022 fala em 60 segundos para o humano assumir. */
export const LIMITE_SAC_SEGUNDOS = 60;

export function calcularMetricas(desde: Date, eventos: EventosDoPeriodo): Metricas {
  const contidas = Math.max(eventos.conversas - eventos.conversasComEscalonamento, 0);
  const porMotivo: Record<string, number> = {};
  for (const motivo of eventos.motivos) {
    porMotivo[motivo] = (porMotivo[motivo] ?? 0) + 1;
  }

  return {
    desde,
    conversas: eventos.conversas,
    conversasContidas: contidas,
    taxaContencao: eventos.conversas === 0 ? 0 : Math.round((contidas / eventos.conversas) * 1000) / 10,
    escalonamentos: porMotivo,
    bloqueiosAuditor: eventos.bloqueiosAuditor,
    propostas: eventos.propostas,
    medianaAteHumanoSegundos: mediana(eventos.esperasSegundos),
    acimaDe60Segundos: eventos.esperasSegundos.filter((s) => s > LIMITE_SAC_SEGUNDOS).length,
  };
}
