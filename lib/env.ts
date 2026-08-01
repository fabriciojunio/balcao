// Contrato das variáveis de ambiente (exemplos em .env.example).

import { z } from "zod";
import { erro, ok, type Result } from "./result.js";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORTA: z.coerce.number().int().min(1).max(65535).default(3000),

  DATABASE_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET precisa de pelo menos 32 caracteres"),

  TENANT_ATIVO: z.string().min(1).default("loja-exemplo"),

  // Canal. Sem token, o servidor sobe em modo simulador e não fala com a Meta.
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_API_URL: z.string().url().default("https://graph.facebook.com/v21.0"),

  MODELO_BASE_URL: z.string().url().default("http://localhost:11434"),
  MODELO_CONTINGENCIA_BASE_URL: z.string().url().optional(),
  MODELO_CONTINGENCIA_API_KEY: z.string().optional(),
  MODELO_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

  // Interruptor geral. "false" devolve tudo ao atendimento humano.
  AGENTE_ATIVO: z.enum(["true", "false"]).default("true"),
  LOG_NIVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  // Espera antes de responder, para juntar mensagem picotada. Zero nos testes.
  JANELA_AGRUPAMENTO_MS: z.coerce.number().int().min(0).max(60000).default(8000),
});

export type Env = z.infer<typeof schema>;

export function lerEnv(fonte: NodeJS.ProcessEnv = process.env): Result<Env> {
  const parsed = schema.safeParse(fonte);
  if (!parsed.success) {
    return erro("CONFIG_INVALIDA", "Variáveis de ambiente inválidas.", {
      problemas: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  return ok(parsed.data);
}

/** Valida e encerra o processo se estiver inválido. Uso em scripts e no servidor. */
export function validarEnv(fonte: NodeJS.ProcessEnv = process.env): Env {
  const r = lerEnv(fonte);
  if (r.ok) return r.value;
  process.stderr.write(`[FATAL] ${r.error.message}\n`);
  for (const p of (r.error.detalhes?.problemas as string[] | undefined) ?? []) {
    process.stderr.write(`  - ${p}\n`);
  }
  process.exit(1);
}

/** O canal oficial só liga com todas as credenciais presentes. */
export function canalOficialConfigurado(env: Env): boolean {
  return (
    env.WHATSAPP_PHONE_NUMBER_ID !== undefined &&
    env.WHATSAPP_TOKEN !== undefined &&
    env.WHATSAPP_VERIFY_TOKEN !== undefined &&
    env.WHATSAPP_APP_SECRET !== undefined
  );
}
