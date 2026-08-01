import { beforeEach, describe, expect, it } from "vitest";
import { criarAdaptadoresMemoria, type AdaptadoresMemoria } from "../lib/adaptadores/memoria.js";
import { reais } from "../lib/dinheiro.js";
import { loggerSilencioso } from "../lib/log.js";
import { clienteSimulador } from "../lib/modelo/simulador.js";
import { montarOrquestrador } from "../lib/montagem.js";
import { atender } from "../lib/orquestrador.js";
import type { ProdutoEmEstoque, Relogio } from "../lib/portas.js";
import { config } from "./fixtures.js";

const TELEFONE = "5514999990000";

let instante = new Date("2026-08-03T14:00:00.000Z");
const relogio: Relogio = { agora: () => instante };

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
    sincronizadoEm: instante,
  },
  {
    id: "p-002",
    descricao: "Galaxy S23 256 GB verde",
    categoria: "seminovo",
    precoTabela: reais(2400),
    custo: reais(1900),
    quantidade: 1,
    memoriaGb: 256,
    cor: "verde",
    sincronizadoEm: instante,
  },
];

let adaptadores: AdaptadoresMemoria;
let agenteLigado = true;

function deps() {
  return montarOrquestrador({
    config,
    repositorios: {
      estoque: adaptadores.estoque,
      tabelaTroca: adaptadores.tabelaTroca,
      conversas: adaptadores.conversas,
      avaliacoes: adaptadores.avaliacoes,
      propostas: adaptadores.propostas,
      leads: adaptadores.leads,
      escalonamentos: adaptadores.escalonamentos,
      auditoria: adaptadores.auditoria,
    },
    modelo: clienteSimulador(),
    canal: adaptadores.canal,
    relogio,
    log: loggerSilencioso,
    agenteAtivo: () => agenteLigado,
  });
}

