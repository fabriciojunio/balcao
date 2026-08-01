// Bateria de conversas de referência. É o artefato mais importante do
// projeto: cada erro que o bot antigo cometeu vira um caso aqui, e nenhuma
// mudança de política, de prompt ou de versão de modelo sobe sem passar por
// todos eles.
//
// Origem de cada caso:
//   bot_antigo  - erro observado na operação anterior da loja
//   operacao    - regra de negócio que a loja exige
//   adversarial - tentativa deliberada de furar as travas

import { reais } from "../lib/dinheiro.js";

export type OrigemCaso = "bot_antigo" | "operacao" | "adversarial";

export interface CasoDesconto {
  readonly cenario: "desconto";
  readonly produto: "iphone_novo" | "seminovo_apertado" | "lancamento";
  readonly valorPedidoReais?: number;
  readonly rodada: number;
  readonly esperado: {
    readonly situacao: "aprovado" | "contraproposta" | "recusado";
    readonly precoFinalReais?: number;
    readonly nuncaAbaixoDoPiso: true;
  };
}

export interface CasoCotacao {
  readonly cenario: "cotacao";
  readonly valorBaseReais: number;
  readonly estado: string;
  readonly defeitos: readonly string[];
  readonly esperado:
    | { readonly recusado: true }
    | { readonly recusado: false; readonly valorReais: number; readonly exigeAvaliacaoHumana?: boolean };
}

export interface CasoParcelamento {
  readonly cenario: "parcelamento";
  readonly valorReais: number;
  readonly parcelas: number;
  readonly esperado: { readonly ok: boolean; readonly totalReais?: number };
}

export interface CasoMensagem {
  readonly cenario: "mensagem";
  readonly texto: string;
  readonly monetariosPermitidosReais: readonly number[];
  readonly parcelasPermitidas?: readonly number[];
  readonly esperado: { readonly aprovado: boolean };
}

export type CasoRegressao = { readonly nome: string; readonly origem: OrigemCaso } & (
  | CasoDesconto
  | CasoCotacao
  | CasoParcelamento
  | CasoMensagem
);

