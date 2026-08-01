// Transcrição de áudio e leitura de foto do aparelho, ambas por endpoint
// compatível com OpenAI, que serve tanto local (Whisper, Qwen-VL no Ollama)
// quanto em nuvem.

import type { AnalisadorDeImagem, Transcritor } from "../portas.js";
import { erro, ok, type Result } from "../result.js";
import { apenasDefeitosConhecidos, DEFEITOS_VISIVEIS, type LeituraDeImagem } from "../dominio/visao.js";
import { extrairJson } from "./http.js";

export interface OpcoesMidia {
  readonly baseUrl: string;
  readonly modelo: string;
  readonly apiKey?: string;
  readonly timeoutMs: number;
}

function autorizacao(apiKey?: string): Record<string, string> {
  return apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };
}

export function transcritorWhisper(opcoes: OpcoesMidia): Transcritor {
  return {
    async transcrever(audio): Promise<Result<string>> {
      const controle = new AbortController();
      const alarme = setTimeout(() => controle.abort(), opcoes.timeoutMs);

      try {
        const formulario = new FormData();
        formulario.append("model", opcoes.modelo);
        formulario.append("language", "pt");
        formulario.append("file", new Blob([audio.conteudo], { type: audio.mime }), "audio.ogg");

        const resposta = await fetch(`${opcoes.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
          method: "POST",
          headers: autorizacao(opcoes.apiKey),
          body: formulario,
          signal: controle.signal,
        });

        if (!resposta.ok) return erro("INTERNO", `Transcrição devolveu HTTP ${resposta.status}.`);

        const corpo = (await resposta.json()) as { text?: string };
        const texto = corpo.text?.trim();
        return texto === undefined || texto === ""
          ? erro("INTERNO", "Transcrição veio vazia.")
          : ok(texto);
      } catch (e) {
        return erro("INTERNO", `Falha ao transcrever: ${(e as Error).message}`);
      } finally {
        clearTimeout(alarme);
      }
    },
  };
}

const INSTRUCAO_VISAO = `Você olha a foto de um celular usado e reporta apenas o que consegue ver.
Nunca invente. Se a foto estiver escura, tremida, longe demais ou não mostrar um celular, marque como inconclusiva.
Responda somente com JSON neste formato:
{"defeitos":[{"chave":"tela_trincada","confianca":0.9}],"inconclusiva":false,"observacao":"texto curto"}
Chaves possíveis: ${DEFEITOS_VISIVEIS.join(", ")}. Confiança vai de 0 a 1.`;

export function analisadorDeImagem(opcoes: OpcoesMidia): AnalisadorDeImagem {
  return {
    async analisar(imagem): Promise<Result<LeituraDeImagem>> {
      const controle = new AbortController();
      const alarme = setTimeout(() => controle.abort(), opcoes.timeoutMs);
      const base64 = imagem.conteudo.toString("base64");

      try {
        const resposta = await fetch(`${opcoes.baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", ...autorizacao(opcoes.apiKey) },
          signal: controle.signal,
          body: JSON.stringify({
            model: opcoes.modelo,
            temperature: 0,
            messages: [
              { role: "system", content: INSTRUCAO_VISAO },
              {
                role: "user",
                content: [
                  { type: "text", text: "Avalie o estado aparente deste aparelho." },
                  { type: "image_url", image_url: { url: `data:${imagem.mime};base64,${base64}` } },
                ],
              },
            ],
          }),
        });

        if (!resposta.ok) return erro("INTERNO", `Leitura de imagem devolveu HTTP ${resposta.status}.`);

        const corpo = (await resposta.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const conteudo = corpo.choices?.[0]?.message?.content;
        if (typeof conteudo !== "string") return erro("INTERNO", "Leitura de imagem sem conteúdo.");

        const json = extrairJson(conteudo);
        if (!json.ok) return json;

        return ok(apenasDefeitosConhecidos(normalizar(json.value)));
      } catch (e) {
        return erro("INTERNO", `Falha ao ler a imagem: ${(e as Error).message}`);
      } finally {
        clearTimeout(alarme);
      }
    },
  };
}

function normalizar(bruto: unknown): LeituraDeImagem {
  const b = bruto as { defeitos?: unknown; inconclusiva?: unknown; observacao?: unknown };
  const defeitos = Array.isArray(b.defeitos) ? b.defeitos : [];

  return {
    defeitos: defeitos
      .map((d) => d as { chave?: unknown; confianca?: unknown })
      .filter((d) => typeof d.chave === "string")
      .map((d) => ({
        chave: d.chave as string,
        confianca: typeof d.confianca === "number" ? d.confianca : 0,
      })),
    inconclusiva: b.inconclusiva === true,
    ...(typeof b.observacao === "string" ? { observacao: b.observacao } : {}),
  };
}
