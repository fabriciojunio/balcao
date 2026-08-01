import { describe, expect, it } from "vitest";
import { formatarBRL, reais } from "../lib/dinheiro.js";
import {
  avaliarDesconto,
  margemPercentual,
  melhorOfertaDaRodada,
  opcoesDeParcelamento,
  pisoDePreco,
  precoMinimoPorMargem,
  produtoTemDescontoBloqueado,
  simularParcelamento,
  validarPolitica,
  type PoliticaPreco,
} from "../lib/dominio/preco.js";
import { acessorio, iphoneNovo, lancamento, politica, seminovoApertado, tabelaParcelamento } from "./fixtures.js";

describe("piso de preço", () => {
  it("usa o teto de desconto quando a margem é folgada", () => {
    // 4% de teto sobre R$ 3.200,00 dá R$ 3.072,00, acima do mínimo por margem.
    expect(precoMinimoPorMargem(iphoneNovo, politica)).toBe(296703);
    expect(pisoDePreco(iphoneNovo, politica)).toBe(reais(3072));
  });

  it("usa a margem mínima quando ela é mais restritiva que o teto", () => {
    // O seminovo tem margem tão apertada que o piso encosta no preço de tabela.
    expect(pisoDePreco(seminovoApertado, politica)).toBe(seminovoApertado.precoTabela);
  });

  it("nunca devolve piso acima do preço de tabela", () => {
    const caro = { ...seminovoApertado, custo: reais(1795) };
    expect(pisoDePreco(caro, politica)).toBeLessThanOrEqual(caro.precoTabela);
  });

  it("trata margem mínima zero", () => {
    const semMargem: PoliticaPreco = { ...politica, margemMinimaPercentual: 0 };
    expect(precoMinimoPorMargem(iphoneNovo, semMargem)).toBe(iphoneNovo.custo);
  });
});

describe("margem", () => {
  it("calcula sobre o preço de venda", () => {
    expect(margemPercentual(reais(100), reais(80))).toBe(20);
    expect(margemPercentual(reais(3072), reais(2700))).toBe(12.11);
  });
});

describe("concessão por rodada", () => {
  it("não cede nada na primeira rodada", () => {
    expect(melhorOfertaDaRodada(iphoneNovo, politica, 0)).toBe(iphoneNovo.precoTabela);
  });

  it("cede o percentual da rodada", () => {
    expect(melhorOfertaDaRodada(iphoneNovo, politica, 1)).toBe(reais(3136));
    expect(melhorOfertaDaRodada(iphoneNovo, politica, 2)).toBe(reais(3072));
  });

  it("trava na última rodada por mais que o cliente insista", () => {
    expect(melhorOfertaDaRodada(iphoneNovo, politica, 9)).toBe(reais(3072));
    expect(melhorOfertaDaRodada(iphoneNovo, politica, 99)).toBe(pisoDePreco(iphoneNovo, politica));
  });

  it("aceita rodada negativa sem quebrar", () => {
    expect(melhorOfertaDaRodada(iphoneNovo, politica, -3)).toBe(iphoneNovo.precoTabela);
  });

  it("devolve o preço de tabela quando não há rodadas configuradas", () => {
    const semRodadas: PoliticaPreco = { ...politica, concessaoPorRodada: [] };
    expect(melhorOfertaDaRodada(iphoneNovo, semRodadas, 0)).toBe(iphoneNovo.precoTabela);
  });
});

