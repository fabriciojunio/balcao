export interface RegraDeLimite {
  readonly maximo: number;
  readonly janelaMs: number;
}

export interface Limitador {
  /** Segundos até poder tentar de novo, ou 0 quando a tentativa é permitida. */
  registrar(chave: string): number;
}

const MAXIMO_DE_CHAVES = 10_000;

/**
 * Janela fixa em memória. Vale por processo: com mais de uma instância, o
 * contador precisa ir para um armazenamento compartilhado.
 */
export function criarLimitador(regra: RegraDeLimite, agora: () => number = Date.now): Limitador {
  const janelas = new Map<string, { inicio: number; total: number }>();

  return {
    registrar(chave) {
      const instante = agora();
      const janela = janelas.get(chave);

      if (janela === undefined || instante - janela.inicio >= regra.janelaMs) {
        janelas.delete(chave);
        // O Map guarda a ordem de inserção: a primeira chave é a janela mais antiga.
        if (janelas.size >= MAXIMO_DE_CHAVES) {
          const maisAntiga = janelas.keys().next().value;
          if (maisAntiga !== undefined) janelas.delete(maisAntiga);
        }
        janelas.set(chave, { inicio: instante, total: 1 });
        return 0;
      }

      janela.total += 1;
      return janela.total > regra.maximo ? Math.ceil((janela.inicio + regra.janelaMs - instante) / 1000) : 0;
    },
  };
}
