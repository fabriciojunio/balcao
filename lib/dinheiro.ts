// Dinheiro em centavos inteiros. Nenhum valor monetário do sistema trafega
// como float: preço, custo, desconto, parcela e cotação de usado são sempre
// inteiros. Isso elimina a classe inteira de erro de arredondamento que faz
// uma proposta fechar por um centavo a menos do que a margem permite.

/** Valor monetário em centavos. Sempre inteiro, pode ser negativo. */
export type Centavos = number;

const SEPARADOR_MILHAR = ".";
const SEPARADOR_DECIMAL = ",";

/** Arredonda meio para longe do zero, que é a regra usada no varejo. */
export function arredondar(valor: number): number {
  if (!Number.isFinite(valor)) {
    throw new TypeError(`Valor não finito em operação monetária: ${valor}`);
  }
  const ajustado = valor + (valor >= 0 ? Number.EPSILON : -Number.EPSILON) * Math.abs(valor);
  return valor >= 0 ? Math.round(ajustado) : -Math.round(-ajustado);
}

/** Converte reais (ex.: 1234.56) em centavos (123456). */
export function reais(valor: number): Centavos {
  return arredondar(valor * 100);
}

/** Garante que um número já em centavos é inteiro. */
export function centavos(valor: number): Centavos {
  if (!Number.isInteger(valor)) {
    throw new TypeError(`Centavos precisam ser inteiros, recebido: ${valor}`);
  }
  return valor;
}

export function somar(...valores: Centavos[]): Centavos {
  return valores.reduce((total, v) => total + v, 0);
}

export function subtrair(a: Centavos, b: Centavos): Centavos {
  return a - b;
}

/** Multiplica por um fator e arredonda de volta para centavo inteiro. */
export function aplicarFator(valor: Centavos, fator: number): Centavos {
  return arredondar(valor * fator);
}

/** Aplica um percentual sobre o valor. `aplicarPercentual(10000, 10)` = 1000. */
export function aplicarPercentual(valor: Centavos, percentual: number): Centavos {
  return arredondar((valor * percentual) / 100);
}

/** Desconta um percentual do valor. `descontarPercentual(10000, 10)` = 9000. */
export function descontarPercentual(valor: Centavos, percentual: number): Centavos {
  return valor - aplicarPercentual(valor, percentual);
}

/**
 * Percentual que `parte` representa de `total`, com duas casas.
 * Devolve 0 quando o total é zero, para não propagar infinito na política.
 */
export function percentualDe(parte: Centavos, total: Centavos): number {
  if (total === 0) return 0;
  return Math.round((parte / total) * 10000) / 100;
}

/** Arredonda para o múltiplo mais próximo (ex.: passo 100 = reais cheios). */
export function arredondarPara(valor: Centavos, passo: number): Centavos {
  if (passo <= 0) throw new TypeError(`Passo de arredondamento inválido: ${passo}`);
  return arredondar(valor / passo) * passo;
}

/** Arredonda para baixo até o múltiplo, usado em piso de preço. */
export function pisoPara(valor: Centavos, passo: number): Centavos {
  if (passo <= 0) throw new TypeError(`Passo de arredondamento inválido: ${passo}`);
  return Math.floor(valor / passo) * passo;
}

/** Arredonda para cima até o múltiplo, usado em teto e em piso de preço. */
export function tetoPara(valor: Centavos, passo: number): Centavos {
  if (passo <= 0) throw new TypeError(`Passo de arredondamento inválido: ${passo}`);
  return Math.ceil(valor / passo) * passo;
}

export function maior(a: Centavos, b: Centavos): Centavos {
  return a > b ? a : b;
}

export function menor(a: Centavos, b: Centavos): Centavos {
  return a < b ? a : b;
}

/** Formata em real brasileiro sem depender de ICU: "R$ 1.234,56". */
export function formatarBRL(valor: Centavos): string {
  const negativo = valor < 0;
  const absoluto = Math.abs(arredondar(valor));
  const inteiro = Math.floor(absoluto / 100);
  const decimal = String(absoluto % 100).padStart(2, "0");
  const inteiroFormatado = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, SEPARADOR_MILHAR);
  return `${negativo ? "-" : ""}R$ ${inteiroFormatado}${SEPARADOR_DECIMAL}${decimal}`;
}

/** Formata percentual sem casas desnecessárias: 10 -> "10%", 7.5 -> "7,5%". */
export function formatarPercentual(percentual: number): string {
  const arredondado = Math.round(percentual * 100) / 100;
  return `${String(arredondado).replace(".", SEPARADOR_DECIMAL)}%`;
}

/**
 * Interpreta um valor monetário escrito em português.
 * Regras: se houver vírgula, ela é o decimal e os pontos são milhar; sem
 * vírgula, um ponto seguido de exatamente três dígitos também é milhar.
 * Devolve null quando o texto não é um número reconhecível.
 */
export function analisarMoedaBR(texto: string): Centavos | null {
  const limpo = texto.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (limpo === "" || !/^-?[\d.,]+$/.test(limpo)) return null;

  const negativo = limpo.startsWith("-");
  const corpo = negativo ? limpo.slice(1) : limpo;
  if (!/\d/.test(corpo)) return null;

  let normalizado: string;
  if (corpo.includes(SEPARADOR_DECIMAL)) {
    const partes = corpo.split(SEPARADOR_DECIMAL);
    if (partes.length !== 2) return null;
    normalizado = `${partes[0]!.replaceAll(SEPARADOR_MILHAR, "")}.${partes[1]}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(corpo)) {
    normalizado = corpo.replaceAll(SEPARADOR_MILHAR, "");
  } else {
    normalizado = corpo;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return null;
  return reais(negativo ? -numero : numero);
}
