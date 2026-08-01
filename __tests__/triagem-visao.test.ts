import { describe, expect, it } from "vitest";
import { triar } from "../lib/dominio/triagem.js";
import { apenasDefeitosConhecidos, mesclarDefeitos, type LeituraDeImagem } from "../lib/dominio/visao.js";
import { auditarMensagem, contextoDe } from "../lib/auditor/index.js";
import { reais } from "../lib/dinheiro.js";

describe("triagem antes do modelo", () => {
  it("reconhece pedido de atendente em várias formas", () => {
    const pedidos = [
      "quero falar com um atendente",
      "me passa pra uma pessoa",
      "isso é robô?",
      "quero falar com o gerente",
      "não to falando com robô",
      "quero um vendedor",
    ];

    for (const pedido of pedidos) {
      const r = triar(pedido);
      expect(r.tipo, pedido).toBe("escalar");
      expect(r.tipo === "escalar" && r.motivo).toBe("pedido_do_cliente");
    }
  });

  it("reconhece pedido de saída", () => {
    for (const saida of ["SAIR", "parar", "não quero mais receber", "me descadastra", "para de me mandar mensagem"]) {
      expect(triar(saida).tipo, saida).toBe("opt_out");
    }
  });

  it("reconhece cliente irritado, inclusive falando em Procon", () => {
    expect(triar("isso é um absurdo").tipo).toBe("escalar");
    expect(triar("vou no Procon").tipo).toBe("escalar");
    const r = triar("que palhaçada");
    expect(r.tipo === "escalar" && r.motivo).toBe("frustracao");
  });

  it("deixa passar conversa normal", () => {
    for (const normal of ["tem iPhone 14?", "quanto fica em 12x?", "obrigado", "vou pensar"]) {
      expect(triar(normal).tipo, normal).toBe("seguir");
    }
  });

  it("sair vem antes de qualquer outra coisa", () => {
    expect(triar("não quero mais receber, isso é um absurdo").tipo).toBe("opt_out");
  });
});

describe("foto do aparelho", () => {
  const leitura = (defeitos: Array<[string, number]>, inconclusiva = false): LeituraDeImagem => ({
    defeitos: defeitos.map(([chave, confianca]) => ({ chave, confianca })),
    inconclusiva,
  });

  it("acrescenta defeito que o cliente não declarou", () => {
    const r = mesclarDefeitos(["sem_caixa"], leitura([["tela_trincada", 0.9]]));

    expect(r.defeitos).toEqual(["sem_caixa", "tela_trincada"]);
    expect(r.acrescentadosPelaFoto).toEqual(["tela_trincada"]);
    expect(r.exigeAvaliacaoHumana).toBe(true);
  });

  it("nunca remove defeito que o cliente declarou", () => {
    const r = mesclarDefeitos(["tela_trincada"], leitura([]));

    expect(r.defeitos).toEqual(["tela_trincada"]);
    expect(r.naoConfirmados).toEqual(["tela_trincada"]);
    expect(r.acrescentadosPelaFoto).toEqual([]);
  });

  it("ignora o que a foto viu com pouca confiança", () => {
    const r = mesclarDefeitos([], leitura([["tela_trincada", 0.3]]));

    expect(r.defeitos).toEqual([]);
    expect(r.exigeAvaliacaoHumana).toBe(false);
  });

  it("foto ilegível manda para avaliação humana", () => {
    const r = mesclarDefeitos([], leitura([], true));
    expect(r.exigeAvaliacaoHumana).toBe(true);
  });

  it("confirmar o que já foi declarado não muda nada", () => {
    const r = mesclarDefeitos(["tela_trincada"], leitura([["tela_trincada", 0.95]]));

    expect(r.defeitos).toEqual(["tela_trincada"]);
    expect(r.acrescentadosPelaFoto).toEqual([]);
    expect(r.exigeAvaliacaoHumana).toBe(false);
  });

  it("descarta chave que o modelo de visão inventou", () => {
    const limpa = apenasDefeitosConhecidos(leitura([["tela_trincada", 0.9], ["aparelho_feio", 0.9]]));
    expect(limpa.defeitos.map((d) => d.chave)).toEqual(["tela_trincada"]);
  });
});

describe("auditor: ressalva e afirmações", () => {
  const base = contextoDe({ monetariosPermitidos: [reais(684)] });

  it("bloqueia valor de troca sem dizer que é pré-avaliação", () => {
    const contexto = contextoDe({ ...base, ressalvaExigida: "pré-avaliação" });
    const r = auditarMensagem("Seu aparelho vale R$ 684,00.", contexto);

    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.tipo).toBe("ressalva_ausente");
  });

  it("libera quando a ressalva está na mensagem", () => {
    const contexto = contextoDe({ ...base, ressalvaExigida: "pré-avaliação" });
    const r = auditarMensagem("É uma pré-avaliação: seu aparelho fica em R$ 684,00.", contexto);

    expect(r.aprovado).toBe(true);
  });

  it("aceita a ressalva escrita sem acento", () => {
    const contexto = contextoDe({ ...base, ressalvaExigida: "pré-avaliação" });
    expect(auditarMensagem("Pre-avaliacao: R$ 684,00.", contexto).aprovado).toBe(true);
  });

  it("bloqueia escassez que nenhuma ferramenta comprovou", () => {
    for (const frase of ["É a última unidade!", "Só hoje esse preço", "Frete grátis pra você"]) {
      const r = auditarMensagem(frase, base);
      expect(r.aprovado, frase).toBe(false);
      expect(r.violacoes.some((v) => v.tipo === "afirmacao_nao_comprovada"), frase).toBe(true);
    }
  });

  it("libera escassez quando o estoque comprovou", () => {
    const contexto = contextoDe({ ...base, afirmacoesPermitidas: ["ultima_unidade"] });
    expect(auditarMensagem("É a última unidade que tenho.", contexto).aprovado).toBe(true);
  });

  it("prazo continua bloqueado mesmo com escassez liberada", () => {
    const contexto = contextoDe({ ...base, afirmacoesPermitidas: ["ultima_unidade"] });
    const r = auditarMensagem("Última unidade, e só hoje com esse preço.", contexto);

    expect(r.aprovado).toBe(false);
    expect(r.violacoes[0]?.trecho).toContain("so hoje");
  });
});
