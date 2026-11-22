import type { FastifyInstance } from "fastify";
import { criarLimitador, type RegraDeLimite } from "../lib/limite.js";

const UM_MINUTO_MS = 60_000;
const LIMITE_GERAL: RegraDeLimite = { maximo: 300, janelaMs: UM_MINUTO_MS };
const LIMITE_LOGIN: RegraDeLimite = { maximo: 10, janelaMs: 15 * UM_MINUTO_MS };

const ROTA_LOGIN = "/painel/entrar";
// A Meta entrega em rajada e reenvia o que falha. Quem protege essa rota é a assinatura.
const ROTA_WEBHOOK = "/api/whatsapp";

export function protegerContraExcesso(app: FastifyInstance): void {
  const geral = criarLimitador(LIMITE_GERAL);
  const login = criarLimitador(LIMITE_LOGIN);

  app.addHook("onRequest", async (requisicao, resposta) => {
    // A rota casada, e não a URL: query string ou codificação não zeram o contador.
    const rota = requisicao.routeOptions.url;
    if (requisicao.method === "POST" && rota === ROTA_WEBHOOK) return;

    const limitador = requisicao.method === "POST" && rota === ROTA_LOGIN ? login : geral;
    const espera = limitador.registrar(requisicao.ip);
    if (espera > 0) {
      return resposta.status(429).header("retry-after", String(espera)).send({ erro: "muitas tentativas" });
    }
  });
}
