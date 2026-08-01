// Executor da bateria de regressão. Roda cada caso contra o domínio de
// verdade e devolve um veredito comparável, para o CI barrar o merge quando
// alguma regra deixar de valer.

import { contextoDe, auditarMensagem } from "../lib/auditor/index.js";
import { reais, type Centavos } from "../lib/dinheiro.js";
import {
  avaliarDesconto,
  pisoDePreco,
  simularParcelamento,
  type PoliticaPreco,
  type Produto,
  type TabelaParcelamento,
} from "../lib/dominio/preco.js";
import { cotarUsado, type RegraTroca } from "../lib/dominio/troca.js";
import type { CasoRegressao } from "./casos.js";

export interface AmbienteEval {
  readonly politica: PoliticaPreco;
  readonly tabelaParcelamento: TabelaParcelamento;
  readonly regraTroca: RegraTroca;
  readonly produtos: Readonly<Record<string, Produto>>;
  readonly agora: Date;
}

export interface Veredito {
  readonly nome: string;
  readonly origem: string;
  readonly passou: boolean;
  readonly detalhe: string;
}

function conferir(condicoes: Array<[boolean, string]>): { passou: boolean; detalhe: string } {
  const falhas = condicoes.filter(([ok]) => !ok).map(([, texto]) => texto);
  return { passou: falhas.length === 0, detalhe: falhas.join(" | ") || "ok" };
}

export function executarCaso(caso: CasoRegressao, ambiente: AmbienteEval): Veredito {
  const base = { nome: caso.nome, origem: caso.origem };

  switch (caso.cenario) {
    case "desconto": {
      const produto = ambiente.produtos[caso.produto];
      if (produto === undefined) {
        return { ...base, passou: false, detalhe: `produto ${caso.produto} não existe no ambiente` };
      }
      const resultado = avaliarDesconto({
        produto,
        politica: ambiente.politica,
        rodada: caso.rodada,
        ...(caso.valorPedidoReais === undefined ? {} : { valorPedido: reais(caso.valorPedidoReais) }),
      });
      const piso = pisoDePreco(produto, ambiente.politica);
      const esperadoPreco: Centavos | undefined =
        caso.esperado.precoFinalReais === undefined ? undefined : reais(caso.esperado.precoFinalReais);

      return {
        ...base,
        ...conferir([
          [resultado.situacao === caso.esperado.situacao, `situação ${resultado.situacao}`],
          [esperadoPreco === undefined || resultado.precoFinal === esperadoPreco, `preço ${resultado.precoFinal}`],
          [resultado.precoFinal >= piso, `preço abaixo do piso ${piso}`],
          [
            resultado.margemResultantePercentual >= ambiente.politica.margemMinimaPercentual ||
              resultado.precoFinal === produto.precoTabela,
            `margem ${resultado.margemResultantePercentual}`,
          ],
        ]),
      };
    }

    case "cotacao": {
      const resultado = cotarUsado({
        modelo: "aparelho de teste",
        valorBase: reais(caso.valorBaseReais),
        estadoDeclarado: caso.estado,
        defeitos: caso.defeitos,
        agora: ambiente.agora,
        regra: ambiente.regraTroca,
      });

      if (caso.esperado.recusado) {
        return { ...base, ...conferir([[resultado.recusado, "deveria recusar e não recusou"]]) };
      }
      if (resultado.recusado) {
        return { ...base, passou: false, detalhe: `recusou sem precisar: ${resultado.motivo}` };
      }

      return {
        ...base,
        ...conferir([
          [resultado.valor === reais(caso.esperado.valorReais), `valor ${resultado.valor}`],
          [
            caso.esperado.exigeAvaliacaoHumana === undefined ||
              resultado.exigeAvaliacaoHumana === caso.esperado.exigeAvaliacaoHumana,
            `avaliação humana ${resultado.exigeAvaliacaoHumana}`,
          ],
          [resultado.faixaMax <= resultado.valor, "faixa prometendo acima do apurado"],
        ]),
      };
    }

    case "parcelamento": {
      const resultado = simularParcelamento(
        reais(caso.valorReais),
        caso.parcelas,
        ambiente.tabelaParcelamento,
      );
      if (!caso.esperado.ok) {
        return { ...base, ...conferir([[!resultado.ok, "deveria recusar o parcelamento"]]) };
      }
      if (!resultado.ok) {
        return { ...base, passou: false, detalhe: `recusou sem precisar: ${resultado.error.message}` };
      }
      return {
        ...base,
        ...conferir([
          [
            caso.esperado.totalReais === undefined || resultado.value.total === reais(caso.esperado.totalReais),
            `total ${resultado.value.total}`,
          ],
        ]),
      };
    }

    case "mensagem": {
      const contexto = contextoDe({
        monetariosPermitidos: caso.monetariosPermitidosReais.map(reais),
        parcelasPermitidas: caso.parcelasPermitidas ?? [],
      });
      const resultado = auditarMensagem(caso.texto, contexto);
      return {
        ...base,
        ...conferir([
          [
            resultado.aprovado === caso.esperado.aprovado,
            `auditoria ${resultado.aprovado ? "aprovou" : "bloqueou"}: ${resultado.violacoes
              .map((v) => v.tipo)
              .join(", ")}`,
          ],
        ]),
      };
    }
  }
}

export function executarBateria(
  casos: readonly CasoRegressao[],
  ambiente: AmbienteEval,
): { readonly vereditos: Veredito[]; readonly falhas: Veredito[] } {
  const vereditos = casos.map((c) => executarCaso(c, ambiente));
  return { vereditos, falhas: vereditos.filter((v) => !v.passou) };
}
