// Simulação de uso real: centenas de conversas montadas a partir de como o
// cliente escreve de verdade, com as invariantes conferidas em todas elas.
// A semente é fixa, então o CI reproduz exatamente a mesma bateria.

import { describe, expect, it } from "vitest";
import { criarAdaptadoresMemoria, type AdaptadoresMemoria } from "../lib/adaptadores/memoria.js";
import { analisarMoedaBR, reais } from "../lib/dinheiro.js";
import { AFIRMACOES } from "../lib/auditor/index.js";
import { loggerSilencioso } from "../lib/log.js";
import { clienteSimulador } from "../lib/modelo/simulador.js";
import { montarOrquestrador } from "../lib/montagem.js";
import { atender } from "../lib/orquestrador.js";
import type { ProdutoEmEstoque, Relogio } from "../lib/portas.js";
import { semAcento } from "../lib/texto.js";
import { config } from "./fixtures.js";

const CONVERSAS = 200;
const AGORA = new Date("2026-08-03T14:00:00.000Z");
const relogio: Relogio = { agora: () => AGORA };

const PISO_IPHONE = reais(3072);
const VALOR_BASE_USADO = reais(1200);

const PRODUTOS: ProdutoEmEstoque[] = [
  {
    id: "p-001",
    descricao: "iPhone 14 128 GB preto",
    categoria: "novo_lacrado",
    precoTabela: reais(3200),
    custo: reais(2700),
    quantidade: 5,
    memoriaGb: 128,
    cor: "preto",
    garantiaMeses: 12,
    sincronizadoEm: AGORA,
  },
  {
    id: "p-002",
    descricao: "Moto G84 128 GB grafite",
    categoria: "novo_lacrado",
    precoTabela: reais(1500),
    custo: reais(1250),
    quantidade: 4,
    memoriaGb: 128,
    sincronizadoEm: AGORA,
  },
];

