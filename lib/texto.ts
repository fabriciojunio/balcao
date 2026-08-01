// Normalização de texto compartilhada. Chave de tabela, nome de defeito e
// resposta do cliente chegam com acento, maiúscula e espaço em qualquer
// combinação; o domínio compara sempre a forma normalizada.

const DIACRITICOS = /[̀-ͯ]/g;

/** "Tela Trincada" e "tela trincada" viram a mesma chave: "tela_trincada". */
export function normalizarChave(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Remove acentos preservando espaços, para comparação de frase livre. */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(DIACRITICOS, "");
}

/** Colapsa espaços e quebras de linha em um único espaço. */
export function colapsarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}
