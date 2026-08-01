import { beforeEach, describe, expect, it } from "vitest";
import { criarAdaptadoresMemoria, type AdaptadoresMemoria } from "../lib/adaptadores/memoria.js";
import { reais } from "../lib/dinheiro.js";
import { executarFerramenta, type DependenciasFerramentas } from "../lib/ferramentas/executor.js";
import type { ConversaRegistro, ProdutoEmEstoque, Relogio } from "../lib/portas.js";
import {
  paraPoliticaPreco,
  paraRegraTroca,
  paraTabelaParcelamento,
} from "../lib/tenant/carregar.js";
import { config } from "./fixtures.js";

const relogio: Relogio = { agora: () => new Date("2026-08-03T14:00:00.000Z") };

const PRODUTOS: ProdutoEmEstoque[] = [
  {
    id: "p-001",
    descricao: "iPhone 14 128 GB preto",
    categoria: "novo_lacrado",
    precoTabela: reais(3200),
    custo: reais(2700),
    quantidade: 2,
    memoriaGb: 128,
    cor: "preto",
    garantiaMeses: 12,
    sincronizadoEm: relogio.agora(),
  },
  {
    id: "p-002",
    descricao: "Galaxy S23 256 GB verde",
    categoria: "novo_lacrado",
    precoTabela: reais(3600),
    custo: reais(3050),
    quantidade: 0,
    memoriaGb: 256,
    sincronizadoEm: relogio.agora(),
  },
];

let adaptadores: AdaptadoresMemoria;
let deps: DependenciasFerramentas;
let conversa: ConversaRegistro;

function comMemoria(memoria: Record<string, string>): ConversaRegistro {
  return { ...conversa, memoria };
}

async function chamar(nome: Parameters<typeof executarFerramenta>[0], argumentos: unknown, c = conversa) {
  const r = await executarFerramenta(nome, argumentos, { conversa: c, deps });
  if (!r.ok) throw new Error(r.error.message);
  return { ...r.value, dados: JSON.parse(r.value.textoParaModelo) as Record<string, unknown> };
}

beforeEach(async () => {
  adaptadores = criarAdaptadoresMemoria({
    relogio,
    produtos: PRODUTOS,
    tabelaTroca: { "Galaxy S22": reais(1200) },
  });

  deps = {
    config,
    politica: paraPoliticaPreco(config),
    tabelaParcelamento: paraTabelaParcelamento(config),
    regraTroca: paraRegraTroca(config),
    estoque: adaptadores.estoque,
    tabelaTroca: adaptadores.tabelaTroca,
    avaliacoes: adaptadores.avaliacoes,
    propostas: adaptadores.propostas,
    leads: adaptadores.leads,
    relogio,
    versaoModelo: "simulador:v1",
    versaoPrompt: "p-teste",
  };

  conversa = await adaptadores.conversas.abrirOuRecuperar("5514999990000");
});

describe("validação de argumentos", () => {
  it("recusa argumento fora do contrato", async () => {
    const r = await executarFerramenta("consultar_estoque", { termo: "" }, { conversa, deps });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("VALIDACAO");
  });

  it("anuncia os marcadores disponíveis em toda resposta", async () => {
    const r = await chamar("consultar_estoque", { termo: "iPhone 14" });
    expect(r.dados.marcadores).toContain("preco_1");
  });
});

describe("consultar_estoque", () => {
  it("devolve preço e descrição reais", async () => {
    const r = await chamar("consultar_estoque", { termo: "iPhone" });
    expect(r.valores.preco_1).toBe("R$ 3.200,00");
    expect(r.rodada.monetarios).toContain(reais(3200));
    expect(r.memoria?.produto_id).toBe("p-001");
  });

  it("não lista aparelho sem unidade", async () => {
    const r = await chamar("consultar_estoque", { termo: "Galaxy S23" });
    expect(r.dados.encontrados).toBe(0);
  });

  it("filtra por memória e por preço máximo", async () => {
    const semResultado = await chamar("consultar_estoque", { termo: "iPhone", memoria_gb: 512 });
    expect(semResultado.dados.encontrados).toBe(0);

    const barato = await chamar("consultar_estoque", { termo: "iPhone", preco_maximo_reais: 1000 });
    expect(barato.dados.encontrados).toBe(0);
  });

  it("escala quando o dado do estoque está velho", async () => {
    const velho: Relogio = { agora: () => new Date("2026-08-03T15:00:00.000Z") };
    const r = await executarFerramenta(
      "consultar_estoque",
      { termo: "iPhone" },
      { conversa, deps: { ...deps, relogio: velho } },
    );
    expect(r.ok && r.value.escalar).toBe("fora_de_escopo");
  });
});

