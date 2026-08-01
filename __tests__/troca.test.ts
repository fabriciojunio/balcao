import { describe, expect, it } from "vitest";
import { reais } from "../lib/dinheiro.js";
import {
  CHECKLIST_PADRAO,
  checklistCompleto,
  cotacaoValida,
  cotarUsado,
  defeitosDeRespostas,
  proximaPergunta,
  type RegraTroca,
} from "../lib/dominio/troca.js";
import { AGORA, regraTroca } from "./fixtures.js";

const base = { valorBase: reais(1200), agora: AGORA, regra: regraTroca, modelo: "Galaxy S22 128 GB" };

describe("cotação de aparelho usado", () => {
  it("aplica estado e redutores da tabela", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: ["tela_trincada"] });
    expect(r.recusado).toBe(false);
    if (r.recusado) return;

    expect(r.ajusteTotal).toBeCloseTo(-0.43, 10);
    expect(r.valor).toBe(reais(684));
    expect(r.exigeAvaliacaoHumana).toBe(false);
    expect(r.ajustesAplicados.map((a) => a.chave)).toEqual(["estado:bom", "tela_trincada"]);
  });

  it("não promete acima do valor apurado", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "excelente", defeitos: [] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.faixaMax).toBe(r.valor);
    expect(r.faixaMin).toBe(reais(1128));
    expect(r.faixaMin).toBeLessThan(r.faixaMax);
  });

  it("estado sem redutor não entra na lista de ajustes", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "excelente", defeitos: [] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.ajustesAplicados).toHaveLength(0);
    expect(r.valor).toBe(reais(1200));
  });

  it("define validade a partir do momento da cotação", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: [] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.validadeAte.toISOString()).toBe("2026-08-03T12:00:00.000Z");
    expect(cotacaoValida(r, new Date("2026-08-03T11:59:00.000Z"))).toBe(true);
    expect(cotacaoValida(r, new Date("2026-08-03T12:00:01.000Z"))).toBe(false);
  });

  it("sempre carrega a ressalva de conferência física", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: [] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.ressalvas.join(" ")).toContain("conferência física");
  });

  it("normaliza acento, maiúscula e espaço", () => {
    const comAcento = cotarUsado({ ...base, estadoDeclarado: "Bom", defeitos: ["Tela Trincada"] });
    const semAcento = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: ["tela_trincada"] });
    expect(comAcento).toEqual(semAcento);
  });
});

describe("recusas", () => {
  it("recusa condição vetada pela loja", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: ["aparelho_bloqueado"] });
    expect(r.recusado).toBe(true);
    if (!r.recusado) return;
    expect(r.motivo).toContain("aparelho_bloqueado");
  });

  it("recusa redutor marcado como recusar", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: ["nao_liga"] });
    expect(r.recusado).toBe(true);
  });

  it("recusa modelo sem valor de referência", () => {
    const r = cotarUsado({ ...base, valorBase: 0, estadoDeclarado: "bom", defeitos: [] });
    expect(r.recusado).toBe(true);
    if (!r.recusado) return;
    expect(r.motivo).toContain("valor de referência");
  });

  it("recusa quando o valor apurado fica abaixo do mínimo que a loja compra", () => {
    const r = cotarUsado({
      ...base,
      valorBase: reais(200),
      estadoDeclarado: "regular",
      defeitos: ["tela_trincada", "carcaca_amassada"],
    });
    expect(r.recusado).toBe(true);
    if (!r.recusado) return;
    expect(r.motivo).toContain("mínimo");
  });
});

describe("itens fora da tabela", () => {
  it("marca avaliação humana quando o estado é desconhecido e usa o pior ajuste", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "impecavel", defeitos: [] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.exigeAvaliacaoHumana).toBe(true);
    expect(r.ajusteTotal).toBeCloseTo(-0.18, 10);
    expect(r.ressalvas.join(" ")).toContain("fora da tabela");
  });

  it("marca avaliação humana quando o defeito é desconhecido, sem chutar redutor", () => {
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: ["camera_embacada"] });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.exigeAvaliacaoHumana).toBe(true);
    expect(r.ajusteTotal).toBeCloseTo(-0.08, 10);
  });
});

describe("limites", () => {
  it("nunca derruba o valor além do ajuste mínimo", () => {
    const muitosDefeitos = ["tela_trincada", "bateria_abaixo_80", "carcaca_amassada", "tampa_trincada", "sem_caixa"];
    const r = cotarUsado({ ...base, estadoDeclarado: "regular", defeitos: muitosDefeitos });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.ajusteTotal).toBe(regraTroca.ajusteMinimo);
    expect(r.valor).toBe(reais(180));
  });

  it("ignora ajuste positivo somado por engano na configuração", () => {
    const regraTorta: RegraTroca = {
      ...regraTroca,
      redutores: { ...regraTroca.redutores, brinde: 0.5 },
    };
    const r = cotarUsado({ ...base, estadoDeclarado: "excelente", defeitos: ["brinde"], regra: regraTorta });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.valor).toBeLessThanOrEqual(base.valorBase);
  });

  it("aceita tabela de estados vazia sem quebrar", () => {
    const semEstados: RegraTroca = { ...regraTroca, estados: {} };
    const r = cotarUsado({ ...base, estadoDeclarado: "bom", defeitos: [], regra: semEstados });
    if (r.recusado) throw new Error("não deveria recusar");
    expect(r.ajusteTotal).toBe(0);
    expect(r.exigeAvaliacaoHumana).toBe(true);
  });
});

describe("checklist guiado", () => {
  it("pergunta primeiro o que pode derrubar o negócio", () => {
    expect(proximaPergunta([])?.chave).toBe("bloqueio_conta");
    expect(proximaPergunta(["bloqueio_conta"])?.chave).toBe("liga_normalmente");
    expect(proximaPergunta(["bloqueio_conta", "liga_normalmente"])?.chave).toBe("tela");
  });

  it("sabe quando terminou", () => {
    const todas = CHECKLIST_PADRAO.map((p) => p.chave);
    expect(checklistCompleto(todas)).toBe(true);
    expect(proximaPergunta(todas)).toBeNull();
    expect(checklistCompleto([])).toBe(false);
  });

  it("converte respostas em defeitos, ignorando as neutras", () => {
    const defeitos = defeitosDeRespostas({
      bloqueio_conta: "nao",
      liga_normalmente: "sim",
      tela: "tela_trincada",
      bateria: "nao_sei",
      carcaca: "integra",
      acessorios: "sem_caixa",
    });
    expect(defeitos).toEqual(["tela_trincada", "sem_caixa"]);
  });

  it("traduz as respostas que significam recusa", () => {
    expect(defeitosDeRespostas({ bloqueio_conta: "sim" })).toEqual(["bloqueio_conta"]);
    expect(defeitosDeRespostas({ liga_normalmente: "nao" })).toEqual(["nao_liga"]);
  });

  it("aparelho com conta bloqueada é recusado de ponta a ponta", () => {
    const defeitos = defeitosDeRespostas({ bloqueio_conta: "sim", tela: "sem_marca" });
    const r = cotarUsado({ ...base, estadoDeclarado: "excelente", defeitos });
    expect(r.recusado).toBe(true);
  });
});
