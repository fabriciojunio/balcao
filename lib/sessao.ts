// Sessão do painel: cookie assinado com HMAC e senha com scrypt.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { erro, ok, type Result } from "./result.js";

const SEPARADOR = ".";
const VALIDADE_PADRAO_MS = 12 * 60 * 60 * 1000;

export interface Sessao {
  readonly usuarioId: string;
  readonly papel: string;
  readonly expiraEm: number;
}

function assinar(carga: string, segredo: string): string {
  return createHmac("sha256", segredo).update(carga).digest("base64url");
}

export function criarSessao(sessao: Omit<Sessao, "expiraEm">, segredo: string, validadeMs = VALIDADE_PADRAO_MS): string {
  const completa: Sessao = { ...sessao, expiraEm: Date.now() + validadeMs };
  const carga = Buffer.from(JSON.stringify(completa)).toString("base64url");
  return `${carga}${SEPARADOR}${assinar(carga, segredo)}`;
}

export function lerSessao(cookie: string | undefined, segredo: string): Result<Sessao> {
  if (cookie === undefined || !cookie.includes(SEPARADOR)) {
    return erro("PROIBIDO", "Sessão ausente.");
  }

  const [carga, assinatura] = cookie.split(SEPARADOR);
  if (carga === undefined || assinatura === undefined) return erro("PROIBIDO", "Sessão malformada.");

  const esperada = assinar(carga, segredo);
  if (assinatura.length !== esperada.length) return erro("PROIBIDO", "Assinatura inválida.");
  if (!timingSafeEqual(Buffer.from(assinatura), Buffer.from(esperada))) {
    return erro("PROIBIDO", "Assinatura inválida.");
  }

  try {
    const sessao = JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as Sessao;
    if (sessao.expiraEm < Date.now()) return erro("PROIBIDO", "Sessão expirada.");
    return ok(sessao);
  } catch {
    return erro("PROIBIDO", "Sessão ilegível.");
  }
}

export function gerarHashSenha(senha: string): string {
  const sal = randomBytes(16).toString("hex");
  return `${sal}${SEPARADOR}${scryptSync(senha, sal, 64).toString("hex")}`;
}

export function senhaConfere(senha: string, hash: string): boolean {
  const [sal, esperado] = hash.split(SEPARADOR);
  if (sal === undefined || esperado === undefined) return false;

  const calculado = scryptSync(senha, sal, 64).toString("hex");
  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(Buffer.from(calculado, "hex"), Buffer.from(esperado, "hex"));
}
