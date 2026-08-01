import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { assinaturaValida, mensagensDoWebhook } from "../lib/adaptadores/whatsapp.js";
import type { Env } from "../lib/env.js";
import type { Logger } from "../lib/log.js";
import { atender, type DependenciasOrquestrador } from "../lib/orquestrador.js";
import type { RepositorioUsuarios } from "../lib/portas.js";
import { criarSessao, lerSessao, senhaConfere } from "../lib/sessao.js";
import {
  paginaAuditoria,
  paginaConversa,
  paginaFila,
  paginaLogin,
  paginaPropostas,
  paginaSimulador,
} from "./paginas.js";

const COOKIE_SESSAO = "balcao_sessao";

export interface OpcoesServidor {
  readonly env: Env;
  readonly deps: DependenciasOrquestrador;
  readonly usuarios: RepositorioUsuarios;
  readonly log: Logger;
  /** Interruptor compartilhado com o orquestrador. */
  readonly agente: { ativo: boolean };
  /** Telefone usado pelo simulador do painel. */
  readonly telefoneSimulador?: string;
}

const CABECALHOS_SEGURANCA = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:",
};

export interface ServidorBalcao extends FastifyInstance {
  /** Espera o atendimento disparado pelo webhook terminar. */
  aguardarProcessamento(): Promise<void>;
}

