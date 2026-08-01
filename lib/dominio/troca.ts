// Motor de avaliação de aparelho usado. Toda cotação sai com validade e com
// a ressalva de conferência física.

import { aplicarFator, descontarPercentual, type Centavos } from "../dinheiro.js";
import { contemPalavraParecida, expandirAbreviacoes, normalizarChave as normalizar } from "../texto.js";

/** Ajuste aplicado ao valor-base, em fração (-0.35 = tira 35%). */
export type Ajuste = number | "recusar";

export interface RegraTroca {
  /** Ajuste por estado geral declarado: { excelente: 0, bom: -0.08, ... } */
  readonly estados: Readonly<Record<string, number>>;
  /** Ajuste por defeito ou característica: { tela_trincada: -0.35, ... } */
  readonly redutores: Readonly<Record<string, Ajuste>>;
  /** Condições que recusam o aparelho de imediato. */
  readonly recusaAutomatica: readonly string[];
  /** Validade da cotação, em horas. */
  readonly validadeHoras: number;
  /** Amplitude da faixa comunicada ao cliente, em percentual. */
  readonly faixaPercentual: number;
  /** Limite de quanto os redutores somados podem derrubar o valor. */
  readonly ajusteMinimo: number;
  readonly exigeConferenciaFisica: boolean;
  /** Abaixo disto a loja não compra; vira recusa. */
  readonly valorMinimoAceito: Centavos;
}

export interface EntradaCotacao {
  readonly modelo: string;
  readonly valorBase: Centavos;
  readonly estadoDeclarado: string;
  readonly defeitos: readonly string[];
  readonly agora: Date;
  readonly regra: RegraTroca;
}

export interface AjusteAplicado {
  readonly chave: string;
  readonly ajuste: number;
}

export interface CotacaoRecusada {
  readonly recusado: true;
  readonly modelo: string;
  readonly motivo: string;
}

export interface CotacaoAceita {
  readonly recusado: false;
  readonly modelo: string;
  readonly valorBase: Centavos;
  readonly ajustesAplicados: readonly AjusteAplicado[];
  readonly ajusteTotal: number;
  readonly valor: Centavos;
  readonly faixaMin: Centavos;
  readonly faixaMax: Centavos;
  readonly validadeAte: Date;
  readonly exigeConferenciaFisica: boolean;
  /** Estado ou defeito fora da tabela: um humano precisa olhar. */
  readonly exigeAvaliacaoHumana: boolean;
  readonly ressalvas: readonly string[];
}

export type ResultadoCotacao = CotacaoRecusada | CotacaoAceita;

const RESSALVA_CONFERENCIA = "Valor sujeito a conferência física do aparelho na loja.";
const RESSALVA_DESCONHECIDO = "Há item declarado fora da tabela; a loja vai confirmar antes de fechar.";

/** Pior ajuste de estado da tabela, usado quando o estado declarado é desconhecido. */
function ajusteConservadorDeEstado(estados: Readonly<Record<string, number>>): number {
  const valores = Object.values(estados);
  return valores.length === 0 ? 0 : Math.min(...valores);
}

/**
 * Calcula o valor que a loja paga por um aparelho usado.
 * Recusa antes de calcular quando bate qualquer condição vetada, e nunca
 * devolve valor abaixo do mínimo que a loja aceita comprar.
 */