describe("detalhar_produto", () => {
  it("traz garantia e marca o produto em foco", async () => {
    const r = await chamar("detalhar_produto", { produto_id: "p-001" });
    expect(r.valores.garantia).toBe("12 meses");
    expect(r.evento).toBe("produto_escolhido");
  });

  it("avisa quando o produto não está disponível", async () => {
    const r = await chamar("detalhar_produto", { produto_id: "p-002" });
    expect(r.dados.erro).toBe("produto_indisponivel");
  });
});

describe("simular_parcelamento", () => {
  it("usa o produto em foco quando não recebe valor", async () => {
    const r = await chamar("simular_parcelamento", {}, comMemoria({ produto_id: "p-001" }));
    expect(r.valores.parcelas).toBe("12x");
    expect(r.valores.total).toBe("R$ 3.680,00");
  });

  it("avisa quando não há valor nem produto em foco", async () => {
    const r = await chamar("simular_parcelamento", {});
    expect(r.dados.erro).toBe("sem_valor_para_simular");
  });

  it("recusa parcelamento fora da tabela e diz o que existe", async () => {
    const r = await chamar("simular_parcelamento", { valor_reais: 1000, parcelas: 7 });
    expect(r.dados.erro).toBe("parcelamento_indisponivel");
    expect(r.dados.parcelas_disponiveis).toEqual([1, 2, 3, 4, 5, 6, 10, 12]);
  });
});

describe("avaliar_desconto", () => {
  it("contrapropõe no limite da rodada", async () => {
    const emNegociacao = { ...comMemoria({ produto_id: "p-001" }), rodadasNegociacao: 1 };
    const r = await chamar("avaliar_desconto", { valor_pedido_reais: 2500 }, emNegociacao);

    expect(r.dados.situacao).toBe("contraproposta");
    expect(r.valores.preco_final).toBe("R$ 3.136,00");
    expect(r.incrementaRodadaNegociacao).toBe(true);
  });

  it("avisa quando não sabe de qual produto se trata", async () => {
    const r = await chamar("avaliar_desconto", {});
    expect(r.dados.erro).toBe("sem_produto_em_foco");
  });

  it("escala quando o desconto passa da alçada", async () => {
    const alcadaBaixa = { ...deps, politica: { ...deps.politica, alcadaAprovacaoHumana: reais(10) } };
    const r = await executarFerramenta(
      "avaliar_desconto",
      { valor_pedido_reais: 3100 },
      { conversa: comMemoria({ produto_id: "p-001" }), deps: alcadaBaixa },
    );
    expect(r.ok && r.value.escalar).toBe("valor_acima_alcada");
  });
});