export function criarServidor(opcoes: OpcoesServidor): ServidorBalcao {
  const app = Fastify({ logger: false, bodyLimit: 1_048_576 });
  const { env, deps, log } = opcoes;
  const emAndamento = new Set<Promise<void>>();

  void app.register(cookie);
  void app.register(formbody);

  // O corpo cru é necessário para conferir a assinatura da Meta.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, corpo, feito) => {
    try {
      feito(null, { bruto: corpo as string, json: JSON.parse(corpo as string) as unknown });
    } catch (e) {
      feito(e as Error, undefined);
    }
  });

  app.addHook("onSend", async (_req, resposta) => {
    for (const [chave, valor] of Object.entries(CABECALHOS_SEGURANCA)) {
      void resposta.header(chave, valor);
    }
  });

  const html = (resposta: FastifyReply, corpo: string, status = 200): FastifyReply =>
    resposta.status(status).type("text/html; charset=utf-8").send(corpo);

  function autenticado(requisicao: FastifyRequest): { id: string; papel: string } | null {
    const sessao = lerSessao(requisicao.cookies[COOKIE_SESSAO], env.SESSION_SECRET);
    return sessao.ok ? { id: sessao.value.usuarioId, papel: sessao.value.papel } : null;
  }

  // -------------------------------------------------------------------------
  // Saúde
  // -------------------------------------------------------------------------

  app.get("/saude", async () => ({
    ok: true,
    tenant: deps.config.tenant.slug,
    canal: deps.canal.nome,
    modelo: deps.modelo.versao,
    agenteAtivo: opcoes.agente.ativo,
  }));

  // -------------------------------------------------------------------------
  // Webhook do WhatsApp
  // -------------------------------------------------------------------------

  app.get("/api/whatsapp", async (requisicao, resposta) => {
    const q = requisicao.query as Record<string, string | undefined>;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env.WHATSAPP_VERIFY_TOKEN) {
      return resposta.status(200).send(q["hub.challenge"] ?? "");
    }
    return resposta.status(403).send("token de verificação inválido");
  });

  app.post("/api/whatsapp", async (requisicao, resposta) => {
    const corpo = requisicao.body as { bruto: string; json: unknown };
    const segredo = env.WHATSAPP_APP_SECRET;

    if (segredo === undefined) {
      log.error("webhook.sem_segredo");
      return resposta.status(503).send({ erro: "canal não configurado" });
    }
    if (!assinaturaValida(corpo.bruto, requisicao.headers["x-hub-signature-256"] as string | undefined, segredo)) {
      log.warn("webhook.assinatura_invalida");
      return resposta.status(401).send({ erro: "assinatura inválida" });
    }

    // Responder rápido é exigência da Meta: o atendimento segue em segundo
    // plano, registrado para o encerramento esperar o que está em andamento.
    const tarefa = (async () => {
      for (const mensagem of mensagensDoWebhook(corpo.json)) {
        const resultado = await atender(mensagem, deps);
        if (!resultado.ok) log.error("atendimento.falhou", { motivo: resultado.error.message });
      }
    })();

    emAndamento.add(tarefa);
    void tarefa
      .catch((e: unknown) => log.error("atendimento.excecao", { motivo: String(e) }))
      .finally(() => emAndamento.delete(tarefa));

    return resposta.status(200).send({ recebido: true });
  });

  // -------------------------------------------------------------------------
  // Simulador de conversa
  // -------------------------------------------------------------------------

  const telefoneSimulador = opcoes.telefoneSimulador ?? "5500000000000";

  app.get("/simulador", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin("Entre para usar o simulador."), 401);
    const conversa = await deps.conversas.abrirOuRecuperar(telefoneSimulador);
    const historico = await deps.conversas.historico(conversa.id, 100);
    return html(resposta, paginaSimulador(historico));
  });

  app.post("/simulador", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin("Sessão expirada."), 401);

    const { texto } = requisicao.body as { texto?: string };
    if (texto !== undefined && texto.trim() !== "") {
      const r = await atender({ telefone: telefoneSimulador, texto: texto.trim() }, deps);
      if (!r.ok) log.error("simulador.falhou", { motivo: r.error.message });
    }
    return resposta.redirect("/simulador", 303);
  });

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  app.get("/painel", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin());

    const [conversas, escalonamentos] = await Promise.all([
      deps.conversas.listarAtivas(50),
      deps.escalonamentos.listarAbertos(50),
    ]);
    return html(resposta, paginaFila({ conversas, escalonamentos, agenteAtivo: opcoes.agente.ativo }));
  });

  app.post("/painel/entrar", async (requisicao, resposta) => {
    const { email, senha } = requisicao.body as { email?: string; senha?: string };
    const usuario = email === undefined ? null : await opcoes.usuarios.porEmail(email);

    if (usuario === null || senha === undefined || !senhaConfere(senha, usuario.senhaHash)) {
      log.warn("painel.login_negado", { email });
      return html(resposta, paginaLogin("E-mail ou senha incorretos."), 401);
    }

    const token = criarSessao({ usuarioId: usuario.id, papel: usuario.papel }, env.SESSION_SECRET);
    void resposta.setCookie(COOKIE_SESSAO, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: env.NODE_ENV === "production",
    });
    return resposta.redirect("/painel", 303);
  });

  app.post("/painel/agente", async (requisicao, resposta) => {
    const usuario = autenticado(requisicao);
    if (usuario === null) return html(resposta, paginaLogin(), 401);

    const { ativo } = requisicao.body as { ativo?: string };
    opcoes.agente.ativo = ativo === "true";
    await deps.auditoria.registrar("kill_switch", { ativo: opcoes.agente.ativo, por: usuario.id });
    log.warn("painel.agente_alterado", { ativo: opcoes.agente.ativo, por: usuario.id });

    return resposta.redirect("/painel", 303);
  });

  app.post("/painel/assumir", async (requisicao, resposta) => {
    const usuario = autenticado(requisicao);
    if (usuario === null) return html(resposta, paginaLogin(), 401);

    const { id, conversaId } = requisicao.body as { id?: string; conversaId?: string };
    if (id !== undefined) await deps.escalonamentos.assumir(id, usuario.id);
    if (conversaId !== undefined) {
      await deps.conversas.atualizar(conversaId, { responsavelId: usuario.id, estado: "atendimento_humano" });
    }
    return resposta.redirect("/painel", 303);
  });

  app.post("/painel/devolver", async (requisicao, resposta) => {
    const usuario = autenticado(requisicao);
    if (usuario === null) return html(resposta, paginaLogin(), 401);

    const { conversaId } = requisicao.body as { conversaId?: string };
    if (conversaId !== undefined) {
      await deps.conversas.atualizar(conversaId, { responsavelId: null, estado: "descoberta", falhasAuditor: 0 });
      await deps.auditoria.registrar("devolucao_ao_agente", { por: usuario.id }, conversaId);
    }
    return resposta.redirect("/painel", 303);
  });

  app.get("/painel/conversa/:id", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin(), 401);

    const { id } = requisicao.params as { id: string };
    const conversa = await deps.conversas.porId(id);
    if (conversa === null) return resposta.status(404).send("conversa não encontrada");

    const mensagens = await deps.conversas.historico(id, 200);
    return html(resposta, paginaConversa(conversa, mensagens));
  });

  app.get("/painel/propostas", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin(), 401);
    return html(resposta, paginaPropostas(await deps.propostas.listarPendentes(50)));
  });

  app.post("/painel/aprovar", async (requisicao, resposta) => {
    const usuario = autenticado(requisicao);
    if (usuario === null) return html(resposta, paginaLogin(), 401);

    const { id } = requisicao.body as { id?: string };
    if (id !== undefined) {
      await deps.propostas.aprovar(id, usuario.id);
      await deps.auditoria.registrar("proposta_aprovada", { propostaId: id, por: usuario.id });
    }
    return resposta.redirect("/painel/propostas", 303);
  });

  app.get("/painel/auditoria", async (requisicao, resposta) => {
    if (autenticado(requisicao) === null) return html(resposta, paginaLogin(), 401);
    return html(resposta, paginaAuditoria(await deps.auditoria.listar(200)));
  });

  return Object.assign(app, {
    aguardarProcessamento: async (): Promise<void> => {
      while (emAndamento.size > 0) await Promise.allSettled([...emAndamento]);
    },
  });
}
