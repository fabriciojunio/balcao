import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assinaturaValida, mensagensDoWebhook } from "../lib/adaptadores/whatsapp.js";
import { canalOficialConfigurado, lerEnv } from "../lib/env.js";
import { criarLogger } from "../lib/log.js";
import { extrairJson } from "../lib/modelo/http.js";
import { montarPrompt, versaoDoPrompt } from "../lib/modelo/prompt.js";
import { criarSessao, gerarHashSenha, lerSessao, senhaConfere } from "../lib/sessao.js";
import { config } from "./fixtures.js";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";

describe("sessão do painel", () => {
  it("cria e lê o cookie assinado", () => {
    const token = criarSessao({ usuarioId: "u-1", papel: "dono" }, SEGREDO);
    const lida = lerSessao(token, SEGREDO);

    expect(lida.ok).toBe(true);
    expect(lida.ok && lida.value.usuarioId).toBe("u-1");
  });

  it("recusa cookie ausente ou malformado", () => {
    expect(lerSessao(undefined, SEGREDO).ok).toBe(false);
    expect(lerSessao("semponto", SEGREDO).ok).toBe(false);
    expect(lerSessao("carga.assinaturaerrada", SEGREDO).ok).toBe(false);
  });

  it("recusa cookie assinado com outro segredo", () => {
    const token = criarSessao({ usuarioId: "u-1", papel: "dono" }, "outro-segredo-com-32-caracteres-ok!!");
    expect(lerSessao(token, SEGREDO).ok).toBe(false);
  });

  it("recusa sessão expirada", () => {
    const token = criarSessao({ usuarioId: "u-1", papel: "dono" }, SEGREDO, -1000);
    expect(lerSessao(token, SEGREDO).ok).toBe(false);
  });
});

describe("senha", () => {
  it("confere a senha correta e recusa a errada", () => {
    const hash = gerarHashSenha("uma senha qualquer");
    expect(senhaConfere("uma senha qualquer", hash)).toBe(true);
    expect(senhaConfere("outra senha", hash)).toBe(false);
  });

  it("gera hash diferente para a mesma senha", () => {
    expect(gerarHashSenha("igual")).not.toBe(gerarHashSenha("igual"));
  });

  it("recusa hash malformado", () => {
    expect(senhaConfere("x", "sem-separador")).toBe(false);
  });
});

describe("assinatura do webhook", () => {
  const corpo = JSON.stringify({ object: "whatsapp_business_account" });
  const segredo = "app-secret";
  const assinatura = `sha256=${createHmac("sha256", segredo).update(corpo, "utf8").digest("hex")}`;

  it("aceita a assinatura correta", () => {
    expect(assinaturaValida(corpo, assinatura, segredo)).toBe(true);
  });

  it("recusa assinatura ausente, com prefixo errado ou de outro segredo", () => {
    expect(assinaturaValida(corpo, undefined, segredo)).toBe(false);
    expect(assinaturaValida(corpo, "sha1=abc", segredo)).toBe(false);
    expect(assinaturaValida(corpo, assinatura, "outro-segredo")).toBe(false);
  });

  it("recusa corpo adulterado", () => {
    expect(assinaturaValida(`${corpo} `, assinatura, segredo)).toBe(false);
  });
});

describe("leitura do webhook", () => {
  it("extrai mensagem de texto com telefone, id e nome", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ profile: { name: "Ana" } }],
                messages: [{ from: "5514999990000", id: "wamid.1", type: "text", text: { body: "oi" } }],
              },
            },
          ],
        },
      ],
    };

    expect(mensagensDoWebhook(payload)).toEqual([
      { telefone: "5514999990000", texto: "oi", idExterno: "wamid.1", tipo: "texto", nome: "Ana" },
    ]);
  });

  it("reconhece áudio e imagem em vez de descartar", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "551", id: "wamid.a", type: "audio", audio: { id: "midia-1" } },
                  { from: "551", id: "wamid.i", type: "image", image: { id: "midia-2", caption: "olha ele" } },
                ],
              },
            },
          ],
        },
      ],
    };

    const encontradas = mensagensDoWebhook(payload);
    expect(encontradas).toHaveLength(2);
    expect(encontradas[0]).toMatchObject({ tipo: "audio", midiaId: "midia-1", texto: "" });
    expect(encontradas[1]).toMatchObject({ tipo: "imagem", midiaId: "midia-2", texto: "olha ele" });
  });

  it("ignora status de entrega e mídia sem identificador", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: "wamid.2", status: "delivered" }],
                messages: [{ from: "551", id: "wamid.3", type: "audio" }],
                // áudio sem id de mídia não dá para baixar
              },
            },
          ],
        },
      ],
    };
    expect(mensagensDoWebhook(payload)).toEqual([]);
  });

  it("não quebra com payload vazio ou estranho", () => {
    expect(mensagensDoWebhook({})).toEqual([]);
    expect(mensagensDoWebhook({ entry: [{}] })).toEqual([]);
  });
});

