// Normalização de texto compartilhada pelo domínio e pelo auditor.

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
