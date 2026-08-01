// O fluxo completo contra o banco de verdade: webhook, conversa, negociação,
// troca e proposta gravada.

import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarServidor } from "../../app/servidor.js";
import { repositoriosPrisma } from "../../lib/adaptadores/prisma.js";
import { reais } from "../../lib/dinheiro.js";
import type { Env } from "../../lib/env.js";
import { loggerSilencioso } from "../../lib/log.js";
import { clienteSimulador } from "../../lib/modelo/simulador.js";
import { montarOrquestrador } from "../../lib/montagem.js";
import { atender } from "../../lib/orquestrador.js";
import type { Canal, Relogio } from "../../lib/portas.js";
import { gerarHashSenha } from "../../lib/sessao.js";
import { config } from "../fixtures.js";

const db = new PrismaClient();
const APP_SECRET = "app-secret-de-integracao";
const SENHA = "senha-do-dono";
const TELEFONE = "5514977770000";

const relogio: Relogio = { agora: () => new Date("2026-08-03T14:00:00.000Z") };

const env = {
  NODE_ENV: "test",
  PORTA: 3000,
  SESSION_SECRET: "segredo-de-teste-com-mais-de-32-caracteres",
  TENANT_ATIVO: "loja-exemplo",
  WHATSAPP_VERIFY_TOKEN: "verificacao",
  WHATSAPP_APP_SECRET: APP_SECRET,
  WHATSAPP_API_URL: "https://graph.facebook.com/v21.0",
  MODELO_BASE_URL: "http://localhost:11434",
  MODELO_TIMEOUT_MS: 30000,
  AGENTE_ATIVO: "true",
  LOG_NIVEL: "error",
  JANELA_AGRUPAMENTO_MS: 0,
} as Env;

const enviados: string[] = [];
const canal: Canal = {
  nome: "teste",
  async enviar(_telefone, texto) {
    enviados.push(texto);
    return { ok: true as const, value: { idExterno: `out-${enviados.length}` } };
  },
};

let tenantId: string;
let app: FastifyInstance;
let deps: ReturnType<typeof montarOrquestrador>;
let repos: ReturnType<typeof repositoriosPrisma>;
let agente: { ativo: boolean };

async function limpar(): Promise<void> {
  await db.$transaction([
    db.registroAuditoria.deleteMany(),
    db.escalonamento.deleteMany(),
    db.proposta.deleteMany(),
    db.avaliacaoUsado.deleteMany(),
    db.reserva.deleteMany(),
    db.mensagem.deleteMany(),
    db.conversa.deleteMany(),
    db.contato.deleteMany(),
    db.produto.deleteMany(),
    db.tabelaTroca.deleteMany(),
    db.usuario.deleteMany(),
    db.tenant.deleteMany(),
  ]);
}

function webhookCom(texto: string, idExterno: string): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ profile: { name: "Ana" } }],
              messages: [{ from: TELEFONE, id: idExterno, type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  });
}

