// Verificações que rodam antes do modelo, sobre a mensagem crua. Pedido de
// atendente e pedido de saída não podem depender de o modelo entender: o
// Decreto 11.034/2022 dá ao cliente o direito de falar com gente quando quiser.
// Por isso aqui se aceita abreviação e erro de digitação.

import { contemPalavraParecida, expandirAbreviacoes } from "../texto.js";
import type { MotivoEscalonamento } from "./conversa.js";

export type ResultadoTriagem =
  | { readonly tipo: "seguir" }
  | { readonly tipo: "escalar"; readonly motivo: MotivoEscalonamento; readonly trecho: string }
  | { readonly tipo: "opt_out"; readonly trecho: string };

const PEDIDO_DE_HUMANO = [
  /pessoa de verdade/,
  /falar com (alguem|uma pessoa|um vendedor|o vendedor|o dono|o gerente|um humano)/,
  /quero (um|uma)? ?(vendedor|atendente|humano)/,
  /me (transfere|passa|manda) (pra|para)/,
  /nao (quero|estou|to) falando com (robo|bot|maquina)/,
  /\b(e|voce e) (um )?(robo|bot)\b/,
  /tem (alguem|gente|uma pessoa) ai/,
];

/** Uma palavra dessas na frase já basta, mesmo escrita torto. */
const PALAVRAS_DE_HUMANO = ["atendente", "vendedor", "gerente", "humano"];

const FRUSTRACAO = [
  /absurdo/,
  /pessimo/,
  /ridiculo/,
  /palhacada/,
  /cansei/,
  /nao aguento/,
  /horrivel/,
  /vergonha/,
  /procon/,
  /\bprocesso\b/,
  /perdendo meu tempo/,
  /\bnao serve\b/,
];

const PALAVRAS_DE_FRUSTRACAO = ["absurdo", "pessimo", "ridiculo", "palhacada", "procon", "horrivel"];

const OPT_OUT = [
  /^\s*(sair|parar|pare|cancelar|descadastrar|stop|remover)\s*$/,
  /nao (quero|queria|desejo) (mais )?receber/,
  /para de (me )?(mandar|enviar)/,
  /me (tira|remove|descadastra|exclui)/,
  /nao me (manda|mande|mandem) mais/,
  /sai(r)? da lista/,
];

function bate(padroes: readonly RegExp[], texto: string): string | null {
  for (const padrao of padroes) {
    const encontrado = padrao.exec(texto);
    if (encontrado !== null) return encontrado[0].trim();
  }
  return null;
}

function palavraPresente(palavras: readonly string[], frase: string): string | null {
  return palavras.find((p) => contemPalavraParecida(frase, p)) ?? null;
}

/**
 * Decide, sem modelo nenhum, se a mensagem já resolve o rumo da conversa.
 * A ordem é a de gravidade: sair antes de tudo, depois pedido de humano.
 */
export function triar(texto: string): ResultadoTriagem {
  const alvo = expandirAbreviacoes(texto).trim();

  const saida = bate(OPT_OUT, alvo);
  if (saida !== null) return { tipo: "opt_out", trecho: saida };

  const humano = bate(PEDIDO_DE_HUMANO, alvo) ?? palavraPresente(PALAVRAS_DE_HUMANO, alvo);
  if (humano !== null) return { tipo: "escalar", motivo: "pedido_do_cliente", trecho: humano };

  const irritado = bate(FRUSTRACAO, alvo) ?? palavraPresente(PALAVRAS_DE_FRUSTRACAO, alvo);
  if (irritado !== null) return { tipo: "escalar", motivo: "frustracao", trecho: irritado };

  return { tipo: "seguir" };
}
