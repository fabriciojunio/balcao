import { describe, expect, it } from "vitest";
import {
  analisarMoedaBR,
  aplicarFator,
  aplicarPercentual,
  arredondar,
  arredondarPara,
  centavos,
  descontarPercentual,
  formatarBRL,
  formatarPercentual,
  maior,
  menor,
  percentualDe,
  pisoPara,
  reais,
  somar,
  subtrair,
  tetoPara,
} from "../lib/dinheiro.js";

describe("conversão e arredondamento", () => {
  it("converte reais em centavos sem erro de ponto flutuante", () => {
    expect(reais(1234.56)).toBe(123456);
    expect(reais(0.1 + 0.2)).toBe(30);
    expect(reais(1899.9)).toBe(189990);
    expect(reais(-50.5)).toBe(-5050);
  });

  it("arredonda meio para longe do zero", () => {
    expect(arredondar(0.5)).toBe(1);
    expect(arredondar(-0.5)).toBe(-1);
    expect(arredondar(2.4)).toBe(2);
  });

  it("recusa valor não finito", () => {
    expect(() => arredondar(Number.NaN)).toThrow(TypeError);
    expect(() => arredondar(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("recusa centavos fracionados", () => {
    expect(centavos(1000)).toBe(1000);
    expect(() => centavos(10.5)).toThrow(TypeError);
  });
});

describe("operações", () => {
  it("soma e subtrai", () => {
    expect(somar(100, 250, 50)).toBe(400);
    expect(somar()).toBe(0);
    expect(subtrair(1000, 250)).toBe(750);
  });

  it("aplica fator e percentual", () => {
    expect(aplicarFator(10000, 1.15)).toBe(11500);
    expect(aplicarPercentual(10000, 10)).toBe(1000);
    expect(descontarPercentual(10000, 10)).toBe(9000);
    expect(descontarPercentual(189990, 7)).toBe(176691);
  });

  it("calcula percentual e protege contra divisão por zero", () => {
    expect(percentualDe(2500, 10000)).toBe(25);
    expect(percentualDe(1, 3)).toBe(33.33);
    expect(percentualDe(500, 0)).toBe(0);
  });

  it("arredonda para múltiplos", () => {
    expect(arredondarPara(12345, 100)).toBe(12300);
    expect(pisoPara(12399, 100)).toBe(12300);
    expect(tetoPara(12301, 100)).toBe(12400);
    expect(tetoPara(12300, 100)).toBe(12300);
    expect(() => arredondarPara(100, 0)).toThrow(TypeError);
    expect(() => pisoPara(100, -1)).toThrow(TypeError);
    expect(() => tetoPara(100, 0)).toThrow(TypeError);
  });

  it("compara", () => {
    expect(maior(10, 20)).toBe(20);
    expect(menor(10, 20)).toBe(10);
  });
});

describe("formatação", () => {
  it("formata em real brasileiro", () => {
    expect(formatarBRL(123456)).toBe("R$ 1.234,56");
    expect(formatarBRL(100)).toBe("R$ 1,00");
    expect(formatarBRL(5)).toBe("R$ 0,05");
    expect(formatarBRL(0)).toBe("R$ 0,00");
    expect(formatarBRL(-25000)).toBe("-R$ 250,00");
    expect(formatarBRL(123456789)).toBe("R$ 1.234.567,89");
  });

  it("formata percentual sem casa desnecessária", () => {
    expect(formatarPercentual(10)).toBe("10%");
    expect(formatarPercentual(7.5)).toBe("7,5%");
    expect(formatarPercentual(3.333)).toBe("3,33%");
  });
});

describe("leitura de valor escrito em português", () => {
  it("entende os formatos usados numa conversa", () => {
    expect(analisarMoedaBR("R$ 1.234,56")).toBe(123456);
    expect(analisarMoedaBR("R$1234,56")).toBe(123456);
    expect(analisarMoedaBR("1.899")).toBe(189900);
    expect(analisarMoedaBR("2800")).toBe(280000);
    expect(analisarMoedaBR("12,5")).toBe(1250);
    expect(analisarMoedaBR("1234.56")).toBe(123456);
    expect(analisarMoedaBR("-R$ 100,00")).toBe(-10000);
  });

  it("devolve null quando não é número", () => {
    expect(analisarMoedaBR("")).toBeNull();
    expect(analisarMoedaBR("preço")).toBeNull();
    expect(analisarMoedaBR("R$")).toBeNull();
    expect(analisarMoedaBR("1,2,3")).toBeNull();
  });
});