describe("avaliação de desconto", () => {
  it("aprova valor pedido dentro da margem", () => {
    const r = avaliarDesconto({ produto: iphoneNovo, politica, valorPedido: reais(3100), rodada: 1 });
    expect(r.situacao).toBe("aprovado");
    expect(r.precoFinal).toBe(reais(3100));
    expect(r.descontoValor).toBe(reais(100));
    expect(r.exigeAprovacaoHumana).toBe(false);
  });

  it("aprova sem desconto quando o cliente oferece o preço cheio ou mais", () => {
    const r = avaliarDesconto({ produto: iphoneNovo, politica, valorPedido: reais(3500), rodada: 0 });
    expect(r.situacao).toBe("aprovado");
    expect(r.precoFinal).toBe(iphoneNovo.precoTabela);
    expect(r.descontoValor).toBe(0);
  });

  it("contrapropõe no piso quando o pedido fura a política", () => {
    const r = avaliarDesconto({ produto: iphoneNovo, politica, valorPedido: reais(2800), rodada: 2 });
    expect(r.situacao).toBe("contraproposta");
    expect(r.precoFinal).toBe(reais(3072));
    expect(r.motivo).toContain(formatarBRL(reais(3072)));
  });

  it("nunca desce abaixo do piso, em nenhuma rodada", () => {
    const piso = pisoDePreco(iphoneNovo, politica);
    for (let rodada = 0; rodada < 50; rodada++) {
      const r = avaliarDesconto({ produto: iphoneNovo, politica, valorPedido: reais(1), rodada });
      expect(r.precoFinal).toBeGreaterThanOrEqual(piso);
      expect(r.margemResultantePercentual).toBeGreaterThanOrEqual(politica.margemMinimaPercentual);
    }
  });

  it("recusa desconto em produto etiquetado", () => {
    expect(produtoTemDescontoBloqueado(lancamento, politica)).toBe(true);
    const r = avaliarDesconto({ produto: lancamento, politica, valorPedido: reais(6000), rodada: 3 });
    expect(r.situacao).toBe("recusado");
    expect(r.precoFinal).toBe(lancamento.precoTabela);
    expect(r.descontoValor).toBe(0);
  });

  it("oferece espontaneamente quando o cliente só pergunta se tem desconto", () => {
    const primeira = avaliarDesconto({ produto: iphoneNovo, politica, rodada: 0 });
    expect(primeira.situacao).toBe("recusado");

    const segunda = avaliarDesconto({ produto: iphoneNovo, politica, rodada: 1 });
    expect(segunda.situacao).toBe("contraproposta");
    expect(segunda.precoFinal).toBe(reais(3136));
  });

  it("marca a proposta para aprovação humana acima da alçada", () => {
    const alcadaBaixa: PoliticaPreco = { ...politica, alcadaAprovacaoHumana: reais(50) };
    const r = avaliarDesconto({ produto: iphoneNovo, politica: alcadaBaixa, valorPedido: reais(3100), rodada: 1 });
    expect(r.exigeAprovacaoHumana).toBe(true);
  });

  it("não desconta produto de margem apertada", () => {
    const r = avaliarDesconto({ produto: seminovoApertado, politica, valorPedido: reais(1700), rodada: 2 });
    expect(r.precoFinal).toBe(seminovoApertado.precoTabela);
    expect(r.descontoValor).toBe(0);
  });

  it("limita a contraproposta pela rodada, não pelo teto da categoria", () => {
    // O acessório tem teto de 15% (piso R$ 68,00), mas a concessão da rodada 2
    // é de 4%. Quem manda é a rodada: o teto é limite, não é oferta.
    expect(pisoDePreco(acessorio, politica)).toBe(reais(68));
    const r = avaliarDesconto({ produto: acessorio, politica, valorPedido: reais(60), rodada: 2 });
    expect(r.situacao).toBe("contraproposta");
    expect(r.precoFinal).toBe(reais(76.8));
  });
});

describe("parcelamento", () => {
  it("usa a taxa real da loja", () => {
    const r = simularParcelamento(reais(3200), 12, tabelaParcelamento);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.taxaPercentual).toBe(15);
    expect(r.value.total).toBe(reais(3680));
    expect(r.value.valorParcela).toBe(30666);
    expect(r.value.primeiraParcela).toBe(30674);
    expect(r.value.acrescimo).toBe(reais(480));
    expect(r.value.valorParcela * 11 + r.value.primeiraParcela).toBe(r.value.total);
  });

  it("à vista não tem acréscimo", () => {
    const r = simularParcelamento(reais(3200), 1, tabelaParcelamento);
    expect(r.ok && r.value.total).toBe(reais(3200));
    expect(r.ok && r.value.acrescimo).toBe(0);
  });

  it("recusa parcelamento sem taxa cadastrada em vez de estimar", () => {
    const r = simularParcelamento(reais(3200), 7, tabelaParcelamento);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDACAO");
    expect(r.error.detalhes?.parcelasDisponiveis).toEqual([1, 2, 3, 4, 5, 6, 10, 12]);
  });

  it("recusa entrada inválida", () => {
    expect(simularParcelamento(reais(100), 0, tabelaParcelamento).ok).toBe(false);
    expect(simularParcelamento(reais(100), 2.5, tabelaParcelamento).ok).toBe(false);
    expect(simularParcelamento(0, 2, tabelaParcelamento).ok).toBe(false);
  });

  it("lista todas as opções em ordem", () => {
    const opcoes = opcoesDeParcelamento(reais(3200), tabelaParcelamento);
    expect(opcoes.map((o) => o.parcelas)).toEqual([1, 2, 3, 4, 5, 6, 10, 12]);
    expect(opcoes.every((o) => o.total >= reais(3200))).toBe(true);
  });
});

describe("validação da política", () => {
  it("aceita a política do arquivo de exemplo", () => {
    expect(validarPolitica(politica).ok).toBe(true);
  });

  it("recusa margem fora da faixa", () => {
    expect(validarPolitica({ ...politica, margemMinimaPercentual: 100 }).ok).toBe(false);
    expect(validarPolitica({ ...politica, margemMinimaPercentual: -1 }).ok).toBe(false);
  });

  it("recusa teto de desconto inválido", () => {
    const invalida = {
      ...politica,
      tetoDescontoPercentual: { ...politica.tetoDescontoPercentual, seminovo: 120 },
    };
    expect(validarPolitica(invalida).ok).toBe(false);
  });

  it("recusa concessão que diminui ao longo da negociação", () => {
    expect(validarPolitica({ ...politica, concessaoPorRodada: [5, 2] }).ok).toBe(false);
    expect(validarPolitica({ ...politica, concessaoPorRodada: [-1] }).ok).toBe(false);
  });

  it("recusa arredondamento e alçada inválidos", () => {
    expect(validarPolitica({ ...politica, arredondamentoCentavos: 0 }).ok).toBe(false);
    expect(validarPolitica({ ...politica, alcadaAprovacaoHumana: -1 }).ok).toBe(false);
  });
});
