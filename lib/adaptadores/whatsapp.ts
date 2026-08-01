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

export interface MensagemDoWebhook {
  readonly telefone: string;
  readonly texto: string;
  readonly idExterno: string;
  readonly nome?: string;
}

interface PayloadWebhook {
  entry?: Array<{
    changes?: Array<{
      value?: {
        contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
        messages?: Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>;
      };
    }>;
  }>;
}

/** Extrai só as mensagens de texto; status de entrega e mídia são ignorados. */
export function mensagensDoWebhook(payload: unknown): MensagemDoWebhook[] {
  const p = payload as PayloadWebhook;
  const encontradas: MensagemDoWebhook[] = [];

  for (const entrada of p.entry ?? []) {
    for (const mudanca of entrada.changes ?? []) {
      const valor = mudanca.value;
      const nome = valor?.contacts?.[0]?.profile?.name;

      for (const mensagem of valor?.messages ?? []) {
        if (mensagem.type !== "text") continue;
        const texto = mensagem.text?.body;
        const telefone = mensagem.from;
        const idExterno = mensagem.id;
        if (texto === undefined || telefone === undefined || idExterno === undefined) continue;

        encontradas.push({ telefone, texto, idExterno, ...(nome === undefined ? {} : { nome }) });
      }
    }
  }

  return encontradas;
}
