// Resultado explícito em vez de exceção. Toda função de domínio que pode
// recusar devolve Result: quem chama é obrigado a tratar a recusa, e o
// compilador cobra isso.

export type Ok<T> = { ok: true; value: T };
export type Err<E = ErroApp> = { ok: false; error: E };
export type Result<T, E = ErroApp> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E = ErroApp>(error: E): Err<E> {
  return { ok: false, error };
}

export type CodigoErro =
  | "NAO_ENCONTRADO"
  | "VALIDACAO"
  | "CONFLITO"
  | "PROIBIDO"
  | "CONFIG_INVALIDA"
  | "INTERNO";

export type ErroApp = {
  code: CodigoErro;
  message: string;
  detalhes?: Record<string, unknown>;
};

export function erro(code: CodigoErro, message: string, detalhes?: Record<string, unknown>): Err<ErroApp> {
  return err(detalhes === undefined ? { code, message } : { code, message, detalhes });
}

export function paraHttpStatus(code: CodigoErro): number {
  switch (code) {
    case "NAO_ENCONTRADO": return 404;
    case "VALIDACAO":      return 422;
    case "CONFLITO":       return 409;
    case "PROIBIDO":       return 403;
    case "CONFIG_INVALIDA": return 500;
    case "INTERNO":        return 500;
  }
}

/** Extrai o valor ou lança. Uso restrito a scripts e testes. */
export function desempacotar<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw new Error(`Result em erro: ${JSON.stringify(r.error)}`);
}
