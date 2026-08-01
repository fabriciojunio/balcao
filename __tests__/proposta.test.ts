import { describe, expect, it } from "vitest";
import { reais } from "../lib/dinheiro.js";
import { montarPropostaTroca, valoresDaProposta } from "../lib/dominio/proposta.js";
import { cotarUsado, type CotacaoAceita } from "../lib/dominio/troca.js";
import { AGORA, acessorio, iphoneNovo, politica, regraTroca, tabelaParcelamento } from "./fixtures.js";

function cotacaoDe(defeitos: string[] = [], estado = "bom"): CotacaoAceita {
  const r = cotarUsado({
    modelo: "Galaxy S22 128 GB",
    valorBase: reais(1200),
    estadoDeclarado: estado,
    defeitos,
    agora: AGORA,
    regra: regraTroca,
  });
  if (r.recusado) throw new Error("fixture não deveria recusar");
  return r;
}

const comum = { produto: iphoneNovo, politica, tabelaParcelamento, agora: AGORA };

describe("proposta de troca", () => {
  it("calcula a diferença a pagar", () => {
    const r = montarPropostaTroca({ ...comum, precoNegociado: reais(3072), cotacao: cotacaoDe() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.valorAparelhoUsado).toBe(reais(1104));
    expect(r.value.diferencaAPagar).toBe(reais(1968));
    expect(r.value.margemResultantePercentual).toBe(12.11);
    expect(r.value.exigeAprovacaoHumana).toBe(false);
    expect(r.value.parcelamento).toBeNull();
  });

  it("parcela a diferença, não o preço cheio", () => {
    const r = montarPropostaTroca({
      ...comum,
      precoNegociado: reais(3072),
      cotacao: cotacaoDe(),
      parcelas: 10,
    });
    if (!r.ok) throw new Error(r.error.message);

    expect(r.value.parcelamento?.total).toBe(reais(2214));
    expect(r.value.parcelamento?.valorParcela).toBe(reais(221.4));
    expect(r.value.parcelamento?.taxaPercentual).toBe(12.5);
  });

  it("recusa parcelamento sem taxa cadastrada", () => {
    const r = montarPropostaTroca({
      ...comum,
      precoNegociado: reais(3072),
      cotacao: cotacaoDe(),
      parcelas: 7,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDACAO");
  });

  it("recusa cotação vencida", () => {
    const cotacao = cotacaoDe();
    const r = montarPropostaTroca({
      ...comum,
      agora: new Date(cotacao.validadeAte.getTime() + 1000),
      precoNegociado: reais(3072),
      cotacao,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONFLITO");
  });

  it("recusa preço negociado abaixo do piso", () => {
    const r = montarPropostaTroca({ ...comum, precoNegociado: reais(2900), cotacao: cotacaoDe() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDACAO");
    expect(r.error.detalhes?.piso).toBe(reais(3072));
  });
});

describe("aprovação humana", () => {
  it("exige aprovação quando a loja ficaria pagando a diferença", () => {
    const r = montarPropostaTroca({
      ...comum,
      produto: acessorio,
      precoNegociado: acessorio.precoTabela,
      cotacao: cotacaoDe(),
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.diferencaAPagar).toBeLessThan(0);
    expect(r.value.exigeAprovacaoHumana).toBe(true);
    expect(r.value.motivosDeAprovacao.join(" ")).toContain("pagando diferença");
  });

  it("exige aprovação quando a avaliação tem item fora da tabela", () => {
    const r = montarPropostaTroca({
      ...comum,
      precoNegociado: reais(3072),
      cotacao: cotacaoDe(["camera_embacada"]),
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.exigeAprovacaoHumana).toBe(true);
    expect(r.value.motivosDeAprovacao.join(" ")).toContain("fora da tabela");
  });

  it("exige aprovação quando o desconto passa da alçada", () => {
    const alcadaBaixa = { ...politica, alcadaAprovacaoHumana: reais(50) };
    const r = montarPropostaTroca({
      ...comum,
      politica: alcadaBaixa,
      precoNegociado: reais(3072),
      cotacao: cotacaoDe(),
    });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value.motivosDeAprovacao.join(" ")).toContain("alçada");
  });
});

describe("valores liberados para o auditor", () => {
  it("lista tudo que pode aparecer no texto", () => {
    const r = montarPropostaTroca({
      ...comum,
      precoNegociado: reais(3072),
      cotacao: cotacaoDe(),
      parcelas: 10,
    });
    if (!r.ok) throw new Error(r.error.message);

    const valores = valoresDaProposta(r.value);
    expect(valores).toContain(reais(3072));
    expect(valores).toContain(reais(1104));
    expect(valores).toContain(reais(1968));
    expect(valores).toContain(reais(2214));
    expect(valores).toHaveLength(6);
  });

  it("sem parcelamento, lista só os três valores da troca", () => {
    const r = montarPropostaTroca({ ...comum, precoNegociado: reais(3072), cotacao: cotacaoDe() });
    if (!r.ok) throw new Error(r.error.message);
    expect(valoresDaProposta(r.value)).toHaveLength(3);
  });
});
