import type { ClienteModelo, EntradaModelo, MensagemModelo, SaidaModelo } from "../portas.js";
import { erro, ok, type Result } from "../result.js";
import { extrairJson, postJson } from "./http.js";

export interface OpcoesOllama {
  readonly baseUrl: string;
  /** Versão exata, nunca apelido genérico. */
  readonly modelo: string;
  readonly timeoutMs: number;
}

const PAPEL: Record<MensagemModelo["papel"], string> = {
  sistema: "system",
  usuario: "user",
  assistente: "assistant",
  ferramenta: "tool",
};

export function clienteOllama(opcoes: OpcoesOllama): ClienteModelo {
  return {
    nome: "ollama",
    versao: opcoes.modelo,

    async gerar(entrada: EntradaModelo): Promise<Result<SaidaModelo>> {
      const inicio = Date.now();
      const resposta = await postJson({
        url: `${opcoes.baseUrl.replace(/\/$/, "")}/api/chat`,
        timeoutMs: opcoes.timeoutMs,
        corpo: {
          model: opcoes.modelo,
          stream: false,
          format: "json",
          messages: entrada.mensagens.map((m) => ({ role: PAPEL[m.papel], content: m.conteudo })),
          options: { temperature: entrada.temperatura, num_predict: entrada.tetoTokens },
        },
      });

      if (!resposta.ok) return resposta;

      const conteudo = (resposta.value as { message?: { content?: string } }).message?.content;
      if (typeof conteudo !== "string") {
        return erro("INTERNO", "Resposta do Ollama sem conteúdo.");
      }

      const json = extrairJson(conteudo);
      if (!json.ok) return json;

      return ok({ conteudo: json.value, versao: opcoes.modelo, duracaoMs: Date.now() - inicio });
    },
  };
}
