// Catálogo fechado de ferramentas. O modelo não alcança nada fora daqui.

import { z } from "zod";

export const NOMES_FERRAMENTAS = [
  "consultar_estoque",
  "detalhar_produto",
  "simular_parcelamento",
  "avaliar_desconto",
  "iniciar_avaliacao_usado",
  "cotar_usado",
  "montar_proposta_troca",
  "reservar_produto",
  "registrar_lead",
  "escalar_humano",
  "agendar_visita",
] as const;

export type NomeFerramenta = (typeof NOMES_FERRAMENTAS)[number];

export interface DefinicaoFerramenta {
  readonly nome: NomeFerramenta;
  readonly descricao: string;
  readonly entrada: z.ZodTypeAny;
  /** Devolve valores monetários que precisam entrar no contexto do auditor. */
  readonly produzValores: boolean;
}

export const CATALOGO: Readonly<Record<NomeFerramenta, DefinicaoFerramenta>> = {
  consultar_estoque: {
    nome: "consultar_estoque",
    descricao: "Busca aparelhos disponíveis por modelo, memória, cor ou faixa de preço.",
    entrada: z.object({
      termo: z.string().min(1),
      memoria_gb: z.number().int().positive().optional(),
      cor: z.string().optional(),
      preco_maximo_reais: z.number().positive().optional(),
    }),
    produzValores: true,
  },
  detalhar_produto: {
    nome: "detalhar_produto",
    descricao: "Traz a ficha completa de um aparelho já listado, com garantia e acessórios.",
    entrada: z.object({ produto_id: z.string().min(1) }),
    produzValores: true,
  },
  simular_parcelamento: {
    nome: "simular_parcelamento",
    descricao: "Calcula parcelas com as taxas reais da maquininha da loja.",
    entrada: z.object({
      valor_reais: z.number().positive().optional(),
      parcelas: z.number().int().positive().optional(),
    }),
    produzValores: true,
  },
  avaliar_desconto: {
    nome: "avaliar_desconto",
    descricao: "Pergunta à política se um valor pedido pelo cliente pode ser aceito.",
    entrada: z.object({
      produto_id: z.string().optional(),
      valor_pedido_reais: z.number().positive().optional(),
    }),
    produzValores: true,
  },
  iniciar_avaliacao_usado: {
    nome: "iniciar_avaliacao_usado",
    descricao: "Abre o checklist do aparelho que o cliente quer dar na troca.",
    entrada: z.object({ modelo_declarado: z.string().min(1) }),
    produzValores: false,
  },
  cotar_usado: {
    nome: "cotar_usado",
    descricao: "Fecha a avaliação e devolve a faixa de valor, com validade e ressalvas.",
    entrada: z.object({
      avaliacao_id: z.string().optional(),
      respostas: z.record(z.string(), z.string()).default({}),
      /** O que o cliente escreveu. O sistema traduz para a opção do checklist. */
      resposta_livre: z.string().optional(),
    }),
    produzValores: true,
  },
  montar_proposta_troca: {
    nome: "montar_proposta_troca",
    descricao: "Junta o aparelho desejado e a cotação do usado e devolve a diferença a pagar.",
    entrada: z.object({
      produto_id: z.string().optional(),
      cotacao_id: z.string().optional(),
      parcelas: z.number().int().positive().optional(),
    }),
    produzValores: true,
  },
  reservar_produto: {
    nome: "reservar_produto",
    descricao: "Segura a unidade para este cliente pelo prazo configurado.",
    entrada: z.object({ produto_id: z.string().optional() }),
    produzValores: false,
  },
  registrar_lead: {
    nome: "registrar_lead",
    descricao: "Grava o interesse do cliente junto com o consentimento declarado.",
    entrada: z.object({
      nome: z.string().optional(),
      interesse: z.string().min(1),
      aceita_contato: z.boolean().default(false),
    }),
    produzValores: false,
  },
  escalar_humano: {
    nome: "escalar_humano",
    descricao: "Passa a conversa para um vendedor, com o histórico completo.",
    entrada: z.object({
      motivo: z.enum([
        "frustracao",
        "fora_de_escopo",
        "falha_auditor",
        "valor_acima_alcada",
        "pedido_do_cliente",
        "avaliacao_humana_necessaria",
      ]),
      resumo: z.string().min(1),
    }),
    produzValores: false,
  },
  agendar_visita: {
    nome: "agendar_visita",
    descricao: "Marca uma ida do cliente à loja dentro do horário de funcionamento.",
    entrada: z.object({
      data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      periodo: z.enum(["manha", "tarde"]),
    }),
    produzValores: false,
  },
};

export function ehNomeDeFerramenta(valor: string): valor is NomeFerramenta {
  return (NOMES_FERRAMENTAS as readonly string[]).includes(valor);
}
