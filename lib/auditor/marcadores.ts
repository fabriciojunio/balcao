// Substituição dos marcadores que o modelo escreve no lugar dos números.
// Marcador sem valor é erro, não vira mensagem quebrada para o cliente.

import { erro, ok, type Result } from "../result.js";

const MARCADOR = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const CHAVE_SOBRANDO = /\{\{|\}\}/;

export interface ResolucaoMarcadores {
  readonly texto: string;
  readonly usados: readonly string[];
}

/**
 * Troca cada `{{chave}}` pelo valor correspondente.
 * Recusa quando falta valor para algum marcador ou quando sobra chave solta,
 * porque nos dois casos a mensagem sairia quebrada para o cliente.
 */
export function aplicarMarcadores(
  texto: string,
  valores: Readonly<Record<string, string>>,
): Result<ResolucaoMarcadores> {
  const faltando: string[] = [];
  const usados: string[] = [];

  MARCADOR.lastIndex = 0;
  const resolvido = texto.replace(MARCADOR, (_todo, chave: string) => {
    const nome = chave.toLowerCase();
    const valor = valores[nome];
    if (valor === undefined) {
      faltando.push(nome);
      return `{{${nome}}}`;
    }
    usados.push(nome);
    return valor;
  });

  if (faltando.length > 0) {
    return erro("VALIDACAO", "O modelo usou marcador sem valor correspondente.", {
      marcadores: [...new Set(faltando)],
    });
  }
  if (CHAVE_SOBRANDO.test(resolvido)) {
    return erro("VALIDACAO", "Sobrou chave de marcador na mensagem final.", { texto: resolvido });
  }

  return ok({ texto: resolvido, usados: [...new Set(usados)] });
}

/** Lista os marcadores presentes num texto, sem resolver nada. */
export function marcadoresDe(texto: string): string[] {
  const encontrados = new Set<string>();
  MARCADOR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARCADOR.exec(texto)) !== null) {
    const chave = match[1];
    if (chave !== undefined) encontrados.add(chave.toLowerCase());
  }
  return [...encontrados];
}
