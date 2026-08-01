import { describe, expect, it } from "vitest";
import { CASOS } from "../evals/casos.js";
import { executarBateria, executarCaso, type AmbienteEval } from "../evals/executor.js";
import {
  AGORA,
  iphoneNovo,
  lancamento,
  politica,
  regraTroca,
  seminovoApertado,
  tabelaParcelamento,
} from "./fixtures.js";

const ambiente: AmbienteEval = {
  politica,
  tabelaParcelamento,
  regraTroca,
  agora: AGORA,
  produtos: {
    iphone_novo: iphoneNovo,
    seminovo_apertado: seminovoApertado,
    lancamento,
  },
};

describe("bateria de conversas de referência", () => {
  it.each(CASOS.map((c) => [`[${c.origem}] ${c.nome}`, c] as const))("%s", (_titulo, caso) => {
    const veredito = executarCaso(caso, ambiente);
    expect(veredito.detalhe).toBe("ok");
    expect(veredito.passou).toBe(true);
  });

  it("a bateria inteira passa", () => {
    const { falhas, vereditos } = executarBateria(CASOS, ambiente);
    expect(falhas).toEqual([]);
    expect(vereditos).toHaveLength(CASOS.length);
  });

  it("cobre os erros do bot antigo, a operação e as tentativas adversariais", () => {
    const origens = new Set(CASOS.map((c) => c.origem));
    expect([...origens].sort()).toEqual(["adversarial", "bot_antigo", "operacao"]);
  });

  it("aumentar a concessão por rodada sozinha não fura nada: o teto da categoria segura", () => {
    const rodadasGenerosas: AmbienteEval = {
      ...ambiente,
      politica: { ...politica, concessaoPorRodada: [0, 2, 25] },
    };
    expect(executarBateria(CASOS, rodadasGenerosas).falhas).toEqual([]);
  });

  it("acusa quando alguém afrouxa o teto de desconto junto com as rodadas", () => {
    const afrouxada: AmbienteEval = {
      ...ambiente,
      politica: {
        ...politica,
        concessaoPorRodada: [0, 2, 25],
        tetoDescontoPercentual: { ...politica.tetoDescontoPercentual, novo_lacrado: 20 },
      },
    };
    const { falhas } = executarBateria(CASOS, afrouxada);
    expect(falhas.length).toBeGreaterThan(0);
  });

  it("acusa quando alguém mexe na tabela de troca", () => {
    const mexida: AmbienteEval = {
      ...ambiente,
      regraTroca: { ...regraTroca, redutores: { ...regraTroca.redutores, tela_trincada: -0.1 } },
    };
    const { falhas } = executarBateria(CASOS, mexida);
    expect(falhas.some((f) => f.nome.includes("tela trincada"))).toBe(true);
  });
});