export const CASOS: readonly CasoRegressao[] = [
  // -------------------------------------------------------------------------
  // Negociação de preço
  // -------------------------------------------------------------------------
  {
    nome: "cliente pede metade do preço logo de cara",
    origem: "bot_antigo",
    cenario: "desconto",
    produto: "iphone_novo",
    valorPedidoReais: 1600,
    rodada: 0,
    esperado: { situacao: "contraproposta", precoFinalReais: 3200, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "cliente insiste e chega na última rodada",
    origem: "operacao",
    cenario: "desconto",
    produto: "iphone_novo",
    valorPedidoReais: 2800,
    rodada: 2,
    esperado: { situacao: "contraproposta", precoFinalReais: 3072, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "cliente insiste muito além das rodadas configuradas",
    origem: "adversarial",
    cenario: "desconto",
    produto: "iphone_novo",
    valorPedidoReais: 100,
    rodada: 30,
    esperado: { situacao: "contraproposta", precoFinalReais: 3072, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "pedido dentro da margem é aceito na hora",
    origem: "operacao",
    cenario: "desconto",
    produto: "iphone_novo",
    valorPedidoReais: 3150,
    rodada: 1,
    esperado: { situacao: "aprovado", precoFinalReais: 3150, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "seminovo de margem apertada não desconta",
    origem: "operacao",
    cenario: "desconto",
    produto: "seminovo_apertado",
    valorPedidoReais: 1600,
    rodada: 2,
    esperado: { situacao: "contraproposta", precoFinalReais: 1800, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "lançamento não desconta nem sob insistência",
    origem: "operacao",
    cenario: "desconto",
    produto: "lancamento",
    valorPedidoReais: 5000,
    rodada: 5,
    esperado: { situacao: "recusado", precoFinalReais: 6500, nuncaAbaixoDoPiso: true },
  },
  {
    nome: "cliente só pergunta se tem desconto, sem citar valor",
    origem: "operacao",
    cenario: "desconto",
    produto: "iphone_novo",
    rodada: 0,
    esperado: { situacao: "recusado", precoFinalReais: 3200, nuncaAbaixoDoPiso: true },
  },

  // -------------------------------------------------------------------------
  // Avaliação de aparelho usado
  // -------------------------------------------------------------------------
  {
    nome: "aparelho em bom estado, sem defeito",
    origem: "operacao",
    cenario: "cotacao",
    valorBaseReais: 1200,
    estado: "bom",
    defeitos: [],
    esperado: { recusado: false, valorReais: 1104 },
  },
  {
    nome: "tela trincada derruba o valor conforme a tabela",
    origem: "bot_antigo",
    cenario: "cotacao",
    valorBaseReais: 1200,
    estado: "bom",
    defeitos: ["tela_trincada"],
    esperado: { recusado: false, valorReais: 684 },
  },
  {
    nome: "aparelho com conta bloqueada é recusado",
    origem: "operacao",
    cenario: "cotacao",
    valorBaseReais: 1200,
    estado: "excelente",
    defeitos: ["bloqueio_conta"],
    esperado: { recusado: true },
  },
  {
    nome: "defeito fora da tabela não vira chute, vira avaliação humana",
    origem: "bot_antigo",
    cenario: "cotacao",
    valorBaseReais: 1200,
    estado: "bom",
    defeitos: ["camera_embacada"],
    esperado: { recusado: false, valorReais: 1104, exigeAvaliacaoHumana: true },
  },
  {
    nome: "aparelho barato demais depois dos redutores é recusado",
    origem: "operacao",
    cenario: "cotacao",
    valorBaseReais: 200,
    estado: "regular",
    defeitos: ["tela_trincada", "carcaca_amassada"],
    esperado: { recusado: true },
  },

  // -------------------------------------------------------------------------
  // Parcelamento
  // -------------------------------------------------------------------------
  {
    nome: "12x usa a taxa real da maquininha",
    origem: "operacao",
    cenario: "parcelamento",
    valorReais: 3200,
    parcelas: 12,
    esperado: { ok: true, totalReais: 3680 },
  },
  {
    nome: "parcelamento sem taxa cadastrada é recusado, não estimado",
    origem: "bot_antigo",
    cenario: "parcelamento",
    valorReais: 3200,
    parcelas: 7,
    esperado: { ok: false },
  },
  {
    nome: "18x que o cliente pediu e a loja não trabalha",
    origem: "adversarial",
    cenario: "parcelamento",
    valorReais: 3200,
    parcelas: 18,
    esperado: { ok: false },
  },

  // -------------------------------------------------------------------------
  // Mensagem final
  // -------------------------------------------------------------------------
  {
    nome: "mensagem com valor conferido passa",
    origem: "operacao",
    cenario: "mensagem",
    texto: "O iPhone 14 sai por R$ 3.072,00, ou 12x no cartão.",
    monetariosPermitidosReais: [3072],
    parcelasPermitidas: [12],
    esperado: { aprovado: true },
  },
  {
    nome: "modelo inventa um valor redondo no meio da conversa",
    origem: "bot_antigo",
    cenario: "mensagem",
    texto: "Consigo deixar por R$ 2.800,00 pra fechar hoje.",
    monetariosPermitidosReais: [3072],
    esperado: { aprovado: false },
  },
  {
    nome: "modelo escreve o preço sem formatar",
    origem: "bot_antigo",
    cenario: "mensagem",
    texto: "Fica 3072 no pix.",
    monetariosPermitidosReais: [3072],
    esperado: { aprovado: false },
  },
  {
    nome: "modelo soma o desconto por conta própria",
    origem: "bot_antigo",
    cenario: "mensagem",
    texto: "Com os 10% que combinamos fica R$ 2.764,80.",
    monetariosPermitidosReais: [3072],
    esperado: { aprovado: false },
  },
  {
    nome: "modelo promete parcelamento que a loja não tem",
    origem: "adversarial",
    cenario: "mensagem",
    texto: "Pode ser em 18x de R$ 3.072,00.",
    monetariosPermitidosReais: [3072],
    parcelasPermitidas: [12],
    esperado: { aprovado: false },
  },
  {
    nome: "mensagem cita memória e modelo sem virar falso positivo",
    origem: "operacao",
    cenario: "mensagem",
    texto: "Tenho o Galaxy S22 128 GB por R$ 3.072,00.",
    monetariosPermitidosReais: [3072],
    esperado: { aprovado: true },
  },
];

export const VALOR = { reais };
