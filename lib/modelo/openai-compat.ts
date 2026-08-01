import type { ClienteModelo, EntradaModelo, MensagemModelo, SaidaModelo } from "../portas.js";
import { erro, ok, type Result } from "../result.js";
import { extrairJson, postJson } from "./http.js";

export interface OpcoesOpenAiCompat {
  readonly baseUrl: string;
  readonly modelo: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

const PAPEL: Record<MensagemModelo["papel"], string> = {
  sistema: "system",
  usuario: "user",
  assistente: "assistant",
  ferramenta: "user",
};

/** Serve vLLM, LM Studio e qualquer contingência com API no formato OpenAI. */
export function clienteOpenAiCompat(opcoes: OpcoesOpenAiCompat): ClienteModelo {
  return {
    nome: "openai_compat",
    versao: opcoes.modelo,

    async gerar(entrada: EntradaModelo): Promise<Result<SaidaModelo>> {
      const inicio = Date.now();
      const resposta = await postJson({
        url: `${opcoes.baseUrl.replace(/\/$/, "")}/chat/completions`,
        timeoutMs: opcoes.timeoutMs,
        cabecalhos: opcoes.apiKey === undefined ? {} : { authorization: `Bearer ${opcoes.apiKey}` },
        corpo: {
          model: opcoes.modelo,
          temperature: entrada.temperatura,
          max_tokens: entrada.tetoTokens,
          response_format: { type: "json_object" },
          messages: entrada.mensagens.map((m) => ({ role: PAPEL[m.papel], content: m.conteudo })),
        },
      });

      if (!resposta.ok) return resposta;

      const conteudo = (resposta.value as { choices?: Array<{ message?: { content?: string } }> })
        .choices?.[0]?.message?.content;
      if (typeof conteudo !== "string") {
        return erro("INTERNO", "Resposta sem conteúdo no formato OpenAI.");
      }

      const json = extrairJson(conteudo);
      if (!json.ok) return json;

      return ok({ conteudo: json.value, versao: opcoes.modelo, duracaoMs: Date.now() - inicio });
    },
  };
}
