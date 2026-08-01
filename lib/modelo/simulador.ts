// Agente determinístico com as mesmas regras do prompt. Demonstra o fluxo
// sem GPU e faz os testes de ponta a ponta rodarem no CI.

import type { ClienteModelo, EntradaModelo, MensagemModelo, SaidaModelo } from "../portas.js";
import { ok, type Result } from "../result.js";
import { normalizarChave, semAcento } from "../texto.js";

const VERSAO = "simulador:v1";

const PEDE_HUMANO = /atendente|humano|pessoa de verdade|falar com alguem|vendedor de verdade/;
const FRUSTRADO = /absurdo|pessimo|ridiculo|cansei|palhacada|nao aguento|horrivel/;
const QUER_TROCAR = /troc|dou o meu|dar o meu|meu aparelho|entrada o meu|na troca/;
const QUER_PARCELAR = /parcel|cartao|vezes|\d+x|prestac/;
const QUER_DESCONTO = /desconto|melhor(a|ar)|faz por|ultimo preco|abaixa|barat/;
const QUER_FECHAR = /vou levar|fechad|quero esse|pode separar|fechar|to dentro/;
const QUER_VISITA = /passar (ai|na loja)|visitar|ir ai|amanha|hoje a tarde/;

function texto(mensagens: readonly MensagemModelo[], papel: MensagemModelo["papel"]): string {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i]!;
    if (m.papel === papel) return m.conteudo;
  }
  return "";
}

function estadoDoPrompt(sistema: string): string {
  return /Estado atual da conversa:\s*(\w+)/.exec(sistema)?.[1] ?? "recepcao";
}

function valorPedido(frase: string): number | undefined {
  const m = /(\d{2,3})(?:\.(\d{3}))?(?:,\d{1,2})?\b/.exec(frase.replace(/\s/g, ""));
  if (m === null) return undefined;
  const numero = Number(m[2] === undefined ? m[1] : `${m[1]}${m[2]}`);
  return numero >= 50 ? numero : undefined;
}

function parcelasPedidas(frase: string): number | undefined {
  const m = /(\d{1,2})\s*x/.exec(frase);
  return m === null ? undefined : Number(m[1]);
}

function responder(texto: string, evento?: string): Record<string, unknown> {
  return evento === undefined ? { acao: "responder", texto } : { acao: "responder", texto, evento };
}

function chamar(ferramenta: string, argumentos: Record<string, unknown> = {}, evento?: string) {
  return evento === undefined
    ? { acao: "chamar_ferramenta", ferramenta, argumentos }
    : { acao: "chamar_ferramenta", ferramenta, argumentos, evento };
}

/** Resposta depois de uma ferramenta ter rodado nesta mesma rodada. */
function aposFerramenta(retorno: string, ultimaDoCliente: string): Record<string, unknown> {
  const dados = JSON.parse(retorno) as Record<string, unknown>;
  const marcadores = (dados.marcadores as string[] | undefined) ?? [];
  const tem = (m: string): boolean => marcadores.includes(m);

  if (dados.erro === "estoque_desatualizado") {
    return { acao: "escalar", motivo: "fora_de_escopo", resumo: "estoque fora de sincronismo" };
  }
  if (dados.erro === "modelo_sem_tabela") {
    return {
      acao: "escalar",
      motivo: "avaliacao_humana_necessaria",
      resumo: "modelo de usado fora da tabela da loja",
    };
  }
  if (dados.erro === "parcelamento_indisponivel") {
    return responder("Nesse número de parcelas a gente não trabalha. Quer que eu veja em outra quantidade?");
  }
  if (dados.erro === "faltam_produto_ou_cotacao" || dados.erro === "sem_produto_em_foco") {
    return responder("Perfeito. E qual aparelho você quer levar?", "intencao_identificada");
  }
  if (dados.erro === "sem_valor_para_simular") {
    return responder("Me diz qual aparelho te interessa que eu já simulo o parcelamento.");
  }
  if (dados.erro !== undefined) {
    return responder("Deixa eu confirmar isso direitinho com um vendedor, só um instante.");
  }
  if (dados.recusado === true) {
    return responder(
      "Esse aparelho a gente não consegue pegar na troca, viu. Mas dá para seguir na compra normal se você quiser.",
      "aparelho_recusado",
    );
  }
  if (dados.encontrados === 0) {
    return responder("Esse modelo eu não tenho agora. Quer que eu veja alguma opção parecida?");
  }

  if (tem("pergunta")) return responder("{{pergunta}}");

  if (tem("faixa_min")) {
    return responder(
      "O seu {{usado}} fica entre {{faixa_min}} e {{faixa_max}}. {{ressalva}} " +
        "O valor vale até {{validade}}. Quer que eu monte a troca?",
    );
  }

  if (tem("diferenca")) {
    return responder(
      "Ficaria assim: o {{produto}} sai por {{preco_produto}}, o seu aparelho entra por {{valor_usado}} " +
        "e a diferença fica em {{diferenca}}. {{ressalva}} Vale até {{validade}}. Fecha assim?",
    );
  }

  if (tem("preco_final")) {
    if (dados.situacao === "recusado") {
      return responder("Nesse eu não consigo mexer no preço, ele fica em {{preco_final}}.");
    }
    if (dados.situacao === "aprovado") {
      return responder("Fechado por {{preco_final}}! Já separo pra você?", "acordo");
    }
    const fecha = QUER_FECHAR.test(semAcento(ultimaDoCliente).toLowerCase());
    return responder(
      `Consigo deixar o {{produto}} por {{preco_final}}. ${fecha ? "Já separo pra você?" : "Fecha assim?"}`,
    );
  }

  if (tem("valor_parcela")) {
    return responder("Dá para fazer em {{parcelas}} de {{valor_parcela}}, ficando {{total}} no total.");
  }

  if (tem("garantia")) {
    return responder(
      "O {{produto}} sai por {{preco_avista}} à vista, com {{garantia}} de garantia. Quer que eu simule no cartão?",
    );
  }

  if (tem("preco_1")) {
    const linhas = ["Tenho o {{produto_1}} por {{preco_1}}."];
    if (tem("preco_2")) linhas.push("Também tenho o {{produto_2}} por {{preco_2}}.");
    linhas.push("Qual deles te interessa mais?");
    return responder(linhas.join(" "), "produto_escolhido");
  }

  if (tem("prazo_reserva")) {
    return responder("Fechado! Separei aqui pra você, fica reservado por {{prazo_reserva}}. Pode passar na loja.");
  }

  if (tem("data_visita")) {
    return responder("Anotei sua visita para {{data_visita}}. Te espero!");
  }

  return responder("Anotado. Posso te ajudar em mais alguma coisa?");
}

