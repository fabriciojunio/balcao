import { describe, expect, it } from "vitest";
import { contextoDe } from "../lib/auditor/index.js";
import { reais } from "../lib/dinheiro.js";
import { contextoComValores, processarResposta, type EntradaPipeline } from "../lib/pipeline.js";

const contexto = contextoDe({
  monetariosPermitidos: [reais(3072)],
  parcelasPermitidas: [12],
});

function entrada(parcial: Partial<EntradaPipeline>): EntradaPipeline {
  return {
    bruto: {},
    estado: "negociacao",
    valores: {},
    contexto,
    tentativa: 1,
    maxTentativas: 2,
    ...parcial,
  };
}

describe("resposta de texto", () => {
  it("envia quando marcadores e auditoria passam", () => {
    const d = processarResposta(
      entrada({
        bruto: { acao: "responder", texto: "Fecho em {{preco}}." },
        valores: { preco: "R$ 3.072,00" },
      }),
    );
    expect(d).toEqual({ tipo: "enviar", texto: "Fecho em R$ 3.072,00." });
  });

  it("manda repetir quando o modelo inventa um valor", () => {
    const d = processarResposta(
      entrada({ bruto: { acao: "responder", texto: "Fecho em R$ 2.800,00." } }),
    );
    expect(d.tipo).toBe("repetir");
    if (d.tipo !== "repetir") return;
    expect(d.motivo).toContain("auditoria");
    expect(d.violacoes[0]?.tipo).toBe("monetario_nao_autorizado");
  });

  it("escala em vez de repetir quando as tentativas acabaram", () => {
    const d = processarResposta(
      entrada({ bruto: { acao: "responder", texto: "Fecho em R$ 2.800,00." }, tentativa: 2 }),
    );
    expect(d.tipo).toBe("escalar");
    if (d.tipo !== "escalar") return;
    expect(d.motivo).toBe("falha_auditor");
  });

  it("manda repetir quando falta valor para um marcador", () => {
    const d = processarResposta(entrada({ bruto: { acao: "responder", texto: "Fica {{preco}}." } }));
    expect(d.tipo).toBe("repetir");
    if (d.tipo !== "repetir") return;
    expect(d.motivo).toContain("marcador");
  });
});

describe("chamada de ferramenta", () => {
  it("aceita ferramenta disponível no estado", () => {
    const d = processarResposta(
      entrada({
        bruto: { acao: "chamar_ferramenta", ferramenta: "avaliar_desconto", argumentos: { produto_id: "p-001" } },
      }),
    );
    expect(d).toEqual({
      tipo: "chamar_ferramenta",
      ferramenta: "avaliar_desconto",
      argumentos: { produto_id: "p-001" },
    });
  });

  it("recusa ferramenta que não existe", () => {
    const d = processarResposta(
      entrada({ bruto: { acao: "chamar_ferramenta", ferramenta: "dar_desconto_geral", argumentos: {} } }),
    );
    expect(d.tipo).toBe("repetir");
    if (d.tipo !== "repetir") return;
    expect(d.motivo).toContain("ferramenta_inexistente");
  });

  it("recusa ferramenta fora do estado atual", () => {
    const d = processarResposta(
      entrada({
        estado: "descoberta",
        bruto: { acao: "chamar_ferramenta", ferramenta: "reservar_produto", argumentos: {} },
      }),
    );
    expect(d.tipo).toBe("repetir");
    if (d.tipo !== "repetir") return;
    expect(d.motivo).toContain("fora_do_estado");
  });

  it("aceita argumentos ausentes", () => {
    const d = processarResposta(
      entrada({ bruto: { acao: "chamar_ferramenta", ferramenta: "consultar_estoque" }, estado: "descoberta" }),
    );
    expect(d.tipo).toBe("chamar_ferramenta");
  });
});

describe("formato da resposta", () => {
  it("repete quando o modelo devolve qualquer outra coisa", () => {
    for (const bruto of ["texto solto", null, { acao: "inventada" }, { acao: "responder" }]) {
      const d = processarResposta(entrada({ bruto }));
      expect(d.tipo).toBe("repetir");
    }
  });

  it("respeita o pedido explícito de escalar", () => {
    const d = processarResposta(
      entrada({ bruto: { acao: "escalar", motivo: "frustracao", resumo: "cliente irritado" } }),
    );
    expect(d).toEqual({ tipo: "escalar", motivo: "frustracao", detalhe: "cliente irritado" });
  });
});

describe("contexto da rodada", () => {
  it("soma os valores das ferramentas ao contexto base", () => {
    const ampliado = contextoComValores(contexto, {
      monetarios: [reais(3200)],
      percentuais: [4],
      parcelas: [10],
      numeros: [128],
    });
    expect(ampliado.monetariosPermitidos).toEqual([reais(3072), reais(3200)]);
    expect(ampliado.percentuaisPermitidos).toEqual([4]);
    expect(ampliado.parcelasPermitidas).toEqual([12, 10]);
    expect(ampliado.numerosPermitidos).toEqual([128]);
  });

  it("não altera o contexto original", () => {
    contextoComValores(contexto, { monetarios: [reais(1)] });
    expect(contexto.monetariosPermitidos).toEqual([reais(3072)]);
  });

  it("aceita rodada sem nenhum valor novo", () => {
    expect(contextoComValores(contexto, {})).toEqual(contexto);
  });
});
