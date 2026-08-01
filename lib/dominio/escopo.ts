// O agente atende sobre a loja: aparelho, preço, parcelamento, troca e visita.
// Fora disso ele não conversa. Pedido ilícito é recusado e registrado, e o
// assunto alheio é devolvido para a venda.
//
// A detecção é determinística de propósito: recusar crime não pode depender de
// o modelo estar bem-humorado.

import { contemPalavraParecida, expandirAbreviacoes } from "../texto.js";

export type ResultadoEscopo =
  | { readonly tipo: "no_assunto" }
  | { readonly tipo: "ilicito"; readonly termo: string }
  | { readonly tipo: "fora_do_assunto"; readonly termo: string };

/** Pedido que a loja não pode atender de jeito nenhum. */
const ILICITO: readonly RegExp[] = [
  /\b(roubado|furtado|roubei|furtei)\b/,
  /aparelho de (procedencia duvidosa|origem duvidosa)/,
  /desbloque(ar|io|ia) (o |a |de )?(icloud|conta google|conta da apple|conta do google)/,
  /tirar (o |a )?(icloud|conta) (de|do|da)/,
  /(trocar|mudar|alterar|clonar) (o |a )?imei/,
  /nota (fria|falsa)|meia nota|sem passar na nota|por fora da nota/,
  /clonar (o )?(chip|celular|aparelho)/,
  /rastrear (o )?(celular|telefone) (da|do|de) (minha|meu|outra|outro)/,
  /espionar|grampear/,
  /\b(maconha|cocaina|drogas|arma de fogo|pistola|revolver)\b/,
  /lavar dinheiro|dinheiro sujo/,
  /cartao (clonado|roubado)/,
];

/** Assunto que existe, mas não é com a loja. */
const FORA_DO_ASSUNTO: readonly RegExp[] = [
  /\b(politica|eleicao|presidente|bolsonaro|lula)\b/,
  /\b(futebol|flamengo|corinthians|palmeiras|jogo do)\b/,
  /\b(receita de|como fazer bolo|comida)\b/,
  /\b(remedio|medico|sintoma|doenca|diagnostico)\b/,
  /\b(emprego|vaga|curriculo|contrata)\b/,
  /\b(emprestimo|financiamento pessoal|consorcio|cartao de credito novo)\b/,
  /\b(aposta|bet|cassino|jogo do bicho)\b/,
  /\b(namorada|namorado|casamento|horoscopo)\b/,
  /me ajuda com (a|o) (prova|trabalho|redacao|licao)/,
  /qual (a|e) (previsao do tempo|cotacao do dolar)/,
];

function bate(padroes: readonly RegExp[], texto: string): string | null {
  for (const padrao of padroes) {
    const achado = padrao.exec(texto);
    if (achado !== null) return achado[0].trim();
  }
  return null;
}

/** Palavras cujo simples aparecimento já tira a conversa do assunto da loja. */
const PALAVRAS_ILICITAS = ["roubado", "furtado", "desbloqueio", "clonado"];

/**
 * Classifica a mensagem do cliente. Ilícito vem antes de tudo: se a frase
 * tem os dois sinais, o que manda é a recusa.
 */
export function avaliarEscopo(texto: string): ResultadoEscopo {
  const alvo = expandirAbreviacoes(texto).trim();

  const proibido = bate(ILICITO, alvo) ?? PALAVRAS_ILICITAS.find((p) => contemPalavraParecida(alvo, p));
  if (proibido !== undefined && proibido !== null) return { tipo: "ilicito", termo: proibido };

  const alheio = bate(FORA_DO_ASSUNTO, alvo);
  if (alheio !== null) return { tipo: "fora_do_assunto", termo: alheio };

  return { tipo: "no_assunto" };
}
