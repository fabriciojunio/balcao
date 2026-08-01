import { describe, expect, it } from "vitest";
import {
  ESTADOS,
  agenteEstaMudo,
  ferramentasDisponiveis,
  motivoParaEscalar,
  podeUsar,
  transicaoValida,
  transicionar,
  type EstadoConversa,
  type LimitesEscalonamento,
  type SituacaoEscalonamento,
} from "../lib/dominio/conversa.js";

describe("transições", () => {
  it("caminha o fluxo padrão de uma venda", () => {
    let estado: EstadoConversa = "recepcao";
    estado = transicionar(estado, "intencao_identificada");
    expect(estado).toBe("descoberta");
    estado = transicionar(estado, "produto_escolhido");
    expect(estado).toBe("apresentacao");
    estado = transicionar(estado, "pediu_desconto");
    expect(estado).toBe("negociacao");
    estado = transicionar(estado, "acordo");
    expect(estado).toBe("fechamento");
  });

  it("caminha o fluxo de troca", () => {
    let estado: EstadoConversa = "descoberta";
    estado = transicionar(estado, "ofereceu_aparelho");
    expect(estado).toBe("avaliacao_usado");
    estado = transicionar(estado, "avaliacao_concluida");
    expect(estado).toBe("negociacao");
  });

  it("volta para apresentação quando o aparelho é recusado", () => {
    expect(transicionar("avaliacao_usado", "aparelho_recusado")).toBe("apresentacao");
  });

  it("escala de qualquer estado que fale com o cliente", () => {
    const falantes: EstadoConversa[] = [
      "recepcao",
      "descoberta",
      "apresentacao",
      "avaliacao_usado",
      "negociacao",
      "fechamento",
      "retomada",
    ];
    for (const estado of falantes) {
      expect(transicionar(estado, "escalar")).toBe("atendimento_humano");
    }
  });

  it("ignora evento sem sentido no estado atual", () => {
    expect(transicionar("recepcao", "acordo")).toBe("recepcao");
    expect(transicaoValida("recepcao", "acordo")).toBe(false);
    expect(transicaoValida("recepcao", "intencao_identificada")).toBe(true);
  });

  it("impasse na negociação vai para gente", () => {
    expect(transicionar("negociacao", "impasse")).toBe("atendimento_humano");
  });

  it("silêncio vira retomada e o retorno do cliente reabre a conversa", () => {
    expect(transicionar("apresentacao", "silencio")).toBe("retomada");
    expect(transicionar("retomada", "cliente_voltou")).toBe("descoberta");
    expect(transicionar("encerrada", "cliente_voltou")).toBe("recepcao");
  });

  it("o vendedor devolve a conversa para o agente", () => {
    expect(transicionar("atendimento_humano", "humano_devolveu")).toBe("descoberta");
  });
});

describe("ferramentas por estado", () => {
  it("não libera ferramenta de preço antes de haver produto escolhido", () => {
    expect(podeUsar("descoberta", "avaliar_desconto")).toBe(false);
    expect(podeUsar("descoberta", "consultar_estoque")).toBe(true);
  });

  it("só negocia no estado de negociação", () => {
    expect(podeUsar("negociacao", "avaliar_desconto")).toBe(true);
    expect(podeUsar("apresentacao", "avaliar_desconto")).toBe(false);
  });

  it("só reserva no fechamento", () => {
    expect(podeUsar("fechamento", "reservar_produto")).toBe(true);
    expect(podeUsar("negociacao", "reservar_produto")).toBe(false);
  });

  it("escalar para humano vale em qualquer estado", () => {
    for (const estado of ESTADOS) {
      expect(podeUsar(estado, "escalar_humano")).toBe(true);
      expect(ferramentasDisponiveis(estado)).toContain("escalar_humano");
    }
  });

  it("o agente fica mudo quando um vendedor assume ou a conversa encerra", () => {
    expect(agenteEstaMudo("atendimento_humano")).toBe(true);
    expect(agenteEstaMudo("encerrada")).toBe(true);
    expect(agenteEstaMudo("negociacao")).toBe(false);
  });
});

describe("decisão de escalonamento", () => {
  const limites: LimitesEscalonamento = { maxFalhasAuditor: 2, maxRodadasNegociacao: 3 };
  const calmo: SituacaoEscalonamento = {
    falhasAuditor: 0,
    rodadasNegociacao: 0,
    clienteFrustrado: false,
    clientePediuHumano: false,
    avaliacaoHumanaNecessaria: false,
    valorAcimaAlcada: false,
  };

  it("não escala sem motivo", () => {
    expect(motivoParaEscalar(calmo, limites)).toBeNull();
  });

  it("pedido do cliente vem antes de tudo", () => {
    const situacao = { ...calmo, clientePediuHumano: true, falhasAuditor: 5, clienteFrustrado: true };
    expect(motivoParaEscalar(situacao, limites)).toBe("pedido_do_cliente");
  });

  it("duas falhas do auditor encerram a atuação da IA", () => {
    expect(motivoParaEscalar({ ...calmo, falhasAuditor: 1 }, limites)).toBeNull();
    expect(motivoParaEscalar({ ...calmo, falhasAuditor: 2 }, limites)).toBe("falha_auditor");
  });

  it("reconhece os demais gatilhos na ordem de gravidade", () => {
    expect(motivoParaEscalar({ ...calmo, clienteFrustrado: true }, limites)).toBe("frustracao");
    expect(motivoParaEscalar({ ...calmo, valorAcimaAlcada: true }, limites)).toBe("valor_acima_alcada");
    expect(motivoParaEscalar({ ...calmo, avaliacaoHumanaNecessaria: true }, limites)).toBe(
      "avaliacao_humana_necessaria",
    );
    expect(motivoParaEscalar({ ...calmo, rodadasNegociacao: 4 }, limites)).toBe("fora_de_escopo");
    expect(motivoParaEscalar({ ...calmo, rodadasNegociacao: 3 }, limites)).toBeNull();
  });
});
