// Junta o aparelho desejado com a cotação do usado. É o ponto onde os dois
// motores se encontram, e onde se confere a margem do conjunto: não adianta
// a venda fechar bem e a loja pagar caro demais pelo aparelho da troca.

import { formatarBRL, type Centavos } from "../dinheiro.js";
import { erro, ok, type Result } from "../result.js";
import {
  margemPercentual,
  pisoDePreco,
  simularParcelamento,
  type Parcelamento,
  type PoliticaPreco,
  type Produto,
  type TabelaParcelamento,
} from "./preco.js";
import { cotacaoValida, type CotacaoAceita } from "./troca.js";

export interface EntradaProposta {
  readonly produto: Produto;
  readonly politica: PoliticaPreco;
  /** Preço já negociado do aparelho desejado. */
  readonly precoNegociado: Centavos;
  readonly cotacao: CotacaoAceita;
  readonly tabelaParcelamento: TabelaParcelamento;
  readonly parcelas?: number;
  readonly agora: Date;
}

export interface PropostaTroca {
  readonly produtoId: string;
  readonly descricao: string;
  readonly precoProduto: Centavos;
  readonly valorAparelhoUsado: Centavos;
  /** Negativa significa loja pagando a diferença ao cliente. */
  readonly diferencaAPagar: Centavos;
  readonly parcelamento: Parcelamento | null;
  readonly validadeAte: Date;
  readonly margemResultantePercentual: number;
  readonly exigeAprovacaoHumana: boolean;
  readonly motivosDeAprovacao: readonly string[];
  readonly ressalvas: readonly string[];
}

/**
 * Monta a proposta de troca. Recusa antes de calcular quando a cotação já
 * venceu ou quando o preço negociado ficou abaixo do piso da política, para
 * que nenhum caminho do sistema consiga emitir proposta fora da regra.
 */
export function montarPropostaTroca(entrada: EntradaProposta): Result<PropostaTroca> {
  const { produto, politica, precoNegociado, cotacao, tabelaParcelamento, parcelas, agora } = entrada;

  if (!cotacaoValida(cotacao, agora)) {
    return erro("CONFLITO", "A cotação do aparelho usado já venceu; refaça a avaliação.");
  }

  const piso = pisoDePreco(produto, politica);
  if (precoNegociado < piso) {
    return erro("VALIDACAO", `Preço negociado abaixo do piso de ${formatarBRL(piso)}.`, {
      precoNegociado,
      piso,
    });
  }

  const diferenca = precoNegociado - cotacao.valor;
  const motivos: string[] = [];

  const descontoConcedido = produto.precoTabela - precoNegociado;
  if (descontoConcedido > politica.alcadaAprovacaoHumana) {
    motivos.push("Desconto acima da alçada do agente.");
  }
  if (diferenca < 0) {
    motivos.push("A loja ficaria pagando diferença ao cliente.");
  }
  if (cotacao.exigeAvaliacaoHumana) {
    motivos.push("A avaliação do usado tem item fora da tabela.");
  }

  let parcelamento: Parcelamento | null = null;
  if (parcelas !== undefined && diferenca > 0) {
    const simulacao = simularParcelamento(diferenca, parcelas, tabelaParcelamento);
    if (!simulacao.ok) return simulacao;
    parcelamento = simulacao.value;
  }

  return ok({
    produtoId: produto.id,
    descricao: produto.descricao,
    precoProduto: precoNegociado,
    valorAparelhoUsado: cotacao.valor,
    diferencaAPagar: diferenca,
    parcelamento,
    validadeAte: cotacao.validadeAte,
    margemResultantePercentual: margemPercentual(precoNegociado, produto.custo),
    exigeAprovacaoHumana: motivos.length > 0,
    motivosDeAprovacao: motivos,
    ressalvas: cotacao.ressalvas,
  });
}

/** Valores que o auditor precisa liberar para esta proposta aparecer no texto. */
export function valoresDaProposta(proposta: PropostaTroca): Centavos[] {
  const valores: Centavos[] = [
    proposta.precoProduto,
    proposta.valorAparelhoUsado,
    proposta.diferencaAPagar,
  ];
  if (proposta.parcelamento !== null) {
    valores.push(
      proposta.parcelamento.total,
      proposta.parcelamento.valorParcela,
      proposta.parcelamento.primeiraParcela,
    );
  }
  return valores;
}