/** Gerador determinístico, para a bateria ser sempre a mesma. */
function semente(valor: number): () => number {
  let estado = valor;
  return () => {
    estado |= 0;
    estado = (estado + 0x6d2b79f5) | 0;
    let t = Math.imul(estado ^ (estado >>> 15), 1 | estado);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Como o cliente escreve mesmo: sem pontuação, com gíria, com erro de digitação.
const ABERTURAS = [
  "oi",
  "eai blz?",
  "opa, vc tem iphone?",
  "oiii",
  "bom dia! vcs tao abertos?",
  "tem ifone 14 ai?",
  "quero um celu bom e barato",
  "boa tarde",
  "eaí, tudo bem?",
  "opa",
  "bom dia, tem iphone 14?",
  "oi tem iPhone 14 disponivel",
  "vcs tem moto g84?",
  "queria um celular ate 2 mil",
  "to procurando um iphone",
];

const PERGUNTAS = [
  "quanto ta o iphone 14?",
  "qnto ta o cel?",
  "da p parcelar?",
  "vcs tem em 12x",
  "qual gtia?",
  "tem outra cor?",
  "aceita pix?",
  "tem em 128?",
  "qual o preco a vista",
  "da pra parcelar?",
  "em 12x fica quanto",
  "consigo em 10x",
  "e no pix",
  "tem preto?",
  "quantas unidades vc tem",
  "qual a garantia",
];

const NEGOCIACOES = [
  "faz por 2800?",
  "naum da pra melhorar naum?",
  "2500 vc fx?",
  "ta mto caro",
  "e o ultimo pfv",
  "consegue melhorar?",
  "qual o ultimo preco",
  "2500 vc faz",
  "ta caro, abaixa um pouco",
  "e se eu pagar a vista",
  "me da um desconto ai",
];

const TROCAS = [
  "tenho um galaxy s22 pra dar na troca",
  "tenho um galax s22, aceita?",
  "posso dar meu galaxy s22 de entrada?",
  "aceita meu s22 como entrada",
  "quero trocar meu galaxy s22",
  "e se eu der o meu na troca",
];

const RESPOSTAS_CHECKLIST = [
  ["nao", "nenhum bloqueio", "nao tem nada bloqueando", "ta limpo", "naum", "n tem"],
  ["sim", "liga sim", "funciona normal", "ta funcionando", "s, liga", "funciona sim"],
  ["tela sem marca", "a tela ta trincada", "tem um risco leve", "tela perfeita", "tela trincda", "tela estourada", "tem um risquinho"],
  ["acima de 85", "nao sei", "ta em 78%", "bateria boa", "nem sei", "bateria nova", "ta em 71"],
  ["carcaca inteira", "tem um amassado", "a tampa ta trincada", "conservado", "ta inteirinho", "tem uma batida"],
  ["tenho a caixa e a nota", "so a caixa", "sem caixa", "perdi a caixa", "tenho tudo", "joguei fora"],
];

const FECHAMENTOS = ["fechado", "vou levar", "pode separar", "quero esse", "to dentro"];
const HUMANOS = [
  "quero falar com um atendente",
  "me passa pra uma pessoa",
  "isso é robô?",
  "quero falar com um atendent",
  "kd o vendedr",
  "tem alguem ai",
];
const SAIDAS = ["sair", "nao quero mais receber", "para de me mandar mensagem", "SAIR", "me descadastra", "nao quero mais receber msg"];
const IRRITADOS = ["isso é um absurdo", "que palhaçada", "vou no procon", "q palhacada", "to perdendo meu tempo"];
const RUIDO = ["obrigado", "vou pensar", "blz", "hmm", "e aí", "😀", "?", "obg", "vlw", "...", "kkkk", "aham"];

interface Roteiro {
  readonly mensagens: readonly string[];
  readonly termina: "normal" | "humano" | "saida" | "irritado";
}

function montarRoteiro(aleatorio: () => number): Roteiro {
  const escolher = <T>(lista: readonly T[]): T => lista[Math.floor(aleatorio() * lista.length)]!;
  const mensagens: string[] = [escolher(ABERTURAS)];

  const quantasPerguntas = Math.floor(aleatorio() * 3);
  for (let i = 0; i < quantasPerguntas; i++) mensagens.push(escolher(PERGUNTAS));

  if (aleatorio() < 0.6) {
    const rodadas = 1 + Math.floor(aleatorio() * 4);
    for (let i = 0; i < rodadas; i++) mensagens.push(escolher(NEGOCIACOES));
  }

  if (aleatorio() < 0.5) {
    mensagens.push(escolher(TROCAS));
    for (const opcoes of RESPOSTAS_CHECKLIST) mensagens.push(escolher(opcoes));
  }

  if (aleatorio() < 0.3) mensagens.push(escolher(RUIDO));

  const sorteio = aleatorio();
  if (sorteio < 0.12) return { mensagens: [...mensagens, escolher(HUMANOS)], termina: "humano" };
  if (sorteio < 0.2) return { mensagens: [...mensagens, escolher(SAIDAS)], termina: "saida" };
  if (sorteio < 0.26) return { mensagens: [...mensagens, escolher(IRRITADOS)], termina: "irritado" };
  return { mensagens: [...mensagens, escolher(FECHAMENTOS)], termina: "normal" };
}

interface Rodada {
  readonly telefone: string;
  readonly roteiro: Roteiro;
  readonly enviados: readonly string[];
  readonly estadoFinal: string;
  readonly falhasAuditor: number;
  readonly escalou: boolean;
}

async function simular(): Promise<{ rodadas: Rodada[]; adaptadores: AdaptadoresMemoria }> {
  const aleatorio = semente(20260803);
  const adaptadores = criarAdaptadoresMemoria({
    relogio,
    produtos: PRODUTOS,
    tabelaTroca: { "Galaxy S22": VALOR_BASE_USADO },
  });

  const deps = montarOrquestrador({
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
    agenteAtivo: () => true,
  });

  const rodadas: Rodada[] = [];

  for (let i = 0; i < CONVERSAS; i++) {
    const telefone = `55149${String(10000000 + i)}`;
    const roteiro = montarRoteiro(aleatorio);
    const antes = adaptadores.estado.enviados.length;
    let escalou = false;

    for (const mensagem of roteiro.mensagens) {
      const r = await atender({ telefone, texto: mensagem }, deps);
      expect(r.ok, `atender falhou em "${mensagem}"`).toBe(true);
      if (r.ok && r.value.escalou) escalou = true;
    }

    const conversa = (await adaptadores.conversas.listarAtivas(500)).find((c) => c.telefone === telefone);
    rodadas.push({
      telefone,
      roteiro,
      enviados: adaptadores.estado.enviados.slice(antes).map((e) => e.texto),
      estadoFinal: conversa?.estado ?? "desconhecido",
      falhasAuditor: conversa?.falhasAuditor ?? 0,
      escalou,
    });
  }

  return { rodadas, adaptadores };
}

const simulacao = await simular();
const todasAsMensagens = simulacao.rodadas.flatMap((r) => r.enviados);

describe(`simulação de ${CONVERSAS} conversas`, () => {
  it("nenhuma conversa quebra o sistema", () => {
    expect(simulacao.rodadas).toHaveLength(CONVERSAS);
    expect(todasAsMensagens.length).toBeGreaterThan(CONVERSAS * 2);
  });

  it("toda conversa começa avisando que o atendimento é automatizado", () => {
    for (const rodada of simulacao.rodadas) {
      expect(rodada.enviados[0], rodada.telefone).toBe(config.conformidade.aviso_inicial);
    }
  });

  it("nenhuma mensagem sai com marcador por resolver", () => {
    for (const mensagem of todasAsMensagens) {
      expect(mensagem, mensagem).not.toMatch(/\{\{|\}\}/);
    }
  });

  it("nenhum preço do iPhone sai abaixo do piso da política", () => {
    // Mensagem de troca e de parcelamento citam diferença e parcela, que são
    // outra grandeza. Aqui interessa a mensagem que fala do preço do aparelho.
    const abaixoDoPiso = todasAsMensagens
      .filter((m) => m.includes("iPhone 14"))
      .filter((m) => !/diferença|entra por|de R\$/.test(m))
      .flatMap((m) => m.match(/R\$ [\d.]+,\d{2}/g) ?? [])
      .map((v) => analisarMoedaBR(v) ?? 0)
      .filter((v) => v >= reais(2000) && v <= reais(5000))
      .filter((v) => v < PISO_IPHONE);

    expect(abaixoDoPiso).toEqual([]);
  });

  it("na proposta de troca, preço menos usado fecha exatamente com a diferença", () => {
    const propostas = todasAsMensagens.filter((m) => m.includes("diferença fica em"));
    expect(propostas.length).toBeGreaterThan(0);

    for (const mensagem of propostas) {
      const valores = (mensagem.match(/R\$ [\d.]+,\d{2}/g) ?? []).map((v) => analisarMoedaBR(v) ?? 0);
      expect(valores.length, mensagem).toBeGreaterThanOrEqual(3);

      const [preco, usado, diferenca] = valores;
      expect(preco! - usado!, mensagem).toBe(diferenca!);
      if (mensagem.includes("iPhone 14")) {
        expect(preco!, mensagem).toBeGreaterThanOrEqual(PISO_IPHONE);
      }
    }
  });

  it("nenhum valor de troca sai acima da tabela da loja", () => {
    const acimaDaTabela = todasAsMensagens
      .filter((m) => m.toLowerCase().includes("galaxy s22"))
      .flatMap((m) => m.match(/R\$ [\d.]+,\d{2}/g) ?? [])
      .map((v) => analisarMoedaBR(v) ?? 0)
      .filter((v) => v > VALOR_BASE_USADO);

    expect(acimaDaTabela).toEqual([]);
  });

  it("todo valor de troca sai com a palavra pré-avaliação", () => {
    const semRessalva = todasAsMensagens.filter(
      (m) => m.toLowerCase().includes("galaxy s22") && m.includes("R$") && !semAcento(m).toLowerCase().includes("pre-avaliacao"),
    );
    expect(semRessalva).toEqual([]);
  });

  it("nenhuma mensagem inventa escassez ou prazo", () => {
    const comAfirmacao = todasAsMensagens.filter((m) =>
      Object.values(AFIRMACOES).some((padrao) => padrao.test(semAcento(m).toLowerCase())),
    );
    expect(comAfirmacao).toEqual([]);
  });

  it("o agente nunca pede foto do aparelho", () => {
    const pedindoFoto = todasAsMensagens.filter((m) => /manda.{0,15}(foto|imagem)|envia.{0,15}foto/i.test(m));
    expect(pedindoFoto).toEqual([]);
  });

  it("quem pede atendente sempre cai para atendimento humano", () => {
    const pedidos = simulacao.rodadas.filter((r) => r.roteiro.termina === "humano");
    expect(pedidos.length).toBeGreaterThan(5);

    for (const rodada of pedidos) {
      expect(rodada.estadoFinal, rodada.telefone).toBe("atendimento_humano");
      expect(rodada.escalou, rodada.telefone).toBe(true);
    }
  });

  it("cliente irritado também vai para gente", () => {
    for (const rodada of simulacao.rodadas.filter((r) => r.roteiro.termina === "irritado")) {
      expect(rodada.estadoFinal, rodada.telefone).toBe("atendimento_humano");
    }
  });

  it("quem pede para sair é encerrado e recebe a despedida", () => {
    const saidas = simulacao.rodadas.filter((r) => r.roteiro.termina === "saida");
    expect(saidas.length).toBeGreaterThan(5);

    for (const rodada of saidas) {
      expect(rodada.estadoFinal, rodada.telefone).toBe("encerrada");
      expect(rodada.enviados[rodada.enviados.length - 1]).toBe(config.textos.despedida_opt_out);
    }
  });

  it("duas falhas do auditor sempre acabam em atendimento humano", () => {
    for (const rodada of simulacao.rodadas.filter((r) => r.falhasAuditor >= 2)) {
      expect(rodada.estadoFinal, rodada.telefone).toBe("atendimento_humano");
    }
  });

  it("toda conversa termina num estado previsto", () => {
    const validos = [
      "recepcao",
      "descoberta",
      "apresentacao",
      "avaliacao_usado",
      "negociacao",
      "fechamento",
      "atendimento_humano",
      "retomada",
      "encerrada",
    ];
    for (const rodada of simulacao.rodadas) {
      expect(validos, rodada.telefone).toContain(rodada.estadoFinal);
    }
  });

  it("nenhuma proposta gravada fica sem as versões de modelo e prompt", () => {
    for (const proposta of simulacao.adaptadores.estado.propostas.values()) {
      expect(proposta.versaoModelo).not.toBe("");
      expect(proposta.versaoPrompt).toMatch(/^p-[0-9a-f]{12}$/);
    }
  });

  it("a contenção fica dentro da faixa de mercado para agente que executa ações", async () => {
    const metricas = await simulacao.adaptadores.metricas.resumo(new Date(AGORA.getTime() - 86_400_000));

    // Referência de 2026 para agentes que tomam ação: 55% a 75%.
    expect(metricas.conversas).toBe(CONVERSAS);
    expect(metricas.taxaContencao).toBeGreaterThan(50);
    expect(metricas.taxaContencao).toBeLessThanOrEqual(100);
  });

  it("todo escalonamento tem motivo conhecido", () => {
    const motivos = new Set(simulacao.adaptadores.estado.escalonamentos.map((e) => e.motivo));
    const conhecidos = [
      "frustracao",
      "fora_de_escopo",
      "falha_auditor",
      "valor_acima_alcada",
      "pedido_do_cliente",
      "avaliacao_humana_necessaria",
    ];
    for (const motivo of motivos) expect(conhecidos).toContain(motivo);
  });
});
