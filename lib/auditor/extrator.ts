// Extração de todo número que sai numa mensagem, inclusive o mal formatado.

import { analisarMoedaBR, type Centavos } from "../dinheiro.js";

export type TipoOcorrencia = "monetario" | "percentual" | "parcelas" | "tecnico" | "solto";

export interface Ocorrencia {
  readonly tipo: TipoOcorrencia;
  /** Trecho exato como apareceu no texto. */
  readonly bruto: string;
  /** Centavos para monetário; o número puro nos demais tipos. */
  readonly valor: number;
  readonly indice: number;
}

// A ordem das alternativas é a precedência da extração: o que casa primeiro
// consome o trecho e impede que uma alternativa mais genérica o repique.
const PADRAO = new RegExp(
  [
    // A forma com milhar vem antes da forma simples para "3.200" não ser
    // lido como "3". As duas aceitam centavos opcionais.
    "(?<moeda>R\\$\\s*-?(?:\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,\\d{1,2})?)",
    // Percentual vem antes do decimal: "12,5%" é percentual, não R$ 12,50.
    "(?<percentual>\\b\\d{1,3}(?:,\\d{1,2})?\\s*%)",
    "(?<decimal>-?\\b(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{1,2}\\b)",
    "(?<parcelas>\\b\\d{1,2}\\s*x(?![a-z0-9]))",
    "(?<tecnico>\\b\\d+(?:[.,]\\d+)?\\s*(?:gb|tb|mb|mah|ghz|hz|mp|mm|pol|polegadas|w|v|meses|mes|dias|dia|horas|hora|anos|ano|unidades|unidade)\\b)",
    "(?<milhar>\\b\\d{1,3}(?:\\.\\d{3})+\\b)",
    "(?<solto>\\b\\d+\\b)",
  ].join("|"),
  "gi",
);

function numeroDe(bruto: string): number {
  const somenteNumero = bruto.replace(/[^\d,.-]/g, "");
  const normalizado = somenteNumero.includes(",")
    ? somenteNumero.replaceAll(".", "").replace(",", ".")
    : somenteNumero;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Percorre o texto e devolve toda ocorrência numérica, em ordem de leitura. */
export function extrairOcorrencias(texto: string): Ocorrencia[] {
  const ocorrencias: Ocorrencia[] = [];
  PADRAO.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = PADRAO.exec(texto)) !== null) {
    const g = match.groups ?? {};
    const indice = match.index;
    const bruto = match[0];

    if (g.moeda !== undefined || g.decimal !== undefined) {
      const centavos = analisarMoedaBR(bruto);
      if (centavos !== null) {
        ocorrencias.push({ tipo: "monetario", bruto, valor: centavos, indice });
      }
      continue;
    }
    if (g.percentual !== undefined) {
      ocorrencias.push({ tipo: "percentual", bruto, valor: numeroDe(bruto), indice });
      continue;
    }
    if (g.parcelas !== undefined) {
      ocorrencias.push({ tipo: "parcelas", bruto, valor: numeroDe(bruto), indice });
      continue;
    }
    if (g.tecnico !== undefined) {
      ocorrencias.push({ tipo: "tecnico", bruto, valor: numeroDe(bruto), indice });
      continue;
    }
    if (g.milhar !== undefined) {
      // "1.899" sem R$ é, na prática, preço escrito errado. Vira monetário
      // para que o auditor cobre a correspondência com uma consulta real.
      const centavos = analisarMoedaBR(bruto);
      ocorrencias.push({
        tipo: "monetario",
        bruto,
        valor: centavos ?? Number.NaN,
        indice,
      });
      continue;
    }
    ocorrencias.push({ tipo: "solto", bruto, valor: numeroDe(bruto), indice });
  }

  return ocorrencias;
}

/** Só os valores monetários encontrados, já em centavos. */
export function valoresMonetarios(texto: string): Centavos[] {
  return extrairOcorrencias(texto)
    .filter((o) => o.tipo === "monetario" && Number.isFinite(o.valor))
    .map((o) => o.valor);
}
