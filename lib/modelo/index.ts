import type { ClienteModelo, EntradaModelo, SaidaModelo } from "../portas.js";
import type { Logger } from "../log.js";
import { ok, type Result } from "../result.js";
import type { ConfigTenant } from "../tenant/schema.js";
import { clienteOllama } from "./ollama.js";
import { clienteOpenAiCompat } from "./openai-compat.js";
import { clienteSimulador } from "./simulador.js";

export interface OpcoesRuntime {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

export function criarCliente(
  runtime: ConfigTenant["modelo"]["primario"],
  opcoes: OpcoesRuntime,
): ClienteModelo {
  const baseUrl = runtime.base_url ?? opcoes.baseUrl;

  switch (runtime.runtime) {
    case "ollama":
      return clienteOllama({ baseUrl, modelo: runtime.id, timeoutMs: opcoes.timeoutMs });
    case "openai_compat":
      return clienteOpenAiCompat({
        baseUrl,
        modelo: runtime.id,
        timeoutMs: opcoes.timeoutMs,
        ...(opcoes.apiKey === undefined ? {} : { apiKey: opcoes.apiKey }),
      });
    case "simulador":
      return clienteSimulador();
  }
}

/** Tenta o principal e cai para a contingência sem o cliente perceber. */
export function comContingencia(
  primario: ClienteModelo,
  contingencia: ClienteModelo,
  log: Logger,
): ClienteModelo {
  return {
    nome: `${primario.nome}+contingencia`,
    versao: primario.versao,

    async gerar(entrada: EntradaModelo): Promise<Result<SaidaModelo>> {
      const resultado = await primario.gerar(entrada);
      if (resultado.ok) return resultado;

      log.warn("modelo.contingencia_acionada", {
        primario: primario.versao,
        motivo: resultado.error.message,
      });

      const reserva = await contingencia.gerar(entrada);
      if (!reserva.ok) return reserva;
      return ok({ ...reserva.value, versao: contingencia.versao });
    },
  };
}

export { clienteOllama, clienteOpenAiCompat, clienteSimulador };
export { montarMensagens, montarPrompt, versaoDoPrompt } from "./prompt.js";
