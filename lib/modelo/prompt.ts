// Montagem do prompt. As regras duras estão aqui e também no código: prompt
// é orientação, não trava. O texto é versionado por hash.

import { createHash } from "node:crypto";
import { CATALOGO, type NomeFerramenta } from "../ferramentas/catalogo.js";
import { ferramentasDisponiveis, type EstadoConversa } from "../dominio/conversa.js";
import type { MensagemModelo, MensagemRegistro } from "../portas.js";
import type { ConfigTenant } from "../tenant/schema.js";

const REGRAS = `Regras que você não pode quebrar:
1. Você NUNCA escreve número de dinheiro, percentual ou parcela. Para citar qualquer valor, use um marcador entre chaves duplas, como {{preco_avista}}. Quem substitui pelo número real é o sistema.
2. Só existe valor que veio de ferramenta. Se você não chamou a ferramenta, você não sabe o preço, e não pode inventar nem aproximar.
3. Uma pergunta por mensagem. Nunca mande bloco de perguntas.
4. Não prometa prazo de entrega, garantia estendida, frete ou qualquer condição que não esteja no resultado de uma ferramenta.
5. Se o cliente pedir para falar com uma pessoa, ou se irritar, chame a ferramenta escalar_humano na hora.
6. Nunca peça foto do aparelho. Se o cliente mandar uma por conta própria, ela entra como pré-avaliação e você agradece; sem foto, o checklist já basta.
7. Ao citar valor de troca, a mensagem precisa dizer que é pré-avaliação e que a conferência final é na loja. O marcador da ressalva vem no retorno da ferramenta.
8. Não afirme escassez nem prazo ("última unidade", "só hoje") a menos que a ferramenta tenha confirmado.
9. Responda sempre em JSON válido, sem texto fora do JSON, sem markdown, sem crase.`;

const FORMATO = `Formato da resposta, exatamente um destes três objetos:

{"acao":"responder","texto":"mensagem para o cliente com {{marcadores}}","evento":"opcional"}
{"acao":"chamar_ferramenta","ferramenta":"nome_da_ferramenta","argumentos":{}}
{"acao":"escalar","motivo":"pedido_do_cliente","resumo":"por que está passando"}

Eventos que você pode sinalizar em "evento": intencao_identificada, produto_escolhido, pediu_desconto, ofereceu_aparelho, avaliacao_concluida, acordo, impasse, encerrar.`;

function descreverFerramentas(nomes: readonly NomeFerramenta[]): string {
  return nomes.map((n) => `- ${n}: ${CATALOGO[n].descricao}`).join("\n");
}

function horarioLegivel(config: ConfigTenant): string {
  const h = config.tenant.horario;
  const partes = [
    h.seg_sex === null ? null : `segunda a sexta ${h.seg_sex}`,
    h.sabado === null ? null : `sábado ${h.sabado}`,
    h.domingo === null ? "fechado no domingo" : `domingo ${h.domingo}`,
  ].filter((p): p is string => p !== null);
  return partes.join(", ");
}

export interface ContextoPrompt {
  readonly config: ConfigTenant;
  readonly estado: EstadoConversa;
  /** Anotações que a conversa carrega entre turnos. */
  readonly memoria: Readonly<Record<string, string>>;
}

/** Texto do sistema para o estado atual da conversa. */
export function montarPrompt(contexto: ContextoPrompt): string {
  const { config, estado, memoria } = contexto;
  const nomes = ferramentasDisponiveis(estado);
  const anotacoes = Object.entries(memoria)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return [
    `Você é o atendimento da ${config.tenant.nome_exibicao}, uma loja de celulares.`,
    `Fale como um vendedor brasileiro experiente: direto, educado, sem formalidade de robô e sem exagero de simpatia. Frases curtas.`,
    `Horário da loja: ${horarioLegivel(config)}.`,
    "",
    `Estado atual da conversa: ${estado}.`,
    `Ferramentas disponíveis agora (nenhuma outra existe):`,
    descreverFerramentas(nomes),
    "",
    anotacoes === "" ? "Nenhuma anotação da conversa até aqui." : `Anotações da conversa:\n${anotacoes}`,
    "",
    REGRAS,
    "",
    FORMATO,
  ].join("\n");
}

/** Identificador curto e estável da versão do prompt. */
export function versaoDoPrompt(prompt: string): string {
  return `p-${createHash("sha256").update(prompt).digest("hex").slice(0, 12)}`;
}

export interface EntradaMontagem extends ContextoPrompt {
  readonly historico: readonly MensagemRegistro[];
  /** Retornos de ferramenta desta rodada, na ordem em que aconteceram. */
  readonly retornosFerramenta: readonly string[];
}

/** Monta a conversa completa que vai para o modelo. */
export function montarMensagens(entrada: EntradaMontagem): MensagemModelo[] {
  const sistema = montarPrompt(entrada);
  const mensagens: MensagemModelo[] = [{ papel: "sistema", conteudo: sistema }];

  for (const m of entrada.historico) {
    mensagens.push({
      papel: m.direcao === "entrada" ? "usuario" : "assistente",
      conteudo: m.texto,
    });
  }

  for (const retorno of entrada.retornosFerramenta) {
    mensagens.push({ papel: "ferramenta", conteudo: retorno });
  }

  return mensagens;
}