describe("ambiente", () => {
  it("aceita o mínimo necessário e aplica padrões", () => {
    const r = lerEnv({ SESSION_SECRET: SEGREDO } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.PORTA).toBe(3000);
    expect(r.value.AGENTE_ATIVO).toBe("true");
    expect(canalOficialConfigurado(r.value)).toBe(false);
  });

  it("recusa segredo curto", () => {
    const r = lerEnv({ SESSION_SECRET: "curto" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONFIG_INVALIDA");
  });

  it("só considera o canal oficial configurado com todas as credenciais", () => {
    const r = lerEnv({
      SESSION_SECRET: SEGREDO,
      WHATSAPP_PHONE_NUMBER_ID: "1",
      WHATSAPP_TOKEN: "2",
      WHATSAPP_VERIFY_TOKEN: "3",
      WHATSAPP_APP_SECRET: "4",
    } as NodeJS.ProcessEnv);
    expect(r.ok && canalOficialConfigurado(r.value)).toBe(true);
  });
});

describe("logger", () => {
  it("respeita o nível configurado", () => {
    const linhas: string[] = [];
    const log = criarLogger({ nivel: "warn", escrever: (l) => linhas.push(l) });

    log.debug("ignorado");
    log.info("ignorado");
    log.warn("aparece");
    log.error("aparece");

    expect(linhas).toHaveLength(2);
    expect(JSON.parse(linhas[0]!).evento).toBe("aparece");
  });

  it("carrega o contexto do logger filho", () => {
    const linhas: string[] = [];
    const log = criarLogger({ escrever: (l) => linhas.push(l), contexto: { tenant: "x" } });
    log.filho({ conversaId: "c-1" }).info("evento", { extra: 1 });

    const registro = JSON.parse(linhas[0]!);
    expect(registro).toMatchObject({ tenant: "x", conversaId: "c-1", evento: "evento", extra: 1 });
  });
});

describe("prompt", () => {
  it("descreve só as ferramentas do estado atual", () => {
    const prompt = montarPrompt({ config, estado: "descoberta", memoria: {} });

    expect(prompt).toContain("consultar_estoque");
    expect(prompt).toContain("escalar_humano");
    expect(prompt).not.toContain("reservar_produto");
    expect(prompt).toContain("Estado atual da conversa: descoberta");
  });

  it("proíbe escrever número e exige marcador", () => {
    const prompt = montarPrompt({ config, estado: "negociacao", memoria: {} });
    expect(prompt).toContain("NUNCA escreve número");
    expect(prompt).toContain("{{preco_avista}}");
  });

  it("inclui as anotações da conversa", () => {
    const prompt = montarPrompt({ config, estado: "negociacao", memoria: { produto_id: "p-1" } });
    expect(prompt).toContain("produto_id: p-1");
  });

  it("versiona por conteúdo", () => {
    const a = versaoDoPrompt(montarPrompt({ config, estado: "descoberta", memoria: {} }));
    const b = versaoDoPrompt(montarPrompt({ config, estado: "negociacao", memoria: {} }));

    expect(a).toMatch(/^p-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("leitura do JSON do modelo", () => {
  it("aceita JSON limpo", () => {
    const r = extrairJson('{"acao":"responder","texto":"oi"}');
    expect(r.ok && r.value).toEqual({ acao: "responder", texto: "oi" });
  });

  it("aceita JSON embrulhado em markdown", () => {
    const r = extrairJson('```json\n{"acao":"escalar"}\n```');
    expect(r.ok && r.value).toEqual({ acao: "escalar" });
  });

  it("recusa quando não há JSON ou está quebrado", () => {
    expect(extrairJson("desculpa, não entendi").ok).toBe(false);
    expect(extrairJson('{"acao": }').ok).toBe(false);
  });
});
