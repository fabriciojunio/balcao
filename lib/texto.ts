// Normalização de texto compartilhada pelo domínio e pelo auditor.
// Cliente escreve com abreviação, sem acento e com erro de digitação; o
// sistema entende antes de decidir qualquer coisa.

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

// Abreviação de WhatsApp, do jeito que aparece de verdade na conversa.
const ABREVIACOES: Readonly<Record<string, string>> = {
  vc: "voce",
  vcs: "voces",
  vcw: "voce",
  tbm: "tambem",
  tb: "tambem",
  pq: "porque",
  q: "que",
  qnt: "quanto",
  qnto: "quanto",
  qto: "quanto",
  naum: "nao",
  nao: "nao",
  n: "nao",
  eh: "e",
  ta: "esta",
  tah: "esta",
  to: "estou",
  toh: "estou",
  blz: "beleza",
  mt: "muito",
  mto: "muito",
  hj: "hoje",
  amanha: "amanha",
  aki: "aqui",
  agr: "agora",
  dps: "depois",
  pfv: "por favor",
  pff: "por favor",
  pf: "por favor",
  td: "tudo",
  tds: "todos",
  obg: "obrigado",
  vlw: "valeu",
  flw: "falou",
  msg: "mensagem",
  cel: "celular",
  celu: "celular",
  ap: "aparelho",
  apar: "aparelho",
  gtia: "garantia",
  desc: "desconto",
  parc: "parcelamento",
  atend: "atendente",
  atendent: "atendente",
  pss: "pessoa",
  s: "sim",
  ss: "sim",
  sim: "sim",
  kd: "cade",
  vdd: "verdade",
  add: "adicionar",
  min: "minha",
  meu: "meu",
  bat: "bateria",
  tel: "tela",
};

/**
 * Troca abreviação por palavra inteira, palavra a palavra.
 * Só age em token isolado: "n" vira "nao", mas "n" dentro de "nota" fica.
 */
export function expandirAbreviacoes(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .split(/(\W+)/)
    .map((pedaco) => ABREVIACOES[pedaco] ?? pedaco)
    .join("");
}

/** Distância de edição, limitada para sair cedo quando já passou do teto. */
export function distancia(a: string, b: string, teto = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > teto) return teto + 1;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let menorDaLinha = i;

    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const valor = Math.min(atual[j - 1]! + 1, anterior[j]! + 1, anterior[j - 1]! + custo);
      atual.push(valor);
      if (valor < menorDaLinha) menorDaLinha = valor;
    }

    if (menorDaLinha > teto) return teto + 1;
    anterior = atual;
  }

  return anterior[b.length]!;
}

/** Tolerância proporcional: palavra curta não aceita erro, palavra longa aceita. */
function tolerancia(alvo: string): number {
  if (alvo.length <= 4) return 0;
  if (alvo.length <= 7) return 1;
  return 2;
}

/** Alguma palavra da frase é o alvo, escrito certo ou com erro de digitação? */
export function contemPalavraParecida(frase: string, alvo: string): boolean {
  const limite = tolerancia(alvo);
  const palavras = expandirAbreviacoes(frase).split(/\W+/).filter((p) => p.length > 0);

  return palavras.some((palavra) => {
    if (palavra === alvo) return true;
    if (limite === 0) return false;
    // Palavra muito maior que o alvo dificilmente é ele com erro.
    if (Math.abs(palavra.length - alvo.length) > limite) return false;
    return distancia(palavra, alvo, limite) <= limite;
  });
}
