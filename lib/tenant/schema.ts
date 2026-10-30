// Contrato da configuração de uma loja. Cliente novo é um arquivo validado
// por este esquema, nunca um "if" no código.

import { z } from "zod";

const horario = z
  .string()
  .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "Use o formato HH:MM-HH:MM")
  .nullable();

const percentual = z.number().min(0).max(100);
const fracaoNegativa = z.number().min(-1).max(0);

export const identidadeSchema = z.object({
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "O slug aceita apenas minúsculas, números e hífen"),
  nome_exibicao: z.string().min(2),
  fuso: z.string().default("America/Sao_Paulo"),
  telefone_publico: z.string().optional(),
  endereco: z.string().optional(),
  /** Números que podem aparecer no texto sem serem preço (endereço, ramal). */
  numeros_publicos: z.array(z.number()).default([]),
  horario: z
    .object({
      seg_sex: horario.default("09:00-18:00"),
      sabado: horario.default("09:00-13:00"),
      domingo: horario.default(null),
    })
    // prefault: o {} passa pelo schema e ganha os horários padrão acima.
    .prefault({}),
});

export const canalSchema = z.object({
  provedor: z.enum(["meta_cloud_api", "simulador"]),
  numero_id: z.string().default(""),
  /** Espera antes de responder, para juntar mensagem picotada. */
  janela_resposta_segundos: z.number().int().min(0).max(60).default(8),
});

const runtimeModelo = z.object({
  runtime: z.enum(["ollama", "openai_compat", "simulador"]),
  /** Versão exata. Apelido genérico é proibido: é o que quebra na atualização. */
  id: z.string().min(1),
  base_url: z.string().url().optional(),
});

export const modeloSchema = z.object({
  primario: runtimeModelo,
  contingencia: runtimeModelo.optional(),
  temperatura: z.number().min(0).max(1).default(0.3),
  teto_tokens_conversa: z.number().int().min(500).max(64000).default(6000),
});

export const politicaPrecoSchema = z.object({
  margem_minima_percentual: z.number().min(0).max(99),
  teto_desconto_percentual: z.object({
    novo_lacrado: percentual,
    seminovo: percentual,
    acessorio: percentual,
  }),
  concessao_por_rodada: z.array(percentual).min(1),
  etiquetas_sem_desconto: z.array(z.string()).default([]),
  alcada_aprovacao_humana_reais: z.number().min(0),
  arredondamento_reais: z.number().positive().default(1),
  /** Acréscimo percentual por número de parcelas, conforme a maquininha. */
  taxas_parcelamento: z.record(z.string().regex(/^\d+$/), z.number().min(0)),
});

export const trocaSchema = z.object({
  validade_horas: z.number().int().min(1).max(720).default(48),
  faixa_percentual: percentual.default(6),
  ajuste_minimo: fracaoNegativa.default(-0.85),
  exige_conferencia_fisica: z.boolean().default(true),
  valor_minimo_aceito_reais: z.number().min(0).default(100),
  /** Frase que toda mensagem com valor de troca precisa conter. */
  texto_ressalva: z
    .string()
    .min(10)
    .default(
      "Isso é uma pré-avaliação pelo que você me contou; o valor final sai depois da conferência do aparelho na loja.",
    ),
  /** Palavra que o auditor exige na mensagem para provar a ressalva. */
  termo_ressalva: z.string().min(3).default("pré-avaliação"),
  /** Foto do cliente entra como pré-avaliação. Nunca é pedida, só aceita. */
  aceita_foto: z.boolean().default(true),
  confianca_minima_foto: z.number().min(0).max(1).default(0.6),
  estados: z.record(z.string(), fracaoNegativa),
  redutores: z.record(z.string(), z.union([fracaoNegativa, z.literal("recusar")])),
  recusa_automatica: z.array(z.string()).default([]),
});

export const estoqueSchema = z.object({
  conector: z.enum(["painel", "arquivo", "api"]).default("painel"),
  idade_maxima_dado_segundos: z.number().int().min(30).max(86400).default(300),
  reserva_minutos: z.number().int().min(5).max(1440).default(60),
  base_url: z.string().url().optional(),
});

export const escalonamentoSchema = z.object({
  gatilhos: z
    .array(
      z.enum([
        "frustracao",
        "fora_de_escopo",
        "falha_auditor",
        "valor_acima_alcada",
        "pedido_do_cliente",
        "avaliacao_humana_necessaria",
      ]),
    )
    .default(["frustracao", "fora_de_escopo", "falha_auditor", "valor_acima_alcada", "pedido_do_cliente"]),
  max_falhas_auditor: z.number().int().min(1).max(5).default(2),
  max_rodadas_negociacao: z.number().int().min(1).max(10).default(3),
});

export const conformidadeSchema = z.object({
  aviso_inicial: z.string().min(10),
  url_privacidade: z.string().url(),
  retencao_conversas_dias: z.number().int().min(30).max(3650).default(365),
  frases_proibidas: z.array(z.string()).default([]),
});

export const textosSchema = z.object({
  audio_sem_transcricao: z
    .string()
    .default("Não consegui ouvir o áudio aqui. Pode me escrever, ou eu chamo um vendedor?"),
  midia_recebida: z
    .string()
    .default("Recebi seu arquivo. Vou pedir para um vendedor dar uma olhada e te responder."),
  foto_em_avaliacao: z
    .string()
    .default("Recebi a foto, obrigado. Ela ajuda na pré-avaliação, mas a conferência final é na loja."),
  despedida_opt_out: z
    .string()
    .default("Pronto, não te mando mais mensagem. Se precisar de algo, é só chamar aqui."),
  chamando_vendedor: z.string().default("Vou chamar um vendedor para te ajudar, só um instante."),
  fora_do_assunto: z
    .string()
    .default("Aqui eu só consigo ajudar com aparelho, preço, troca e visita à loja. Quer ver alguma coisa disso?"),
  assunto_recusado: z
    .string()
    .default("Sobre isso eu não consigo ajudar. Se for sobre compra ou troca de aparelho, estou à disposição."),
  fora_do_horario: z
    .string()
    .default("A loja está fechada agora, mas já deixei seu contato anotado e te respondemos na abertura."),
});

export const configTenantSchema = z.object({
  tenant: identidadeSchema,
  canal: canalSchema,
  modelo: modeloSchema,
  politica_preco: politicaPrecoSchema,
  troca: trocaSchema,
  estoque: estoqueSchema,
  escalonamento: escalonamentoSchema.prefault({}),
  conformidade: conformidadeSchema,
  textos: textosSchema.prefault({}),
});

export type ConfigTenant = z.infer<typeof configTenantSchema>;
export type IdentidadeTenant = z.infer<typeof identidadeSchema>;
