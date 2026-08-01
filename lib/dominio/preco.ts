// Motor de precificação. Função pura: não conhece banco, HTTP nem modelo de
// linguagem. É aqui, e somente aqui, que se decide quanto a loja pode cobrar
// e quanto pode ceder. A IA nunca calcula nada disto; ela pergunta.

import {
  aplicarFator,
  descontarPercentual,
  formatarBRL,
  maior,
  percentualDe,
  tetoPara,
  type Centavos,
} from "../dinheiro.js";
import { erro, ok, type Result } from "../result.js";

export const CATEGORIAS = ["novo_lacrado", "seminovo", "acessorio"] as const;
export type CategoriaProduto = (typeof CATEGORIAS)[number];

export interface Produto {
  readonly id: string;
  readonly descricao: string;
  readonly categoria: CategoriaProduto;
  readonly precoTabela: Centavos;
  readonly custo: Centavos;
  readonly etiquetas?: readonly string[];
}

export interface PoliticaPreco {
  /** Margem mínima sobre o preço de venda, em percentual. */
  readonly margemMinimaPercentual: number;
  /** Desconto máximo por categoria, em percentual sobre o preço de tabela. */
  readonly tetoDescontoPercentual: Readonly<Record<CategoriaProduto, number>>;
  /** Concessão oferecida em cada rodada de negociação, em percentual. */
  readonly concessaoPorRodada: readonly number[];
  /** Produtos com qualquer destas etiquetas não recebem desconto. */
  readonly etiquetasSemDesconto: readonly string[];
  /** Acima deste valor de desconto a proposta precisa de aprovação humana. */
  readonly alcadaAprovacaoHumana: Centavos;
  /** Passo de arredondamento do piso, em centavos (100 = reais cheios). */
  readonly arredondamentoCentavos: number;
}

export type SituacaoDesconto = "aprovado" | "contraproposta" | "recusado";

export interface ResultadoDesconto {
  readonly situacao: SituacaoDesconto;
  readonly precoTabela: Centavos;
  readonly precoFinal: Centavos;
  readonly descontoValor: Centavos;
  readonly descontoPercentual: number;
  readonly piso: Centavos;
  readonly margemResultantePercentual: number;
  readonly exigeAprovacaoHumana: boolean;
  readonly motivo: string;
}

export interface EntradaDesconto {
  readonly produto: Produto;
  readonly politica: PoliticaPreco;
  /** Valor que o cliente pediu. Ausente quando ele só perguntou por desconto. */
  readonly valorPedido?: Centavos;
  /** Rodada de negociação, começando em zero. */
  readonly rodada: number;
}

/** Margem do preço sobre o custo, em percentual do preço de venda. */
export function margemPercentual(preco: Centavos, custo: Centavos): number {
  return percentualDe(preco - custo, preco);
}

/** Menor preço que ainda respeita a margem mínima da política. */
export function precoMinimoPorMargem(produto: Produto, politica: PoliticaPreco): Centavos {
  const margem = politica.margemMinimaPercentual;
  if (margem <= 0) return produto.custo;
  return aplicarFator(produto.custo, 1 / (1 - margem / 100));
}

/** Menor preço que a política permite oferecer, considerando margem e teto. */
export function pisoDePreco(produto: Produto, politica: PoliticaPreco): Centavos {
  const porMargem = precoMinimoPorMargem(produto, politica);
  const teto = politica.tetoDescontoPercentual[produto.categoria] ?? 0;
  const porTeto = descontarPercentual(produto.precoTabela, teto);
  const piso = maior(porMargem, porTeto);
  // Arredonda para cima: nunca vale a pena descer abaixo do piso por causa
  // de arredondamento de exibição.
  return Math.min(tetoPara(piso, politica.arredondamentoCentavos), produto.precoTabela);
}

/** Melhor preço que o agente pode oferecer espontaneamente nesta rodada. */
export function melhorOfertaDaRodada(
  produto: Produto,
  politica: PoliticaPreco,
  rodada: number,
): Centavos {
  const rodadas = politica.concessaoPorRodada;
  if (rodadas.length === 0) return produto.precoTabela;
  const indice = Math.min(Math.max(rodada, 0), rodadas.length - 1);
  const concessao = rodadas[indice] ?? 0;
  const preco = descontarPercentual(produto.precoTabela, concessao);
  return maior(preco, pisoDePreco(produto, politica));
}

export function produtoTemDescontoBloqueado(produto: Produto, politica: PoliticaPreco): boolean {
  const etiquetas = produto.etiquetas ?? [];
  return etiquetas.some((e) => politica.etiquetasSemDesconto.includes(e));
}

/**
 * Decide o que responder a um pedido de desconto. Nunca devolve preço abaixo
 * do piso, em nenhum caminho, nem quando o cliente insiste por muitas rodadas.
 */