export function cotarUsado(entrada: EntradaCotacao): ResultadoCotacao {
  const { modelo, valorBase, agora, regra } = entrada;
  const estado = normalizar(entrada.estadoDeclarado);
  const defeitos = entrada.defeitos.map(normalizar);
  const vetados = regra.recusaAutomatica.map(normalizar);

  if (valorBase <= 0) {
    return { recusado: true, modelo, motivo: "Modelo sem valor de referência na tabela da loja." };
  }

  const vetado = defeitos.find((d) => vetados.includes(d));
  if (vetado) {
    return { recusado: true, modelo, motivo: `Condição não aceita pela loja: ${vetado}.` };
  }

  const redutoresNormalizados = new Map<string, Ajuste>(
    Object.entries(regra.redutores).map(([k, v]) => [normalizar(k), v]),
  );
  const recusaPorRedutor = defeitos.find((d) => redutoresNormalizados.get(d) === "recusar");
  if (recusaPorRedutor) {
    return { recusado: true, modelo, motivo: `Condição não aceita pela loja: ${recusaPorRedutor}.` };
  }

  const estadosNormalizados = new Map<string, number>(
    Object.entries(regra.estados).map(([k, v]) => [normalizar(k), v]),
  );

  const ajustesAplicados: AjusteAplicado[] = [];
  let exigeAvaliacaoHumana = false;

  const ajusteEstado = estadosNormalizados.get(estado);
  if (ajusteEstado === undefined) {
    exigeAvaliacaoHumana = true;
    ajustesAplicados.push({ chave: `estado:${estado}`, ajuste: ajusteConservadorDeEstado(regra.estados) });
  } else if (ajusteEstado !== 0) {
    ajustesAplicados.push({ chave: `estado:${estado}`, ajuste: ajusteEstado });
  }

  for (const defeito of defeitos) {
    const ajuste = redutoresNormalizados.get(defeito);
    if (ajuste === undefined) {
      exigeAvaliacaoHumana = true;
      continue;
    }
    if (typeof ajuste === "number" && ajuste !== 0) {
      ajustesAplicados.push({ chave: defeito, ajuste });
    }
  }

  const soma = ajustesAplicados.reduce((total, a) => total + a.ajuste, 0);
  const ajusteTotal = Math.max(Math.min(soma, 0), regra.ajusteMinimo);
  const valor = Math.max(aplicarFator(valorBase, 1 + ajusteTotal), 0);

  if (valor < regra.valorMinimoAceito) {
    return {
      recusado: true,
      modelo,
      motivo: "O valor apurado ficou abaixo do mínimo que a loja compra.",
    };
  }

  const ressalvas: string[] = [];
  if (regra.exigeConferenciaFisica) ressalvas.push(RESSALVA_CONFERENCIA);
  if (exigeAvaliacaoHumana) ressalvas.push(RESSALVA_DESCONHECIDO);

  return {
    recusado: false,
    modelo,
    valorBase,
    ajustesAplicados,
    ajusteTotal,
    valor,
    // A faixa nunca sobe acima do valor apurado: prometer mais do que a
    // tabela permite é o erro que a conferência física teria que desdizer.
    faixaMin: descontarPercentual(valor, regra.faixaPercentual),
    faixaMax: valor,
    validadeAte: new Date(agora.getTime() + regra.validadeHoras * 3_600_000),
    exigeConferenciaFisica: regra.exigeConferenciaFisica,
    exigeAvaliacaoHumana,
    ressalvas,
  };
}

/** A cotação ainda vale neste instante? */
export function cotacaoValida(cotacao: CotacaoAceita, agora: Date): boolean {
  return agora.getTime() <= cotacao.validadeAte.getTime();
}

// ---------------------------------------------------------------------------
// Checklist guiado
// ---------------------------------------------------------------------------

export interface PerguntaChecklist {
  readonly chave: string;
  readonly pergunta: string;
  readonly opcoes: readonly string[];
  /** Perguntas de maior impacto no valor vêm primeiro. */
  readonly peso: number;
}

/**
 * Ordem pensada para derrubar cedo o aparelho que a loja não compra e só
 * depois refinar o valor. Uma pergunta por mensagem, sempre.
 */
export const CHECKLIST_PADRAO: readonly PerguntaChecklist[] = [
  {
    chave: "bloqueio_conta",
    pergunta: "O aparelho está com alguma conta bloqueando, tipo iCloud ou conta Google?",
    opcoes: ["sim", "nao"],
    peso: 100,
  },
  {
    chave: "liga_normalmente",
    pergunta: "Ele liga e funciona normalmente?",
    opcoes: ["sim", "nao"],
    peso: 90,
  },
  {
    chave: "tela",
    pergunta: "Como está a tela? Sem marca, com risco leve ou trincada?",
    opcoes: ["sem_marca", "risco_leve", "tela_trincada"],
    peso: 80,
  },
  {
    chave: "bateria",
    pergunta: "Sabe qual a saúde da bateria? Se não souber, tudo bem.",
    opcoes: ["acima_85", "bateria_abaixo_80", "nao_sei"],
    peso: 60,
  },
  {
    chave: "carcaca",
    pergunta: "A carcaça tem amassado ou a tampa traseira está trincada?",
    opcoes: ["integra", "marca_de_uso", "carcaca_amassada", "tampa_trincada"],
    peso: 50,
  },
  {
    chave: "acessorios",
    pergunta: "Você tem a caixa e a nota fiscal?",
    opcoes: ["caixa_e_nota", "so_caixa", "sem_caixa"],
    peso: 20,
  },
];