function decidir(estado: string, frase: string, sistema: string): Record<string, unknown> {
  const t = semAcento(frase).toLowerCase();
  const temAvaliacao = /avaliacao_id/.test(sistema);
  const temCotacao = /cotacao_id/.test(sistema);

  if (PEDE_HUMANO.test(t)) {
    return { acao: "escalar", motivo: "pedido_do_cliente", resumo: "cliente pediu um vendedor" };
  }
  if (FRUSTRADO.test(t)) {
    return { acao: "escalar", motivo: "frustracao", resumo: "cliente demonstrou irritação" };
  }

  switch (estado) {
    case "recepcao":
      if (QUER_TROCAR.test(t)) {
        return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase }, "ofereceu_aparelho");
      }
      return chamar("consultar_estoque", { termo: frase }, "intencao_identificada");

    case "descoberta":
      if (QUER_TROCAR.test(t)) {
        return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase }, "ofereceu_aparelho");
      }
      return chamar("consultar_estoque", { termo: frase });

    case "apresentacao":
      if (QUER_TROCAR.test(t)) {
        return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase }, "ofereceu_aparelho");
      }
      if (QUER_DESCONTO.test(t)) {
        const pedido = valorPedido(t);
        return chamar(
          "avaliar_desconto",
          pedido === undefined ? {} : { valor_pedido_reais: pedido },
          "pediu_desconto",
        );
      }
      if (QUER_PARCELAR.test(t)) {
        const parcelas = parcelasPedidas(t);
        return chamar("simular_parcelamento", parcelas === undefined ? {} : { parcelas });
      }
      if (QUER_FECHAR.test(t)) return chamar("reservar_produto", {}, "acordo");
      if (QUER_VISITA.test(t)) return chamar("consultar_estoque", { termo: frase });
      return chamar("consultar_estoque", { termo: frase });

    case "avaliacao_usado":
      if (!temAvaliacao) return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase });
      return chamar("cotar_usado", { resposta_livre: frase });

    case "negociacao":
      if (temCotacao) return chamar("montar_proposta_troca", {});
      if (QUER_TROCAR.test(t)) {
        return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase }, "ofereceu_aparelho");
      }
      if (QUER_PARCELAR.test(t)) {
        const parcelas = parcelasPedidas(t);
        return chamar("simular_parcelamento", parcelas === undefined ? {} : { parcelas });
      }
      if (QUER_FECHAR.test(t)) return chamar("reservar_produto", {}, "acordo");
      {
        const pedido = valorPedido(t);
        return chamar("avaliar_desconto", pedido === undefined ? {} : { valor_pedido_reais: pedido });
      }

    case "fechamento":
      if (QUER_TROCAR.test(t)) {
        return chamar("iniciar_avaliacao_usado", { modelo_declarado: frase }, "ofereceu_aparelho");
      }
      if (QUER_VISITA.test(t)) {
        return chamar("registrar_lead", { interesse: frase, aceita_contato: true });
      }
      return chamar("reservar_produto", {});

    default:
      return responder("Estou aqui, pode falar.");
  }
}

export function clienteSimulador(): ClienteModelo {
  return {
    nome: "simulador",
    versao: VERSAO,

    async gerar(entrada: EntradaModelo): Promise<Result<SaidaModelo>> {
      const sistema = texto(entrada.mensagens, "sistema");
      const cliente = texto(entrada.mensagens, "usuario");
      const retorno = texto(entrada.mensagens, "ferramenta");

      const conteudo =
        retorno === ""
          ? decidir(normalizarChave(estadoDoPrompt(sistema)), cliente, sistema)
          : aposFerramenta(retorno, cliente);

      return ok({ conteudo, versao: VERSAO, duracaoMs: 0 });
    },
  };
}
