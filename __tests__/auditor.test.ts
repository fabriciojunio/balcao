import { describe, expect, it } from "vitest";
import { reais } from "../lib/dinheiro.js";
import {
  aplicarMarcadores,
  auditarMensagem,
  contextoDe,
  extrairOcorrencias,
  marcadoresDe,
  resumirViolacoes,
  valoresMonetarios,
} from "../lib/auditor/index.js";
import { contextoBase } from "./fixtures.js";

describe("extração de números", () => {
  it("reconhece dinheiro escrito de várias formas", () => {
    expect(valoresMonetarios("de R$ 3.200,00 por R$ 3.072,00")).toEqual([320000, 307200]);
    expect(valoresMonetarios("R$1234,56")).toEqual([123456]);
    expect(valoresMonetarios("fica 1.899 à vista")).toEqual([189900]);
  });

  it("separa percentual, parcelas e dado técnico", () => {
    const tipos = extrairOcorrencias("iPhone 14 128 GB com 10% em 12x").map((o) => `${o.tipo}:${o.valor}`);
    expect(tipos).toEqual(["solto:14", "tecnico:128", "percentual:10", "parcelas:12"]);
  });

  it("não confunde nome de modelo com número", () => {
    const ocorrencias = extrairOcorrencias("Galaxy S22 e Moto G84");
    expect(ocorrencias).toHaveLength(0);
  });

  it("marca número solto que provavelmente é preço mal escrito", () => {
    const ocorrencias = extrairOcorrencias("sai por 3072");
    expect(ocorrencias).toEqual([{ tipo: "solto", bruto: "3072", valor: 3072, indice: 8 }]);
  });
});

describe("auditoria de mensagem", () => {
  const contexto = contextoDe({
    monetariosPermitidos: [reais(3200), reais(3072), reais(306.66)],
    percentuaisPermitidos: [4],
    parcelasPermitidas: [12],
    numerosPermitidos: [128],
  });

  it("aprova mensagem com todo valor conferido", () => {
    const texto = "O iPhone 14 128 GB sai de R$ 3.200,00 por R$ 3.072,00, ou 12x de R$ 306,66.";
    const r = auditarMensagem(texto, contexto);
    expect(r.aprovado).toBe(true);
    expect(resumirViolacoes(r)).toBe("sem violações");
  });

  it("bloqueia valor que nenhuma ferramenta devolveu", () => {
    const r = auditarMensagem("Consigo fazer por R$ 2.800,00 pra você.", contexto);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("monetario_nao_autorizado");
    expect(r.violacoes[0]?.trecho).toBe("R$ 2.800,00");
  });

  it("bloqueia preço escrito sem formatação", () => {
    const r = auditarMensagem("Fica em 3072 no pix.", contexto);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("numero_sem_formatacao");
  });

  it("bloqueia percentual inventado", () => {
    const r = auditarMensagem("Te dou 15% de desconto.", contexto);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("percentual_nao_autorizado");
  });

  it("bloqueia parcelamento fora da simulação", () => {
    const r = auditarMensagem("Pode ser em 18x tranquilo.", contexto);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("parcelas_nao_autorizada");
  });

  it("bloqueia marcador que ficou sem resolver", () => {
    const r = auditarMensagem("Fica em {{preco_avista}}.", contexto);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes.some((v) => v.tipo === "marcador_nao_resolvido")).toBe(true);
  });

  it("bloqueia promessa que a loja não autorizou", () => {
    const comFrases = contextoDe({ ...contexto, frasesProibidas: ["garantia estendida", "eu garanto"] });
    const r = auditarMensagem("Leva com garantia estendida de fábrica.", comFrases);
    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("frase_proibida");
  });

  it("pega frase proibida escrita com acento diferente", () => {
    const comFrases = contextoDe({ ...contexto, frasesProibidas: ["entrega em casa"] });
    const r = auditarMensagem("Fazemos ENTREGA EM CASA sim.", comFrases);
    expect(r.aprovado).toBe(false);
  });

  it("acumula todas as violações em vez de parar na primeira", () => {
    const r = auditarMensagem("Por R$ 2.800,00 em 18x com 30% de desconto.", contexto);
    expect(r.violacoes).toHaveLength(3);
    expect(resumirViolacoes(r)).toContain("monetario_nao_autorizado");
  });

  it("respeita tolerância quando configurada", () => {
    const tolerante = contextoDe({ monetariosPermitidos: [reais(1000)], toleranciaCentavos: 100 });
    expect(auditarMensagem("R$ 1.000,99", tolerante).aprovado).toBe(true);
    expect(auditarMensagem("R$ 1.002,00", tolerante).aprovado).toBe(false);
  });

  it("libera os números públicos da loja", () => {
    const r = auditarMensagem("Estamos na Rua das Palmeiras, 1500, aparelho de 128 GB.", contextoBase);
    expect(r.aprovado).toBe(true);
  });

  it("bloqueia telefone que não é o da loja", () => {
    const r = auditarMensagem("Me chama no 988887777.", contextoBase);
    expect(r.aprovado).toBe(false);
  });
});

describe("marcadores", () => {
  it("substitui os valores fornecidos pelo sistema", () => {
    const r = aplicarMarcadores("Fica em {{preco}} ou {{parcelas}} sem juros.", {
      preco: "R$ 3.072,00",
      parcelas: "10x",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.texto).toBe("Fica em R$ 3.072,00 ou 10x sem juros.");
    expect([...r.value.usados].sort()).toEqual(["parcelas", "preco"]);
  });

  it("aceita espaço e maiúscula dentro do marcador", () => {
    const r = aplicarMarcadores("{{ PRECO }}", { preco: "R$ 10,00" });
    expect(r.ok && r.value.texto).toBe("R$ 10,00");
  });

  it("recusa quando falta valor para um marcador", () => {
    const r = aplicarMarcadores("Fica em {{preco}} com {{brinde}}.", { preco: "R$ 1,00" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.detalhes?.marcadores).toEqual(["brinde"]);
  });

  it("recusa chave solta que sobrou no texto", () => {
    const r = aplicarMarcadores("Fica em {{ e pronto", { preco: "R$ 1,00" });
    expect(r.ok).toBe(false);
  });

  it("lista os marcadores de um texto", () => {
    expect(marcadoresDe("{{a}} e {{B}} e {{a}}").sort()).toEqual(["a", "b"]);
    expect(marcadoresDe("sem marcador")).toEqual([]);
  });
});

describe("tentativas adversariais", () => {
  const contexto = contextoDe({ monetariosPermitidos: [reais(3072)], parcelasPermitidas: [12] });

  const tentativas: Array<[string, string]> = [
    ["preço colado sem espaço", "Sai por R$2800,00"],
    ["preço com separador trocado", "Sai por R$ 2,800.00"],
    ["preço escrito por extenso e numeral", "Sai por 2800 reais"],
    ["valor no meio de frase longa", "Olha, considerando tudo que conversamos até aqui, consigo liberar 2900 pra fechar hoje"],
    ["milhar sem símbolo", "Fecho em 2.900"],
    ["desconto percentual improvisado", "Faço 12% de desconto"],
    ["parcelamento inventado", "Divido em 24x sem juros"],
    ["valor negativo", "Te devolvo R$ -50,00"],
  ];

  it.each(tentativas)("bloqueia: %s", (_nome, texto) => {
    expect(auditarMensagem(texto, contexto).aprovado).toBe(false);
  });

  it("deixa passar somente o valor autorizado", () => {
    expect(auditarMensagem("Fecho em R$ 3.072,00 em 12x.", contexto).aprovado).toBe(true);
  });
});
