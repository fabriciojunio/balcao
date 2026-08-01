import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { criarServidor, type ServidorBalcao } from "../app/servidor.js";
import { criarAdaptadoresMemoria, type AdaptadoresMemoria } from "../lib/adaptadores/memoria.js";
import { reais } from "../lib/dinheiro.js";
import type { Env } from "../lib/env.js";
import { loggerSilencioso } from "../lib/log.js";
import { clienteSimulador } from "../lib/modelo/simulador.js";
import { montarOrquestrador } from "../lib/montagem.js";
import type { ProdutoEmEstoque, Relogio } from "../lib/portas.js";
import { gerarHashSenha } from "../lib/sessao.js";
import { config } from "./fixtures.js";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";
const APP_SECRET = "app-secret-de-teste";
const SENHA = "senha-do-dono";

const relogio: Relogio = { agora: () => new Date("2026-08-03T14:00:00.000Z") };

const env = {
  NODE_ENV: "test",
  PORTA: 3000,
  SESSION_SECRET: SEGREDO,
  TENANT_ATIVO: "loja-exemplo",
  WHATSAPP_VERIFY_TOKEN: "token-de-verificacao",
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_API_URL: "https://graph.facebook.com/v21.0",
  MODELO_BASE_URL: "http://localhost:11434",
  MODELO_TIMEOUT_MS: 30000,
  AGENTE_ATIVO: "true",
  LOG_NIVEL: "error",
  JANELA_AGRUPAMENTO_MS: 0,
} as Env;

const PRODUTO: ProdutoEmEstoque = {
  id: "p-001",
  descricao: "iPhone 14 128 GB preto",
  categoria: "novo_lacrado",
  precoTabela: reais(3200),
  custo: reais(2700),
  quantidade: 2,
  memoriaGb: 128,
  sincronizadoEm: relogio.agora(),
};

let app: ServidorBalcao;
let adaptadores: AdaptadoresMemoria;
let agente: { ativo: boolean };

/** O painel é formulário HTML: os testes postam do mesmo jeito que o navegador. */
function form(campos: Record<string, string>) {
  return {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(campos).toString(),
  };
}

function assinar(corpo: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(corpo, "utf8").digest("hex")}`;
}

function webhookCom(texto: string, idExterno = "wamid.1"): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Ana" } }],
              messages: [{ from: "5514999990000", id: idExterno, type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  });
}

async function entrar(): Promise<string> {
  const resposta = await app.inject({
    method: "POST",
    url: "/painel/entrar",
    ...form({ email: "dono@loja.com", senha: SENHA }),
  });
  return resposta.cookies[0]?.value ?? "";
}

beforeEach(() => {
  adaptadores = criarAdaptadoresMemoria({
    relogio,
    produtos: [PRODUTO],
    tabelaTroca: { "galaxy s22": reais(1200) },
    usuarios: [
      { id: "u-1", email: "dono@loja.com", nome: "Dono", papel: "dono", senhaHash: gerarHashSenha(SENHA) },
    ],
  });
  agente = { ativo: true };

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
    agenteAtivo: () => agente.ativo,
  });

  app = criarServidor({
    env,
    deps,
    usuarios: adaptadores.usuarios,
    metricas: adaptadores.metricas,
    log: loggerSilencioso,
    agente,
  });
});

afterEach(async () => {
  await app.close();
});

describe("saúde", () => {
  it("informa tenant, canal e situação do agente", async () => {
    const r = await app.inject({ method: "GET", url: "/saude" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, tenant: "loja-exemplo", agenteAtivo: true });
  });

  it("responde com os cabeçalhos de segurança", async () => {
    const r = await app.inject({ method: "GET", url: "/saude" });
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("verificação do webhook", () => {
  it("devolve o desafio quando o token confere", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/whatsapp?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=12345",
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toBe("12345");
  });

  it("recusa token errado", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/whatsapp?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1",
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("recebimento de mensagem", () => {
  it("recusa requisição sem assinatura", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/whatsapp",
      headers: { "content-type": "application/json" },
      payload: webhookCom("oi"),
    });

    expect(r.statusCode).toBe(401);
    expect(adaptadores.estado.enviados).toHaveLength(0);
  });

  it("recusa assinatura de outro segredo", async () => {
    const corpo = webhookCom("oi");
    const r = await app.inject({
      method: "POST",
      url: "/api/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", "errado").update(corpo).digest("hex")}`,
      },
      payload: corpo,
    });

    expect(r.statusCode).toBe(401);
  });

  it("atende quando a assinatura confere", async () => {
    const corpo = webhookCom("tem iPhone 14?");
    const r = await app.inject({
      method: "POST",
      url: "/api/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": assinar(corpo) },
      payload: corpo,
    });

    expect(r.statusCode).toBe(200);
    const textos = adaptadores.estado.enviados.map((e) => e.texto).join("\n");
    expect(textos).toContain("R$ 3.200,00");
  });

  it("ignora o reenvio do mesmo evento", async () => {
    const corpo = webhookCom("tem iPhone 14?", "wamid.repetido");
    const cabecalhos = { "content-type": "application/json", "x-hub-signature-256": assinar(corpo) };

    await app.inject({ method: "POST", url: "/api/whatsapp", headers: cabecalhos, payload: corpo });
    const depoisDaPrimeira = adaptadores.estado.enviados.length;
    await app.inject({ method: "POST", url: "/api/whatsapp", headers: cabecalhos, payload: corpo });

    expect(adaptadores.estado.enviados).toHaveLength(depoisDaPrimeira);
  });
});

