import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { protegerContraExcesso } from "../app/protecao.js";
import { criarLimitador } from "../lib/limite.js";

describe("criarLimitador", () => {
  it("bloqueia depois do máximo e diz quanto esperar", () => {
    const limitador = criarLimitador({ maximo: 2, janelaMs: 60_000 }, () => 0);
    expect(limitador.registrar("a")).toBe(0);
    expect(limitador.registrar("a")).toBe(0);
    expect(limitador.registrar("a")).toBe(60);
  });

  it("libera quando a janela termina", () => {
    let instante = 0;
    const limitador = criarLimitador({ maximo: 1, janelaMs: 1_000 }, () => instante);
    limitador.registrar("a");
    expect(limitador.registrar("a")).toBe(1);
    instante = 1_000;
    expect(limitador.registrar("a")).toBe(0);
  });

  it("conta cada origem separado", () => {
    const limitador = criarLimitador({ maximo: 1, janelaMs: 1_000 }, () => 0);
    limitador.registrar("a");
    expect(limitador.registrar("b")).toBe(0);
  });

  it("não cresce sem limite com muitas origens", () => {
    const limitador = criarLimitador({ maximo: 1, janelaMs: 1_000 }, () => 0);
    limitador.registrar("primeira");
    for (let i = 0; i < 10_000; i += 1) limitador.registrar(`origem-${i}`);
    expect(limitador.registrar("primeira")).toBe(0);
  });
});

describe("protegerContraExcesso", () => {
  function servidor() {
    const app = Fastify({ logger: false });
    protegerContraExcesso(app);
    app.post("/painel/entrar", async () => "entrar");
    app.post("/api/whatsapp", async () => "webhook");
    app.get("/painel", async () => "painel");
    return app;
  }

  it("barra a décima primeira tentativa de login", async () => {
    const app = servidor();
    for (let i = 0; i < 10; i += 1) {
      expect((await app.inject({ method: "POST", url: "/painel/entrar" })).statusCode).toBe(200);
    }
    const barrada = await app.inject({ method: "POST", url: "/painel/entrar" });
    expect(barrada.statusCode).toBe(429);
    expect(Number(barrada.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("não deixa variar a URL para zerar o contador", async () => {
    const app = servidor();
    for (let i = 0; i < 10; i += 1) await app.inject({ method: "POST", url: `/painel/entrar?tentativa=${i}` });
    expect((await app.inject({ method: "POST", url: "/painel/entrar?tentativa=outra" })).statusCode).toBe(429);
  });

  it("limita as demais rotas", async () => {
    const app = servidor();
    for (let i = 0; i < 300; i += 1) await app.inject({ method: "GET", url: "/painel" });
    expect((await app.inject({ method: "GET", url: "/painel" })).statusCode).toBe(429);
  });

  it("não derruba rajada do webhook, que é protegido por assinatura", async () => {
    const app = servidor();
    for (let i = 0; i < 300; i += 1) await app.inject({ method: "POST", url: "/api/whatsapp" });
    expect((await app.inject({ method: "POST", url: "/api/whatsapp" })).statusCode).toBe(200);
  });
});