async function cliente(texto: string, idExterno?: string) {
  const r = await atender({ telefone: TELEFONE, texto, ...(idExterno === undefined ? {} : { idExterno }) }, deps());
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function ultimaResposta(): string {
  return adaptadores.estado.enviados[adaptadores.estado.enviados.length - 1]?.texto ?? "";
}

function tudoQueFoiEnviado(): string {
  return adaptadores.estado.enviados.map((e) => e.texto).join("\n");
}

beforeEach(() => {
  instante = new Date("2026-08-03T14:00:00.000Z");
  agenteLigado = true;
  adaptadores = criarAdaptadoresMemoria({
    relogio,
    produtos: PRODUTOS.map((p) => ({ ...p, sincronizadoEm: instante })),
    tabelaTroca: { "galaxy s22": reais(1200), "iphone 12": reais(1500) },
  });
});

describe("primeira mensagem", () => {
  it("avisa que o atendimento é automatizado antes de qualquer coisa", async () => {
    await cliente("oi, tem iPhone 14?");
    expect(adaptadores.estado.enviados[0]?.texto).toBe(config.conformidade.aviso_inicial);
  });

  it("responde com produto e preço reais do estoque", async () => {
    const r = await cliente("oi, tem iPhone 14?");
    expect(r.escalou).toBe(false);
    expect(ultimaResposta()).toContain("iPhone 14 128 GB preto");
    expect(ultimaResposta()).toContain("R$ 3.200,00");
  });

  it("ignora reenvio do mesmo evento da Meta", async () => {
    await cliente("tem iPhone 14?", "wamid.123");
    const enviadosAntes = adaptadores.estado.enviados.length;
    const repetida = await cliente("tem iPhone 14?", "wamid.123");
    expect(repetida.ignorada).toBe("duplicada");
    expect(adaptadores.estado.enviados).toHaveLength(enviadosAntes);
  });

  it("não oferece o que não tem", async () => {
    await cliente("tem Motorola Edge 50?");
    expect(ultimaResposta()).toContain("não tenho agora");
  });
});

describe("negociação de preço", () => {
  it("contrapropõe no piso quando o cliente pede abaixo da política", async () => {
    await cliente("tem iPhone 14?");
    const r = await cliente("faz por 2500?");

    expect(r.escalou).toBe(false);
    expect(ultimaResposta()).toContain("R$ 3.200,00");
    expect(ultimaResposta()).not.toContain("2.500");
  });

  it("cede dentro da política conforme a negociação avança", async () => {
    await cliente("tem iPhone 14?");
    await cliente("faz por 2500?");
    await cliente("e agora, consegue melhorar?");

    expect(tudoQueFoiEnviado()).toContain("R$ 3.136,00");
  });

  it("nunca envia valor abaixo do piso, por mais que o cliente insista", async () => {
    await cliente("tem iPhone 14?");
    for (let i = 0; i < 6; i++) await cliente("faz por 2000?");

    const valores = tudoQueFoiEnviado().match(/R\$ [\d.]+,\d{2}/g) ?? [];
    const numericos = valores.map((v) => Number(v.replace(/[^\d]/g, "")));
    const abaixoDoPiso = numericos.filter((v) => v > 0 && v < reais(3072));
    expect(abaixoDoPiso).toEqual([]);
  });

  it("simula parcelamento com a taxa real da loja", async () => {
    await cliente("tem iPhone 14?");
    await cliente("dá pra fazer em 12x?");

    expect(ultimaResposta()).toContain("12x");
    expect(ultimaResposta()).toContain("R$ 3.680,00");
  });

  it("recusa parcelamento que a loja não trabalha", async () => {
    await cliente("tem iPhone 14?");
    await cliente("consigo em 18x?");

    expect(ultimaResposta()).toContain("não trabalha");
  });
});

describe("troca de aparelho", () => {
  async function conduzirChecklist() {
    await cliente("quero trocar meu Galaxy S22");
    await cliente("não, sem bloqueio nenhum");
    await cliente("sim, liga normal");
    await cliente("a tela está trincada");
    await cliente("não sei a saúde da bateria");
    await cliente("a carcaça está inteira");
    await cliente("tenho a caixa e a nota");
  }

  it("faz uma pergunta por vez no checklist", async () => {
    await cliente("quero trocar meu Galaxy S22");
    expect(ultimaResposta()).toContain("bloqueando");
    expect(ultimaResposta().match(/\?/g) ?? []).toHaveLength(1);
  });

  it("cota dentro da tabela, com validade e ressalva", async () => {
    await conduzirChecklist();

    expect(ultimaResposta()).toContain("R$ 684,00");
    expect(ultimaResposta()).toContain("confirma na hora que você trouxer");
    expect(ultimaResposta()).toMatch(/\d{2}\/\d{2}/);
  });

  it("recusa aparelho com conta bloqueada", async () => {
    await cliente("quero trocar meu Galaxy S22");
    await cliente("sim, está bloqueado no iCloud");
    await cliente("sim, liga");
    await cliente("tela sem marca");
    await cliente("bateria acima de 85");
    await cliente("carcaça inteira");
    await cliente("tenho a caixa e a nota");

    expect(tudoQueFoiEnviado()).toContain("não consegue pegar na troca");
  });

  it("passa para gente quando o modelo não está na tabela", async () => {
    const r = await cliente("quero trocar meu Xiaomi Poco X6");
    expect(r.escalou).toBe(true);
    expect(r.motivoEscalonamento).toBe("avaliacao_humana_necessaria");
  });
});

describe("passagem para humano", () => {
  it("atende o pedido explícito na hora", async () => {
    await cliente("tem iPhone 14?");
    const r = await cliente("quero falar com um atendente");

    expect(r.escalou).toBe(true);
    expect(r.motivoEscalonamento).toBe("pedido_do_cliente");
    expect(ultimaResposta()).toContain("chamar um vendedor");
  });

  it("reconhece cliente irritado", async () => {
    await cliente("tem iPhone 14?");
    const r = await cliente("isso é um absurdo, que palhaçada");
    expect(r.motivoEscalonamento).toBe("frustracao");
  });

  it("fica em silêncio depois que um vendedor assume", async () => {
    await cliente("tem iPhone 14?");
    await cliente("quero falar com um atendente");
    const enviadosAntes = adaptadores.estado.enviados.length;

    const r = await cliente("oi?");
    expect(r.ignorada).toBe("atendimento_humano");
    expect(adaptadores.estado.enviados).toHaveLength(enviadosAntes);
  });

  it("registra o escalonamento para o painel", async () => {
    await cliente("tem iPhone 14?");
    await cliente("quero falar com um atendente");

    const abertos = await adaptadores.escalonamentos.listarAbertos(10);
    expect(abertos).toHaveLength(1);
    expect(abertos[0]?.motivo).toBe("pedido_do_cliente");
  });
});

describe("interruptor geral", () => {
  it("devolve tudo para atendimento humano quando desligado", async () => {
    agenteLigado = false;
    const r = await cliente("tem iPhone 14?");

    expect(r.ignorada).toBe("agente_desligado");
    expect(r.escalou).toBe(true);
    expect(adaptadores.estado.enviados).toHaveLength(0);
  });
});

describe("estoque", () => {
  it("bloqueia oferta quando o dado do estoque envelhece", async () => {
    instante = new Date(instante.getTime() + 10 * 60_000);
    const r = await cliente("tem iPhone 14?");

    expect(r.escalou).toBe(true);
    expect(r.motivoEscalonamento).toBe("fora_de_escopo");
  });

  it("não deixa duas conversas fecharem a última unidade", async () => {
    const primeira = await adaptadores.estoque.reservar("p-002", "conv-1", new Date(instante.getTime() + 3600_000));
    const segunda = await adaptadores.estoque.reservar("p-002", "conv-2", new Date(instante.getTime() + 3600_000));

    expect(primeira.ok).toBe(true);
    expect(segunda.ok).toBe(false);
  });
});

describe("trilha de auditoria", () => {
  it("registra cada chamada de ferramenta", async () => {
    await cliente("tem iPhone 14?");
    const registros = await adaptadores.auditoria.listar(50);
    expect(registros.some((r) => r.tipo === "ferramenta")).toBe(true);
  });
});
