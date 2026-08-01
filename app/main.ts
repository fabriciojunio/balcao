// Ponto de entrada: decide qual banco, canal e runtime de modelo entram na
// montagem, a partir do ambiente e da configuração da loja.

import { fileURLToPath } from "node:url";
import { canalWhatsApp } from "../lib/adaptadores/whatsapp.js";
import { bancoCompartilhado, repositoriosPrisma } from "../lib/adaptadores/prisma.js";
import { canalOficialConfigurado, validarEnv } from "../lib/env.js";
import { criarLogger } from "../lib/log.js";
import { comContingencia, criarCliente } from "../lib/modelo/index.js";
import { montarOrquestrador } from "../lib/montagem.js";
import { relogioDoSistema, type Canal } from "../lib/portas.js";
import { carregarConfigDeArquivo } from "../lib/tenant/carregar.js";
import { criarServidor } from "./servidor.js";

const env = validarEnv();
const log = criarLogger({ nivel: env.LOG_NIVEL });

const caminhoConfig = fileURLToPath(
  new URL(`../config/tenants/${env.TENANT_ATIVO}.yml`, import.meta.url),
);
const config = carregarConfigDeArquivo(caminhoConfig);
if (!config.ok) {
  log.error("config.invalida", { motivo: config.error.message, detalhes: config.error.detalhes });
  process.exit(1);
}

if (env.DATABASE_URL === undefined) {
  log.error("config.sem_banco", { dica: "defina DATABASE_URL no .env" });
  process.exit(1);
}

const db = bancoCompartilhado();
const tenant = await db.tenant.findUnique({ where: { slug: config.value.tenant.slug } });
if (tenant === null) {
  log.error("tenant.nao_cadastrado", { slug: config.value.tenant.slug, dica: "rode npm run db:seed" });
  process.exit(1);
}

const repositorios = repositoriosPrisma({ db, tenantId: tenant.id, relogio: relogioDoSistema });

const primario = criarCliente(config.value.modelo.primario, {
  baseUrl: env.MODELO_BASE_URL,
  timeoutMs: env.MODELO_TIMEOUT_MS,
});
const modelo =
  config.value.modelo.contingencia === undefined
    ? primario
    : comContingencia(
        primario,
        criarCliente(config.value.modelo.contingencia, {
          baseUrl: env.MODELO_CONTINGENCIA_BASE_URL ?? env.MODELO_BASE_URL,
          timeoutMs: env.MODELO_TIMEOUT_MS,
          ...(env.MODELO_CONTINGENCIA_API_KEY === undefined
            ? {}
            : { apiKey: env.MODELO_CONTINGENCIA_API_KEY }),
        }),
        log,
      );

const canalMemoria: Canal = {
  nome: "simulador",
  async enviar() {
    return { ok: true as const, value: { idExterno: "" } };
  },
};

const canal: Canal =
  config.value.canal.provedor === "meta_cloud_api" && canalOficialConfigurado(env)
    ? canalWhatsApp({
        apiUrl: env.WHATSAPP_API_URL,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
        token: env.WHATSAPP_TOKEN!,
        timeoutMs: env.MODELO_TIMEOUT_MS,
      })
    : canalMemoria;

if (config.value.canal.provedor === "meta_cloud_api" && canal.nome === "simulador") {
  log.warn("canal.credenciais_ausentes", { dica: "o servidor sobe, mas não fala com a Meta" });
}

const agente = { ativo: env.AGENTE_ATIVO === "true" };

const deps = montarOrquestrador({
  config: config.value,
  repositorios: {
    estoque: repositorios.estoque,
    tabelaTroca: repositorios.tabelaTroca,
    conversas: repositorios.conversas,
    avaliacoes: repositorios.avaliacoes,
    propostas: repositorios.propostas,
    leads: repositorios.leads,
    escalonamentos: repositorios.escalonamentos,
    auditoria: repositorios.auditoria,
  },
  modelo,
  canal,
  relogio: relogioDoSistema,
  log,
  agenteAtivo: () => agente.ativo,
});

const servidor = criarServidor({ env, deps, usuarios: repositorios.usuarios, log, agente });

await servidor.listen({ port: env.PORTA, host: "0.0.0.0" });
log.info("servidor.no_ar", {
  porta: env.PORTA,
  tenant: config.value.tenant.slug,
  canal: canal.nome,
  modelo: modelo.versao,
});

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    log.info("servidor.encerrando", { sinal });
    void servidor.close().then(() => db.$disconnect()).then(() => process.exit(0));
  });
}