describe("avaliação de usado", () => {
  it("abre o checklist e usa o nome da tabela, não a frase do cliente", async () => {
    const r = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "quero trocar meu galaxy s22" });
    expect(r.memoria?.usado_modelo).toBe("Galaxy S22");
    expect(r.valores.pergunta).toContain("bloqueando");
  });

  it("escala quando o modelo não está na tabela", async () => {
    const r = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "Xiaomi Poco X6" });
    expect(r.dados.erro).toBe("modelo_sem_tabela");
    expect(r.escalar).toBe("avaliacao_humana_necessaria");
  });

  it("traduz a resposta livre do cliente e avança uma pergunta por vez", async () => {
    const abertura = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "Galaxy S22" });
    const avaliacaoId = abertura.memoria!.avaliacao_id!;
    const emAvaliacao = comMemoria({ avaliacao_id: avaliacaoId });

    const r = await chamar("cotar_usado", { resposta_livre: "não, sem bloqueio" }, emAvaliacao);
    expect(r.dados.faltam).toBe(true);
    expect(r.dados.chave_atual).toBe("liga_normalmente");
  });

  it("cota quando o checklist termina", async () => {
    const abertura = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "Galaxy S22" });
    const emAvaliacao = comMemoria({ avaliacao_id: abertura.memoria!.avaliacao_id! });

    const r = await chamar(
      "cotar_usado",
      {
        respostas: {
          bloqueio_conta: "nao",
          liga_normalmente: "sim",
          tela: "tela_trincada",
          bateria: "nao_sei",
          carcaca: "integra",
          acessorios: "caixa_e_nota",
        },
      },
      emAvaliacao,
    );

    expect(r.valores.faixa_max).toBe("R$ 684,00");
    expect(r.valores.validade).toMatch(/\d{2}\/\d{2} às \d{2}:\d{2}/);
    expect(r.evento).toBe("avaliacao_concluida");
  });

  it("recusa aparelho bloqueado", async () => {
    const abertura = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "Galaxy S22" });
    const emAvaliacao = comMemoria({ avaliacao_id: abertura.memoria!.avaliacao_id! });

    const r = await chamar(
      "cotar_usado",
      {
        respostas: {
          bloqueio_conta: "sim",
          liga_normalmente: "sim",
          tela: "sem_marca",
          bateria: "acima_85",
          carcaca: "integra",
          acessorios: "caixa_e_nota",
        },
      },
      emAvaliacao,
    );

    expect(r.dados.recusado).toBe(true);
    expect(r.evento).toBe("aparelho_recusado");
  });

  it("avisa quando a avaliação nem começou", async () => {
    const r = await chamar("cotar_usado", { respostas: {} });
    expect(r.dados.erro).toBe("avaliacao_nao_iniciada");
  });
});

describe("proposta de troca", () => {
  async function cotacaoPronta(): Promise<string> {
    const abertura = await chamar("iniciar_avaliacao_usado", { modelo_declarado: "Galaxy S22" });
    const id = abertura.memoria!.avaliacao_id!;
    await chamar(
      "cotar_usado",
      {
        respostas: {
          bloqueio_conta: "nao",
          liga_normalmente: "sim",
          tela: "sem_marca",
          bateria: "acima_85",
          carcaca: "integra",
          acessorios: "caixa_e_nota",
        },
      },
      comMemoria({ avaliacao_id: id }),
    );
    return id;
  }

  it("monta a diferença e grava a proposta com as versões usadas", async () => {
    const cotacaoId = await cotacaoPronta();
    const r = await chamar(
      "montar_proposta_troca",
      {},
      comMemoria({ produto_id: "p-001", cotacao_id: cotacaoId }),
    );

    expect(r.valores.valor_usado).toBe("R$ 1.200,00");
    expect(r.valores.diferenca).toBe("R$ 2.000,00");

    const proposta = await adaptadores.propostas.porId(r.memoria!.proposta_id!);
    expect(proposta?.versaoModelo).toBe("simulador:v1");
    expect(proposta?.versaoPrompt).toBe("p-teste");
  });

  it("avisa quando falta produto ou cotação", async () => {
    const r = await chamar("montar_proposta_troca", {});
    expect(r.dados.erro).toBe("faltam_produto_ou_cotacao");
  });
});

describe("fechamento", () => {
  it("reserva pelo prazo configurado", async () => {
    const r = await chamar("reservar_produto", {}, comMemoria({ produto_id: "p-001" }));
    expect(r.valores.prazo_reserva).toBe("60 minutos");
    expect(r.evento).toBe("acordo");
  });

  it("avisa quando não há unidade para reservar", async () => {
    const r = await chamar("reservar_produto", { produto_id: "p-002" });
    expect(r.dados.erro).toBe("sem_unidade_disponivel");
  });

  it("registra o lead com o consentimento", async () => {
    await chamar("registrar_lead", { interesse: "iPhone 14", aceita_contato: true });
    expect(adaptadores.estado.leads[0]).toMatchObject({ interesse: "iPhone 14", aceitaContato: true });
  });

  it("agenda visita em dia de funcionamento e recusa domingo", async () => {
    const segunda = await chamar("agendar_visita", { data: "2026-08-03", periodo: "manha" });
    expect(segunda.valores.data_visita).toContain("de manhã");

    const domingo = await chamar("agendar_visita", { data: "2026-08-02", periodo: "tarde" });
    expect(domingo.dados.erro).toBe("loja_fechada_nesse_dia");
  });

  it("repassa o motivo do escalonamento pedido pelo modelo", async () => {
    const r = await chamar("escalar_humano", { motivo: "frustracao", resumo: "cliente irritado" });
    expect(r.escalar).toBe("frustracao");
  });
});
