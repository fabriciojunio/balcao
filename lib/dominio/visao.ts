// Leitura da foto do aparelho na troca.
//
// Regra que torna isso seguro: a foto só confirma ou piora a avaliação, nunca
// melhora. Se o modelo de visão alucinar um defeito, a conferência física
// corrige para cima; se ele deixar de ver um defeito, o que o cliente declarou
// continua valendo. O caminho em que a loja paga demais não existe.

export interface DefeitoVisto {
  readonly chave: string;
  /** 0 a 1. Abaixo do corte, entra como suspeita e não como defeito. */
  readonly confianca: number;
}

export interface LeituraDeImagem {
  readonly defeitos: readonly DefeitoVisto[];
  /** O modelo não conseguiu avaliar: foto escura, cortada, longe demais. */
  readonly inconclusiva: boolean;
  readonly observacao?: string;
}

export interface ResultadoMescla {
  readonly defeitos: readonly string[];
  /** Defeitos que a foto acusou e o cliente não tinha declarado. */
  readonly acrescentadosPelaFoto: readonly string[];
  /** Defeitos declarados que a foto não confirmou. Continuam valendo. */
  readonly naoConfirmados: readonly string[];
  readonly exigeAvaliacaoHumana: boolean;
}

export const CONFIANCA_MINIMA = 0.6;

/**
 * Junta o que o cliente declarou com o que a foto mostrou.
 * A união é sempre para o lado conservador: nada sai da lista.
 */
export function mesclarDefeitos(
  declarados: readonly string[],
  leitura: LeituraDeImagem,
  confiancaMinima = CONFIANCA_MINIMA,
): ResultadoMescla {
  const jaDeclarados = new Set(declarados);
  const confiaveis = leitura.defeitos.filter((d) => d.confianca >= confiancaMinima);

  const acrescentados = confiaveis.map((d) => d.chave).filter((c) => !jaDeclarados.has(c));
  const vistos = new Set(confiaveis.map((d) => d.chave));
  const naoConfirmados = declarados.filter((d) => !vistos.has(d));

  return {
    defeitos: [...declarados, ...acrescentados],
    acrescentadosPelaFoto: acrescentados,
    naoConfirmados,
    // Foto que acusa algo novo, ou que não deu para ler, sempre passa por
    // gente antes de virar proposta fechada.
    exigeAvaliacaoHumana: leitura.inconclusiva || acrescentados.length > 0,
  };
}

/** Defeitos que o modelo de visão pode reportar. Fora desta lista, ignora. */
export const DEFEITOS_VISIVEIS: readonly string[] = [
  "tela_trincada",
  "risco_leve",
  "carcaca_amassada",
  "tampa_trincada",
  "marca_de_uso",
  "lente_trincada",
];

export function apenasDefeitosConhecidos(leitura: LeituraDeImagem): LeituraDeImagem {
  return {
    ...leitura,
    defeitos: leitura.defeitos.filter((d) => DEFEITOS_VISIVEIS.includes(d.chave)),
  };
}