describe("painel", () => {
  it("mostra a tela de login para quem não entrou", async () => {
    const r = await app.inject({ method: "GET", url: "/painel" });
    expect(r.body).toContain("Painel da loja");
    expect(r.body).not.toContain("Desligar agente");
  });

  it("recusa senha errada", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/painel/entrar",
      ...form({ email: "dono@loja.com", senha: "errada" }),
    });
    expect(r.statusCode).toBe(401);
    expect(r.body).toContain("incorretos");
  });

  it("recusa e-mail que não existe", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/painel/entrar",
      ...form({ email: "ninguem@loja.com", senha: SENHA }),
    });
    expect(r.statusCode).toBe(401);
  });

  it("entra e lista a fila", async () => {
    const cookie = await entrar();
    const r = await app.inject({ method: "GET", url: "/painel", cookies: { balcao_sessao: cookie } });

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Conversas");
    expect(r.body).toContain("Desligar agente");
  });

  it("marca o cookie como httpOnly", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/painel/entrar",
      ...form({ email: "dono@loja.com", senha: SENHA }),
    });
    expect(r.cookies[0]).toMatchObject({ name: "balcao_sessao", httpOnly: true, sameSite: "Lax" });
  });
});

describe("interruptor do agente", () => {
  it("desliga pelo painel e registra na auditoria", async () => {
    const cookie = await entrar();
    const r = await app.inject({
      method: "POST",
      url: "/painel/agente",
      cookies: { balcao_sessao: cookie },
      ...form({ ativo: "false" }),
    });

    expect(r.statusCode).toBe(303);
    expect(agente.ativo).toBe(false);

    const trilha = await adaptadores.auditoria.listar(10);
    expect(trilha.some((t) => t.tipo === "kill_switch")).toBe(true);
  });

  it("depois de desligado, o agente não responde mais", async () => {
    const cookie = await entrar();
    await app.inject({
      method: "POST",
      url: "/painel/agente",
      cookies: { balcao_sessao: cookie },
      ...form({ ativo: "false" }),
    });

    const corpo = webhookCom("tem iPhone 14?");
    await app.inject({
      method: "POST",
      url: "/api/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": assinar(corpo) },
      payload: corpo,
    });

    expect(adaptadores.estado.enviados).toHaveLength(0);
    expect(await adaptadores.escalonamentos.listarAbertos(10)).toHaveLength(1);
  });

  it("recusa mexer no interruptor sem sessão", async () => {
    const r = await app.inject({ method: "POST", url: "/painel/agente", ...form({ ativo: "false" }) });
    expect(r.statusCode).toBe(401);
    expect(agente.ativo).toBe(true);
  });
});

describe("simulador", () => {
  it("exige sessão", async () => {
    const r = await app.inject({ method: "GET", url: "/simulador" });
    expect(r.statusCode).toBe(401);
  });

  it("conversa pelo painel sem depender da Meta", async () => {
    const cookie = await entrar();
    await app.inject({
      method: "POST",
      url: "/simulador",
      cookies: { balcao_sessao: cookie },
      ...form({ texto: "tem iPhone 14?" }),
    });

    const r = await app.inject({ method: "GET", url: "/simulador", cookies: { balcao_sessao: cookie } });
    expect(r.body).toContain("R$ 3.200,00");
  });
});

describe("conversa e auditoria", () => {
  it("abre a conversa com histórico e anotações", async () => {
    const cookie = await entrar();
    await app.inject({
      method: "POST",
      url: "/simulador",
      cookies: { balcao_sessao: cookie },
      ...form({ texto: "tem iPhone 14?" }),
    });

    const conversas = await adaptadores.conversas.listarAtivas(1);
    const r = await app.inject({
      method: "GET",
      url: `/painel/conversa/${conversas[0]!.id}`,
      cookies: { balcao_sessao: cookie },
    });

    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("produto_id");
  });

  it("devolve 404 para conversa que não existe", async () => {
    const cookie = await entrar();
    const r = await app.inject({
      method: "GET",
      url: "/painel/conversa/nao-existe",
      cookies: { balcao_sessao: cookie },
    });
    expect(r.statusCode).toBe(404);
  });

  it("lista a trilha de auditoria", async () => {
    const cookie = await entrar();
    await app.inject({
      method: "POST",
      url: "/simulador",
      cookies: { balcao_sessao: cookie },
      ...form({ texto: "tem iPhone 14?" }),
    });

    const r = await app.inject({ method: "GET", url: "/painel/auditoria", cookies: { balcao_sessao: cookie } });
    expect(r.body).toContain("ferramenta");
  });

  it("escapa HTML vindo da conversa", async () => {
    const cookie = await entrar();
    await app.inject({
      method: "POST",
      url: "/simulador",
      cookies: { balcao_sessao: cookie },
      ...form({ texto: "<script>alert(1)</script>" }),
    });

    const r = await app.inject({ method: "GET", url: "/simulador", cookies: { balcao_sessao: cookie } });
    expect(r.body).not.toContain("<script>alert(1)</script>");
    expect(r.body).toContain("&lt;script&gt;");
  });
});
