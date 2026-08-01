import { describe, expect, it } from "vitest";
import { desempacotar, err, erro, ok, paraHttpStatus, type CodigoErro } from "../lib/result.js";
import { colapsarEspacos, normalizarChave, semAcento } from "../lib/texto.js";

describe("Result", () => {
  it("embrulha sucesso e falha", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
    expect(err({ code: "INTERNO", message: "x" })).toEqual({
      ok: false,
      error: { code: "INTERNO", message: "x" },
    });
  });

  it("monta erro com e sem detalhes", () => {
    expect(erro("VALIDACAO", "campo faltando")).toEqual({
      ok: false,
      error: { code: "VALIDACAO", message: "campo faltando" },
    });
    const comDetalhe = erro("CONFLITO", "reservado", { produtoId: "p-1" });
    expect(comDetalhe.error.detalhes).toEqual({ produtoId: "p-1" });
  });

  it("traduz cada código para status HTTP", () => {
    const esperado: Record<CodigoErro, number> = {
      NAO_ENCONTRADO: 404,
      VALIDACAO: 422,
      CONFLITO: 409,
      PROIBIDO: 403,
      CONFIG_INVALIDA: 500,
      INTERNO: 500,
    };
    for (const [codigo, status] of Object.entries(esperado)) {
      expect(paraHttpStatus(codigo as CodigoErro)).toBe(status);
    }
  });

  it("desempacota valor e lança quando está em erro", () => {
    expect(desempacotar(ok("valor"))).toBe("valor");
    expect(() => desempacotar(erro("INTERNO", "falhou"))).toThrow(/falhou/);
  });
});

describe("normalização de texto", () => {
  it("transforma rótulo em chave de tabela", () => {
    expect(normalizarChave("Tela Trincada")).toBe("tela_trincada");
    expect(normalizarChave("  CARCAÇA amassada  ")).toBe("carcaca_amassada");
    expect(normalizarChave("bateria_abaixo_80")).toBe("bateria_abaixo_80");
  });

  it("remove acento preservando o espaço", () => {
    expect(semAcento("garantia estendida à vista")).toBe("garantia estendida a vista");
  });

  it("colapsa espaço e quebra de linha", () => {
    expect(colapsarEspacos("  oi\n\n  tudo   bem  ")).toBe("oi tudo bem");
  });
});
