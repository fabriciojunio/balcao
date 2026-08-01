// Canal oficial da Meta. Toda requisição recebida tem a assinatura conferida
// antes de virar conversa.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Canal, EnvioCanal } from "../portas.js";
import { erro, ok, type Result } from "../result.js";

export interface OpcoesWhatsApp {
  readonly apiUrl: string;
  readonly phoneNumberId: string;
  readonly token: string;
  readonly timeoutMs: number;
}

export function canalWhatsApp(opcoes: OpcoesWhatsApp): Canal {
  return {
    nome: "meta_cloud_api",

    async enviar(telefone, texto): Promise<Result<EnvioCanal>> {
      const controle = new AbortController();
      const alarme = setTimeout(() => controle.abort(), opcoes.timeoutMs);

      try {
        const resposta = await fetch(`${opcoes.apiUrl}/${opcoes.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opcoes.token}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: telefone,
            type: "text",
            text: { preview_url: false, body: texto },
          }),
          signal: controle.signal,
        });

        if (!resposta.ok) {
          return erro("INTERNO", `Meta devolveu HTTP ${resposta.status}`, {
            corpo: (await resposta.text()).slice(0, 400),
          });
        }

        const corpo = (await resposta.json()) as { messages?: Array<{ id?: string }> };
        return ok({ idExterno: corpo.messages?.[0]?.id ?? "" });
      } catch (e) {
        return erro("INTERNO", `Falha ao enviar pelo WhatsApp: ${(e as Error).message}`);
      } finally {
        clearTimeout(alarme);
      }
    },

    async enviarImagem(telefone, urlOuId, legenda): Promise<Result<EnvioCanal>> {
      const porUrl = /^https?:///.test(urlOuId);
      const imagem = porUrl ? { link: urlOuId, caption: legenda } : { id: urlOuId, caption: legenda };

      try {
        const resposta = await fetch(`${opcoes.apiUrl}/${opcoes.phoneNumberId}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opcoes.token}` },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: telefone,
            type: "image",
            image: imagem,
          }),
        });

        if (!resposta.ok) {
          return erro("INTERNO", `Meta devolveu HTTP ${resposta.status} no envio de imagem`);
        }
        const corpo = (await resposta.json()) as { messages?: Array<{ id?: string }> };
        return ok({ idExterno: corpo.messages?.[0]?.id ?? "" });
      } catch (e) {
        return erro("INTERNO", `Falha ao enviar imagem: ${(e as Error).message}`);
      }
    },

    async baixarMidia(midiaId) {
      try {
        const meta = await fetch(`${opcoes.apiUrl}/${midiaId}`, {
          headers: { authorization: `Bearer ${opcoes.token}` },
        });
        if (!meta.ok) return erro("NAO_ENCONTRADO", `Mídia ${midiaId} não encontrada.`);

        const { url, mime_type } = (await meta.json()) as { url?: string; mime_type?: string };
        if (url === undefined) return erro("NAO_ENCONTRADO", "Mídia sem URL de download.");

        const arquivo = await fetch(url, { headers: { authorization: `Bearer ${opcoes.token}` } });
        if (!arquivo.ok) return erro("INTERNO", `Download da mídia devolveu ${arquivo.status}.`);

        return ok({
          conteudo: Buffer.from(await arquivo.arrayBuffer()),
          mime: mime_type ?? "application/octet-stream",
        });
      } catch (e) {
        return erro("INTERNO", `Falha ao baixar mídia: ${(e as Error).message}`);
      }
    },
  };
}

/** Confere o X-Hub-Signature-256 sem vazar tempo na comparação. */
export function assinaturaValida(corpoBruto: string, cabecalho: string | undefined, appSecret: string): boolean {
  if (cabecalho === undefined || !cabecalho.startsWith("sha256=")) return false;

  const esperado = createHmac("sha256", appSecret).update(corpoBruto, "utf8").digest("hex");
  const recebido = cabecalho.slice("sha256=".length);
  if (recebido.length !== esperado.length) return false;

  return timingSafeEqual(Buffer.from(recebido, "hex"), Buffer.from(esperado, "hex"));
}

export type TipoMensagem = "texto" | "audio" | "imagem" | "outro";

export interface MensagemDoWebhook {
  readonly telefone: string;
  readonly texto: string;
  readonly idExterno: string;
  readonly tipo: TipoMensagem;
  readonly midiaId?: string;
  readonly nome?: string;
}

interface MensagemBruta {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
  audio?: { id?: string };
  voice?: { id?: string };
  image?: { id?: string; caption?: string };
}

interface PayloadWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: MensagemBruta[];
      };
    }>;
  }>;
}

/**
 * Extrai as mensagens do cliente. Áudio e imagem entram como tal, porque no
 * Brasil metade das mensagens para empresa é áudio: descartar seria descartar
 * metade dos clientes. Status de entrega continua ignorado.
 */
export function mensagensDoWebhook(payload: unknown): MensagemDoWebhook[] {
  const p = payload as PayloadWebhook;
  const encontradas: MensagemDoWebhook[] = [];

  for (const entrada of p.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      const valor = mudanca.value;
      const nome = valor?.contacts?.[0]?.profile?.name;

      for (const bruta of valor?.messages ?? []) {
        const convertida = converter(bruta, nome);
        if (convertida !== null) encontradas.push(convertida);
      }
    }
  }

  return encontradas;
}

function converter(bruta: MensagemBruta, nome: string | undefined): MensagemDoWebhook | null {
  const { from: telefone, id: idExterno } = bruta;
  if (telefone === undefined || idExterno === undefined) return null;

  const base = { telefone, idExterno, ...(nome === undefined ? {} : { nome }) };
  const midia = bruta.audio?.id ?? bruta.voice?.id ?? bruta.image?.id;

  switch (bruta.type) {
    case "text": {
      const texto = bruta.text?.body;
      return texto === undefined ? null : { ...base, tipo: "texto", texto };
    }
    case "audio":
    case "voice":
      return midia === undefined ? null : { ...base, tipo: "audio", texto: "", midiaId: midia };
    case "image":
      return midia === undefined
        ? null
        : { ...base, tipo: "imagem", texto: bruta.image?.caption ?? "", midiaId: midia };
    case undefined:
      return null;
    default:
      return { ...base, tipo: "outro", texto: "" };
  }
}