export function avaliarDesconto(entrada: EntradaDesconto): ResultadoDesconto {
  const { produto, politica, valorPedido, rodada } = entrada;
  const piso = pisoDePreco(produto, politica);

  const montar = (situacao: SituacaoDesconto, precoFinal: Centavos, motivo: string): ResultadoDesconto => {
    const preco = Math.max(Math.min(precoFinal, produto.precoTabela), piso);
    const descontoValor = produto.precoTabela - preco;
    return {
      situacao,
      precoTabela: produto.precoTabela,
      precoFinal: preco,
      descontoValor,
      descontoPercentual: percentualDe(descontoValor, produto.precoTabela),
      piso,
      margemResultantePercentual: margemPercentual(preco, produto.custo),
      exigeAprovacaoHumana: descontoValor > politica.alcadaAprovacaoHumana,
      motivo,
    };
  };

  if (produtoTemDescontoBloqueado(produto, politica)) {
    return montar(
      "recusado",
      produto.precoTabela,
      `Produto marcado como sem desconto (${(produto.etiquetas ?? []).join(", ")}).`,
    );
  }

  if (valorPedido === undefined) {
    const oferta = melhorOfertaDaRodada(produto, politica, rodada);
    if (oferta >= produto.precoTabela) {
      return montar("recusado", produto.precoTabela, "A política não libera desconto nesta rodada.");
    }
    return montar("contraproposta", oferta, "Oferta espontânea dentro da política.");
  }

  if (valorPedido >= produto.precoTabela) {
    return montar("aprovado", produto.precoTabela, "Valor pedido igual ou acima do preço de tabela.");
  }

  if (valorPedido >= piso) {
    return montar("aprovado", valorPedido, "Valor pedido dentro da margem permitida.");
  }

  const contraproposta = maior(melhorOfertaDaRodada(produto, politica, rodada), piso);
  return montar(
    "contraproposta",
    contraproposta,
    `Valor pedido abaixo do piso de ${formatarBRL(piso)} definido pela política.`,
  );
}

// ---------------------------------------------------------------------------
// Parcelamento
// ---------------------------------------------------------------------------

/** Acréscimo percentual por número de parcelas, conforme a maquininha da loja. */
export type TabelaParcelamento = Readonly<Record<number, number>>;

export interface Parcelamento {
  readonly parcelas: number;
  readonly valorParcela: Centavos;
  /** Absorve o resto da divisão para o total fechar exatamente. */
  readonly primeiraParcela: Centavos;
  readonly total: Centavos;
  readonly acrescimo: Centavos;
  readonly taxaPercentual: number;
}

/**
 * Simula parcelamento com as taxas reais da loja. Recusa quando o número de
 * parcelas não está na tabela: taxa estimada é exatamente o tipo de chute que
 * este sistema existe para impedir.
 */
export function simularParcelamento(
  valor: Centavos,
  parcelas: number,
  tabela: TabelaParcelamento,
): Result<Parcelamento> {
  if (!Number.isInteger(parcelas) || parcelas < 1) {
    return erro("VALIDACAO", `Número de parcelas inválido: ${parcelas}`);
  }
  if (valor <= 0) {
    return erro("VALIDACAO", "Valor a parcelar precisa ser positivo.");
  }
  const taxa = tabela[parcelas];
  if (taxa === undefined) {
    return erro("VALIDACAO", `A loja não tem taxa cadastrada para ${parcelas}x.`, {
      parcelasDisponiveis: Object.keys(tabela).map(Number).sort((a, b) => a - b),
    });
  }

  const total = aplicarFator(valor, 1 + taxa / 100);
  const valorParcela = Math.floor(total / parcelas);
  const resto = total - valorParcela * parcelas;

  return ok({
    parcelas,
    valorParcela,
    primeiraParcela: valorParcela + resto,
    total,
    acrescimo: total - valor,
    taxaPercentual: taxa,
  });
}

/** Todas as opções de parcelamento válidas para um valor, em ordem crescente. */
export function opcoesDeParcelamento(valor: Centavos, tabela: TabelaParcelamento): Parcelamento[] {
  return Object.keys(tabela)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b)
    .flatMap((n) => {
      const r = simularParcelamento(valor, n, tabela);
      return r.ok ? [r.value] : [];
    });
}

// ---------------------------------------------------------------------------
// Validação da política
// ---------------------------------------------------------------------------

/** Confere a coerência de uma política antes de ela entrar em operação. */
export function validarPolitica(politica: PoliticaPreco): Result<PoliticaPreco> {
  if (politica.margemMinimaPercentual < 0 || politica.margemMinimaPercentual >= 100) {
    return erro("CONFIG_INVALIDA", "margemMinimaPercentual precisa ficar entre 0 e 99.");
  }
  for (const categoria of CATEGORIAS) {
    const teto = politica.tetoDescontoPercentual[categoria];
    if (teto === undefined || teto < 0 || teto > 100) {
      return erro("CONFIG_INVALIDA", `Teto de desconto inválido para a categoria ${categoria}.`);
    }
  }
  if (politica.concessaoPorRodada.some((c) => c < 0 || c > 100)) {
    return erro("CONFIG_INVALIDA", "Concessão por rodada precisa ficar entre 0 e 100.");
  }
  for (let i = 1; i < politica.concessaoPorRodada.length; i++) {
    if ((politica.concessaoPorRodada[i] ?? 0) < (politica.concessaoPorRodada[i - 1] ?? 0)) {
      return erro("CONFIG_INVALIDA", "A concessão por rodada não pode diminuir ao longo da negociação.");
    }
  }
  if (politica.arredondamentoCentavos <= 0) {
    return erro("CONFIG_INVALIDA", "arredondamentoCentavos precisa ser positivo.");
  }
  if (politica.alcadaAprovacaoHumana < 0) {
    return erro("CONFIG_INVALIDA", "alcadaAprovacaoHumana não pode ser negativa.");
  }
  return ok(politica);
}
