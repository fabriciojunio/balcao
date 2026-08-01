import { erro, ok, type Result } from "../result.js";

export interface OpcoesRequisicao {
  readonly url: string;
  readonly corpo: unknown;
  readonly cabecalhos?: Record<string, string>;
  readonly timeoutMs: number;
}

/** POST com JSON, timeout e erro tipado. Sem dependência de cliente HTTP. */
export async function postJson(opcoes: OpcoesRequisicao): Promise<Result<unknown>> {
  const controle = new AbortController();
  const alarme = setTimeout(() => controle.abort(), opcoes.timeoutMs);

  try {
    const resposta = await fetch(opcoes.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...opcoes.cabecalhos },
      body: JSON.stringify(opcoes.corpo),
      signal: controle.signal,
    });

    if (!resposta.ok) {
      return erro("INTERNO", `HTTP ${resposta.status} em ${opcoes.url}`, {
        corpo: (await resposta.text()).slice(0, 500),
      });
    }
    return ok(await resposta.json());
  } catch (e) {
    const causa = e instanceof Error ? e.message : String(e);
    return erro("INTERNO", `Falha na chamada a ${opcoes.url}: ${causa}`);
  } finally {
    clearTimeout(alarme);
  }
}

/** Extrai o primeiro objeto JSON de uma resposta que veio suja de texto. */
export function extrairJson(texto: string): Result<unknown> {
  const limpo = texto.replace(/```(?:json)?/gi, "").trim();
  const inicio = limpo.indexOf("{");
  const fim = limpo.lastIndexOf("}");
  if (inicio === -1 || fim <= inicio) {
    return erro("VALIDACAO", "O modelo não devolveu JSON.", { trecho: limpo.slice(0, 200) });
  }
  try {
    return ok(JSON.parse(limpo.slice(inicio, fim + 1)));
  } catch {
    return erro("VALIDACAO", "JSON malformado na resposta do modelo.", {
      trecho: limpo.slice(inicio, inicio + 200),
    });
  }
}
