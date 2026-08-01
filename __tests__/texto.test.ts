import { describe, expect, it } from "vitest";
import {
  contemPalavraParecida,
  distancia,
  expandirAbreviacoes,
  normalizarChave,
  semAcento,
} from "../lib/texto.js";
import { triar } from "../lib/dominio/triagem.js";
import { CHECKLIST_PADRAO, interpretarResposta } from "../lib/dominio/troca.js";

function pergunta(chave: string) {
  const encontrada = CHECKLIST_PADRAO.find((p) => p.chave === chave);
  if (encontrada === undefined) throw new Error(`pergunta ${chave} não existe`);
  return encontrada;
}

describe("abreviação de WhatsApp", () => {
  it("expande as abreviações mais comuns", () => {
    expect(expandirAbreviacoes("vc tem?")).toBe("voce tem?");
    expect(expandirAbreviacoes("vcs fazem por mto menos?")).toBe("voces fazem por muito menos?");
    expect(expandirAbreviacoes("qnto ta o cel")).toBe("quanto esta o celular");
    expect(expandirAbreviacoes("naum quero")).toBe("nao quero");
    expect(expandirAbreviacoes("blz, vlw")).toBe("beleza, valeu");
  });

  it("só troca token inteiro, não pedaço de palavra", () => {
    expect(expandirAbreviacoes("nota fiscal")).toBe("nota fiscal");
    expect(expandirAbreviacoes("tela")).toBe("tela");
    expect(expandirAbreviacoes("aparelho")).toBe("aparelho");
  });

  it("remove acento no caminho", () => {
    expect(expandirAbreviacoes("VOCÊ TEM?")).toBe("voce tem?");
    expect(semAcento("avaliação")).toBe("avaliacao");
    expect(normalizarChave("Tampa Trincada")).toBe("tampa_trincada");
  });
});

describe("distância de edição", () => {
  it("mede o erro de digitação", () => {
    expect(distancia("atendente", "atendente")).toBe(0);
    expect(distancia("atendente", "atendent")).toBe(1);
    expect(distancia("atendente", "atendetne")).toBe(2);
    expect(distancia("sair", "sar")).toBe(1);
  });

  it("desiste cedo quando passa do teto", () => {
    expect(distancia("celular", "geladeira", 2)).toBeGreaterThan(2);
  });

  it("não aceita erro em palavra curta", () => {
    expect(contemPalavraParecida("quero sai", "sair")).toBe(false);
    expect(contemPalavraParecida("quero sair", "sair")).toBe(true);
  });

  it("aceita erro proporcional ao tamanho da palavra", () => {
    expect(contemPalavraParecida("quero um atendent", "atendente")).toBe(true);
    expect(contemPalavraParecida("quero um atendennte", "atendente")).toBe(true);
    expect(contemPalavraParecida("quero um vendedr", "vendedor")).toBe(true);
  });
});

describe("triagem com escrita real", () => {
  const pedidos = [
    "quero falar com um atendent",
    "me passa pro vendedr",
    "kd o atendente",
    "tem alguem ai?",
    "quero falar com um humano",
    "vc eh robo?",
    "quero falar com uma pessoa",
    "me transfere pra alguem",
  ];

  it.each(pedidos)("entende pedido de humano em %s", (frase) => {
    const r = triar(frase);
    expect(r.tipo).toBe("escalar");
    expect(r.tipo === "escalar" && r.motivo).toBe("pedido_do_cliente");
  });

  const saidas = ["sair", "SAIR", "parar", "nao quero mais receber msg", "me descadastra", "sai da lista"];

  it.each(saidas)("entende pedido de saída em %s", (frase) => {
    expect(triar(frase).tipo).toBe("opt_out");
  });

  const irritados = ["isso eh um absurdo", "q palhacada", "vou no procon", "to perdendo meu tempo"];

  it.each(irritados)("entende irritação em %s", (frase) => {
    expect(triar(frase).tipo).toBe("escalar");
  });

  const normais = [
    "vcs tem iphone 14?",
    "qnto ta?",
    "da pra parcelar em 12x",
    "blz, vou pensar",
    "tem a nota fiscal?",
    "obg",
  ];

  it.each(normais)("deixa passar conversa normal: %s", (frase) => {
    expect(triar(frase).tipo).toBe("seguir");
  });
});

describe("checklist com escrita real", () => {
  const casos: Array<[string, string, string]> = [
    ["bloqueio_conta", "naum", "nao"],
    ["bloqueio_conta", "nao tem nada bloqueando", "nao"],
    ["bloqueio_conta", "ta limpo", "nao"],
    ["bloqueio_conta", "sim, ta no icloud", "sim"],
    ["liga_normalmente", "liga sim", "sim"],
    ["liga_normalmente", "funciona normal", "sim"],
    ["liga_normalmente", "naum liga", "nao"],
    ["tela", "a tela ta trincda", "tela_trincada"],
    ["tela", "tela estourada", "tela_trincada"],
    ["tela", "tem um risquinho", "risco_leve"],
    ["tela", "tela zerada", "sem_marca"],
    ["tela", "nenhuma marca", "sem_marca"],
    ["bateria", "ta em 78%", "bateria_abaixo_80"],
    ["bateria", "acima de 85", "acima_85"],
    ["bateria", "nem sei", "nao_sei"],
    ["bateria", "bateria nova", "acima_85"],
    ["carcaca", "carcaca inteira", "integra"],
    ["carcaca", "tem um amassado", "carcaca_amassada"],
    ["carcaca", "a tampa ta trincada", "tampa_trincada"],
    ["carcaca", "conservado", "integra"],
    ["acessorios", "tenho a caixa e a nota", "caixa_e_nota"],
    ["acessorios", "tenho tudo", "caixa_e_nota"],
    ["acessorios", "so a caixa", "so_caixa"],
    ["acessorios", "perdi a caixa", "sem_caixa"],
    ["acessorios", "joguei fora", "sem_caixa"],
  ];

  it.each(casos)("%s: %s -> %s", (chave, resposta, esperado) => {
    expect(interpretarResposta(pergunta(chave), resposta)).toBe(esperado);
  });

  it("devolve null quando não dá para decidir, e a pergunta é repetida", () => {
    expect(interpretarResposta(pergunta("tela"), "sei lá, acho que tá ok")).toBeNull();
    expect(interpretarResposta(pergunta("acessorios"), "???")).toBeNull();
  });
});
