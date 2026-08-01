// Verificações que rodam antes do modelo, sobre a mensagem crua. Pedido de
// atendente e pedido de saída não podem depender de o modelo entender: o
// Decreto 11.034/2022 dá ao cliente o direito de falar com gente quando quiser.

import { semAcento } from "../texto.js";
import type { MotivoEscalonamento } from "./conversa.js";

export type ResultadoTriagem =
  | { readonly tipo: "seguir" }
  | { readonly tipo: "escalar"; readonly motivo: MotivoEscalonamento; readonly trecho: string }
  | { readonly tipo: "opt_out"; readonly trecho: string };

const PEDIDO_DE_HUMANO = [
  /\batendente\b/,
  /\bhumano\b/,
  /pessoa de verdade/,
  /falar com (alguem|uma pessoa|um vendedor|o vendedor|o dono|o gerente)/,
  /quero (um|uma)? ?(vendedor|atendente)/,
  /me (transfere|passa) pra/,
  /\bnao (quero|to) falando com (robo|bot|maquina)/,
  /\b(e|eh) (robo|bot)\b/,
];

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
];

const OPT_OUT = [
  /^\s*(sair|parar|pare|cancelar|descadastrar|stop)\s*$/,
  /nao (quero|queria) (mais )?receber/,
  /para de (me )?mandar/,
  /me (tira|remove|descadastra)/,
  /nao me manda mais/,
];

function bate(padroes: readonly RegExp[], texto: string): string | null {
  for (const padrao of padroes) {
    const encontrado = padrao.exec(texto);
    if (encontrado !== null) return encontrado[0].trim();
  }
  return null;
}

/**
 * Decide, sem modelo nenhum, se a mensagem já resolve o rumo da conversa.
 * A ordem é a de gravidade: sair antes de tudo, depois pedido de humano.
 */
export function triar(texto: string): ResultadoTriagem {
  const alvo = semAcento(texto).toLowerCase().trim();

  const saida = bate(OPT_OUT, alvo);
  if (saida !== null) return { tipo: "opt_out", trecho: saida };

  const humano = bate(PEDIDO_DE_HUMANO, alvo);
  if (humano !== null) return { tipo: "escalar", motivo: "pedido_do_cliente", trecho: humano };

  const irritado = bate(FRUSTRACAO, alvo);
  if (irritado !== null) return { tipo: "escalar", motivo: "frustracao", trecho: irritado };

  return { tipo: "seguir" };
}