async function pelaMeta(texto: string, idExterno: string) {
  const corpo = webhookCom(texto, idExterno);
  return app.inject({
    method: "POST",
    url: "/api/whatsapp",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${createHmac("sha256", APP_SECRET).update(corpo, "utf8").digest("hex")}`,
    },
    payload: corpo,
  });
}

async function cliente(texto: string) {
  const r = await atender({ telefone: TELEFONE, texto }, deps);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await limpar();
  await db.$disconnect();
});

beforeEach(async () => {
  await limpar();
  enviados.length = 0;

  const tenant = await db.tenant.create({
    data: { slug: "loja-integracao", nomeExibicao: "Loja Integração", configuracao: {} },
  });
  tenantId = tenant.id;

  await db.produto.create({
    data: {
      tenantId,
      sku: "IPH14-128",
      descricao: "iPhone 14 128 GB preto",
      categoria: "NOVO_LACRADO",
      memoriaGb: 128,
      cor: "preto",
      precoTabela: reais(3200),
      custo: reais(2700),
      quantidade: 2,
    },
  });

  await db.tabelaTroca.create({
    data: { tenantId, modelo: "Galaxy S22", valorBase: reais(1200) },
  });

  await db.usuario.create({
    data: {
      tenantId,
      email: "dono@loja.com",
      nome: "Dono",
      papel: "DONO",
      senhaHash: gerarHashSenha(SENHA),
    },
  });

  repos = repositoriosPrisma({ db, tenantId, relogio });
  agente = { ativo: true };

  deps = montarOrquestrador({
    config,
    repositorios: {
      estoque: repos.estoque,
      tabelaTroca: repos.tabelaTroca,
      conversas: repos.conversas,
      avaliacoes: repos.avaliacoes,
      propostas: repos.propostas,
      leads: repos.leads,
      escalonamentos: repos.escalonamentos,
      auditoria: repos.auditoria,
    },
    modelo: clienteSimulador(),
    canal,
    relogio,
    log: loggerSilencioso,
    agenteAtivo: () => agente.ativo,
  });

  app = criarServidor({ env, deps, usuarios: repos.usuarios, log: loggerSilencioso, agente });
});

afterEach(async () => {
  await app.close();
});

describe("mensagem que chega pela Meta", () => {
  it("vira conversa, resposta e histórico no banco", async () => {
    const r = await pelaMeta("oi, tem iPhone 14?", "wamid.int.1");
    expect(r.statusCode).toBe(200);

    expect(enviados.join("\n")).toContain("R$ 3.200,00");

    const conversa = await db.conversa.findFirstOrThrow({ where: { tenantId } });
    const mensagens = await db.mensagem.findMany({ where: { conversaId: conversa.id } });

    expect(mensagens.filter((m) => m.direcao === "ENTRADA")).toHaveLength(1);
    expect(mensagens.filter((m) => m.direcao === "SAIDA").length).toBeGreaterThanOrEqual(2);
    expect(await db.contato.count({ where: { tenantId } })).toBe(1);
  });

  it("descarta o reenvio do mesmo evento", async () => {
    await pelaMeta("tem iPhone 14?", "wamid.int.2");
    const depoisDaPrimeira = enviados.length;
    await pelaMeta("tem iPhone 14?", "wamid.int.2");

    expect(enviados).toHaveLength(depoisDaPrimeira);
    expect(await db.mensagem.count({ where: { direcao: "ENTRADA" } })).toBe(1);
  });

  it("recusa requisição sem assinatura válida", async () => {
    const corpo = webhookCom("oi", "wamid.int.3");
    const r = await app.inject({
      method: "POST",
      url: "/api/whatsapp",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" },
      payload: corpo,
    });

    expect(r.statusCode).toBe(401);
    expect(await db.conversa.count()).toBe(0);
  });
});

describe("negociação persistida", () => {
  it("mantém o estado e as anotações entre mensagens", async () => {
    await cliente("tem iPhone 14?");
    await cliente("faz por 2500?");

    const conversa = await db.conversa.findFirstOrThrow({ where: { tenantId } });
    const memoria = conversa.memoria as Record<string, string>;

    expect(conversa.estado).toBe("NEGOCIACAO");
    expect(memoria.produto_id).toBeDefined();
    expect(conversa.rodadasNegociacao).toBeGreaterThan(0);
  });

  it("nunca envia valor abaixo do piso, por mais que o cliente insista", async () => {
    await cliente("tem iPhone 14?");
    for (let i = 0; i < 5; i++) await cliente("faz por 2000?");

    const valores = enviados.join("\n").match(/R\$ [\d.]+,\d{2}/g) ?? [];
    const abaixo = valores
      .map((v) => Number(v.replace(/[^\d]/g, "")))
      .filter((v) => v > reais(100) && v < reais(3072));

    expect(abaixo).toEqual([]);
  });
});

describe("troca com proposta gravada", () => {
  it("percorre o checklist e grava a proposta com as versões usadas", async () => {
    await cliente("tem iPhone 14?");
    await cliente("quero dar meu Galaxy S22 na troca");
    await cliente("não, sem bloqueio");
    await cliente("sim, liga normal");
    await cliente("a tela está sem marca");
    await cliente("bateria acima de 85");
    await cliente("carcaça inteira");
    await cliente("tenho a caixa e a nota");
    await cliente("fechado, pode montar");

    const avaliacao = await db.avaliacaoUsado.findFirstOrThrow({ where: { tenantId } });
    expect(avaliacao.modeloDeclarado).toBe("Galaxy S22");
    expect(avaliacao.valorApurado).toBe(reais(1200));
    expect(avaliacao.validadeAte).not.toBeNull();

    const proposta = await db.proposta.findFirstOrThrow({ where: { tenantId } });
    expect(proposta.valorAparelhoUsado).toBe(reais(1200));
    expect(proposta.versaoModelo).toBe("simulador:v1");
    expect(proposta.versaoPrompt).toMatch(/^p-[0-9a-f]{12}$/);
  });
});

describe("operação pelo painel", () => {
  it("desligar o agente devolve a conversa para atendimento humano", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/painel/entrar",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ email: "dono@loja.com", senha: SENHA }).toString(),
    });
    const cookie = login.cookies[0]!.value;

    await app.inject({
      method: "POST",
      url: "/painel/agente",
      cookies: { balcao_sessao: cookie },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ ativo: "false" }).toString(),
    });

    await pelaMeta("tem iPhone 14?", "wamid.int.4");

    expect(enviados).toHaveLength(0);
    expect(await db.escalonamento.count({ where: { tenantId } })).toBe(1);

    const trilha = await db.registroAuditoria.findMany({ where: { tenantId, tipo: "kill_switch" } });
    expect(trilha).toHaveLength(1);
  });

  it("mostra a conversa na fila do painel", async () => {
    await cliente("tem iPhone 14?");

    const login = await app.inject({
      method: "POST",
      url: "/painel/entrar",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({ email: "dono@loja.com", senha: SENHA }).toString(),
    });
    const cookie = login.cookies[0]!.value;

    const painel = await app.inject({ method: "GET", url: "/painel", cookies: { balcao_sessao: cookie } });
    expect(painel.body).toContain(TELEFONE);
  });
});