/** Próxima pergunta do checklist que ainda não foi respondida. */
export function proximaPergunta(
  respondidas: readonly string[],
  checklist: readonly PerguntaChecklist[] = CHECKLIST_PADRAO,
): PerguntaChecklist | null {
  const pendentes = checklist
    .filter((p) => !respondidas.includes(p.chave))
    .sort((a, b) => b.peso - a.peso);
  return pendentes[0] ?? null;
}

export function checklistCompleto(
  respondidas: readonly string[],
  checklist: readonly PerguntaChecklist[] = CHECKLIST_PADRAO,
): boolean {
  return proximaPergunta(respondidas, checklist) === null;
}

const ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/trincad|quebrad|rachad|estourad|estilhac/, "tela_trincada"],
  [/risco|arranh|risquin|riscad/, "risco_leve"],
  [/sem marca|impecav|perfeit|zerad|novin|sem risco|nenhuma marca|lisa/, "sem_marca"],
  [/amassad|entortad|torto|batid/, "carcaca_amassada"],
  [/tampa/, "tampa_trincada"],
  [/marca de uso|uso normal|marquinha|sinal de uso/, "marca_de_uso"],
  [/inteir|integr|conservad|firme/, "integra"],
  [/caixa e a? ?nota|nota e a? ?caixa|tenho tudo|completo|tudo certinho/, "caixa_e_nota"],
  [/so a caixa|somente a caixa|so caixa|sem a nota|sem nota/, "so_caixa"],
  [/sem caixa|sem a caixa|perdi|joguei fora|nao tenho nada/, "sem_caixa"],
  [/nao sei|sei nao|nem sei|nao faco ideia|nem olhei/, "nao_sei"],
  [/8[5-9]|9\d|100|otima|nova|boa saude|cheia/, "acima_85"],
  [/[1-7]\d(?!\d)|abaixo|fraca|acaba rapido|viciad|ruim|nao segura/, "bateria_abaixo_80"],
];

// "está" e "tem" são ambíguos demais para virar sim: "está limpo" é não.
const AFIRMA = /\b(sim|claro|isso|positivo|uhum|aham|certo|exato|liga|funciona|normal)\b/;
const NEGA = /\b(nao|nunca|negativo|nada|nenhum|nenhuma|zero|limpo|livre)\b/;

/**
 * Traduz a resposta livre do cliente na opção do checklist. Devolve null
 * quando não dá para decidir, e aí a pergunta é repetida.
 */
export function interpretarResposta(pergunta: PerguntaChecklist, textoLivre: string): string | null {
  const texto = expandirAbreviacoes(textoLivre).replaceAll("_", " ");

  for (const opcao of pergunta.opcoes) {
    if (texto.includes(opcao.replaceAll("_", " "))) return opcao;
  }
  if (pergunta.opcoes.includes("nao") && NEGA.test(texto)) return "nao";
  if (pergunta.opcoes.includes("sim") && AFIRMA.test(texto)) return "sim";
  for (const [padrao, opcao] of ALIASES) {
    if (pergunta.opcoes.includes(opcao) && padrao.test(texto)) return opcao;
  }
  // Última tentativa: a opção escrita com erro de digitação.
  for (const opcao of pergunta.opcoes) {
    const palavras = opcao.split("_").filter((p) => p.length > 4);
    if (palavras.length > 0 && palavras.every((p) => contemPalavraParecida(texto, p))) return opcao;
  }

  return null;
}

/**
 * Estado geral deduzido do checklist. Cada defeito específico já tem o seu
 * redutor, então o estado só distingue o aparelho sem nenhuma ressalva: cobrar
 * duas vezes pelo mesmo problema derruba o valor sem justificativa.
 */
export function estadoDeRespostas(respostas: Readonly<Record<string, string>>): string {
  return defeitosDeRespostas(respostas).length === 0 ? "excelente" : "bom";
}

/**
 * Converte as respostas do checklist na lista de defeitos que o motor entende.
 * Respostas neutras (sem marca, íntegra, acima de 85%) não viram redutor.
 */
export function defeitosDeRespostas(respostas: Readonly<Record<string, string>>): string[] {
  const neutras = new Set(["sim", "nao", "sem_marca", "integra", "acima_85", "caixa_e_nota", "nao_sei"]);
  const defeitos: string[] = [];

  for (const [chave, valor] of Object.entries(respostas)) {
    const v = normalizar(valor);
    if (chave === "bloqueio_conta" && v === "sim") {
      defeitos.push("bloqueio_conta");
      continue;
    }
    if (chave === "liga_normalmente" && v === "nao") {
      defeitos.push("nao_liga");
      continue;
    }
    if (!neutras.has(v)) defeitos.push(v);
  }

  return defeitos;
}
