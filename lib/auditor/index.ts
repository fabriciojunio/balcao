// A quinta trava. Todo número da mensagem precisa ter origem numa consulta
// registrada; qualquer outro bloqueia o envio.

import type { Centavos } from "../dinheiro.js";
import { semAcento } from "../texto.js";
import { extrairOcorrencias, type Ocorrencia } from "./extrator.js";

export type TipoViolacao =
  | "monetario_nao_autorizado"
  | "percentual_nao_autorizado"
  | "parcelas_nao_autorizada"
  | "numero_sem_formatacao"
  | "marcador_nao_resolvido"
  | "frase_proibida"
  | "valor_ilegivel";

export interface Violacao {
  readonly tipo: TipoViolacao;
  readonly trecho: string;
  readonly motivo: string;
}

export interface ContextoAuditoria {
  /** Valores devolvidos pelas ferramentas nesta rodada, em centavos. */
  readonly monetariosPermitidos: readonly Centavos[];
  readonly percentuaisPermitidos: readonly number[];
  readonly parcelasPermitidas: readonly number[];
  /** Números que a loja pode citar sem ser preço: endereço, telefone, memória. */
  readonly numerosPermitidos: readonly number[];
  /** Abaixo deste valor, número solto é considerado inofensivo. */
  readonly limiarNumeroSolto: number;
  /** Diferença tolerada na comparação monetária, em centavos. */
  readonly toleranciaCentavos: number;
  /** Promessas que o agente não pode fazer em nenhuma hipótese. */
  readonly frasesProibidas: readonly string[];
}

export interface ResultadoAuditoria {
  readonly aprovado: boolean;
  readonly ocorrencias: readonly Ocorrencia[];
  readonly violacoes: readonly Violacao[];
}

export const CONTEXTO_PADRAO: ContextoAuditoria = {
  monetariosPermitidos: [],
  percentuaisPermitidos: [],
  parcelasPermitidas: [],
  numerosPermitidos: [],
  limiarNumeroSolto: 100,
  toleranciaCentavos: 0,
  frasesProibidas: [],
};

export function contextoDe(parcial: Partial<ContextoAuditoria>): ContextoAuditoria {
  return { ...CONTEXTO_PADRAO, ...parcial };
}

function combina(valor: number, permitidos: readonly number[], tolerancia: number): boolean {
  return permitidos.some((p) => Math.abs(p - valor) <= tolerancia);
}

/**
 * Audita a mensagem já com os marcadores resolvidos.
 * Não corrige nada: aprova ou reprova. Quem trata a reprovação é o
 * orquestrador, que tenta de novo e, na segunda falha, chama um humano.
 */
export function auditarMensagem(texto: string, contexto: ContextoAuditoria): ResultadoAuditoria {
  const violacoes: Violacao[] = [];

  if (/\{\{|\}\}/.test(texto)) {
    violacoes.push({
      tipo: "marcador_nao_resolvido",
      trecho: texto.match(/\{\{[^}]*\}\}?/)?.[0] ?? "{{",
      motivo: "Sobrou marcador na mensagem final.",
    });
  }

  const textoNormalizado = semAcento(texto).toLowerCase();
  for (const frase of contexto.frasesProibidas) {
    const alvo = semAcento(frase).toLowerCase().trim();
    if (alvo !== "" && textoNormalizado.includes(alvo)) {
      violacoes.push({
        tipo: "frase_proibida",
        trecho: frase,
        motivo: "O agente não tem autorização para prometer isto.",
      });
    }
  }

  const ocorrencias = extrairOcorrencias(texto);

  for (const o of ocorrencias) {
    if (!Number.isFinite(o.valor)) {
      violacoes.push({
        tipo: "valor_ilegivel",
        trecho: o.bruto,
        motivo: "Número em formato que o sistema não consegue conferir.",
      });
      continue;
    }

    switch (o.tipo) {
      case "monetario":
        if (!combina(o.valor, contexto.monetariosPermitidos, contexto.toleranciaCentavos)) {
          violacoes.push({
            tipo: "monetario_nao_autorizado",
            trecho: o.bruto,
            motivo: "Valor sem origem em consulta registrada nesta conversa.",
          });
        }
        break;

      case "percentual":
        if (!combina(o.valor, contexto.percentuaisPermitidos, 0)) {
          violacoes.push({
            tipo: "percentual_nao_autorizado",
            trecho: o.bruto,
            motivo: "Percentual que nenhuma ferramenta devolveu.",
          });
        }
        break;

      case "parcelas":
        if (!combina(o.valor, contexto.parcelasPermitidas, 0)) {
          violacoes.push({
            tipo: "parcelas_nao_autorizada",
            trecho: o.bruto,
            motivo: "Parcelamento fora do que a simulação devolveu.",
          });
        }
        break;

      case "solto":
        // Quantia sai sempre formatada com R$. Número alto solto é bloqueado
        // mesmo quando bate com um valor autorizado: "fica em 1200" é
        // ambíguo para o cliente e barato de refazer.
        if (o.valor >= contexto.limiarNumeroSolto && !combina(o.valor, contexto.numerosPermitidos, 0)) {
          violacoes.push({
            tipo: "numero_sem_formatacao",
            trecho: o.bruto,
            motivo: "Número alto escrito solto; toda quantia precisa sair formatada e conferida.",
          });
        }
        break;

      case "tecnico":
        // Memória, tela, garantia em meses: não é dinheiro, não se confere.
        break;
    }
  }

  return { aprovado: violacoes.length === 0, ocorrencias, violacoes };
}

/** Resumo curto para o log e para a tela de suporte. */
export function resumirViolacoes(resultado: ResultadoAuditoria): string {
  if (resultado.aprovado) return "sem violações";
  return resultado.violacoes.map((v) => `${v.tipo}(${v.trecho})`).join("; ");
}

export { extrairOcorrencias, valoresMonetarios } from "./extrator.js";
export { aplicarMarcadores, marcadoresDe } from "./marcadores.js";
export type { Ocorrencia, TipoOcorrencia } from "./extrator.js";
