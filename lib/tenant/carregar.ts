// Carregamento e adaptação da configuração de uma loja.
// O arquivo é escrito em português, com valores em reais, porque quem edita é
// o operador. Da fronteira para dentro tudo vira centavos e objeto de domínio.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { reais, type Centavos } from "../dinheiro.js";
import { erro, ok, type Result } from "../result.js";
import type { ContextoAuditoria } from "../auditor/index.js";
import type { PoliticaPreco, TabelaParcelamento } from "../dominio/preco.js";
import { validarPolitica } from "../dominio/preco.js";
import type { RegraTroca } from "../dominio/troca.js";
import { configTenantSchema, type ConfigTenant } from "./schema.js";

/** Valida um objeto já desserializado contra o contrato. */
export function validarConfig(bruto: unknown): Result<ConfigTenant> {
  const parsed = configTenantSchema.safeParse(bruto);
  if (!parsed.success) {
    return erro("CONFIG_INVALIDA", "Configuração da loja inválida.", {
      problemas: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }

  const politica = validarPolitica(paraPoliticaPreco(parsed.data));
  if (!politica.ok) return politica;

  return ok(parsed.data);
}

/** Lê e valida um arquivo YAML de configuração. */
export function carregarConfigDeArquivo(caminho: string): Result<ConfigTenant> {
  let conteudo: string;
  try {
    conteudo = readFileSync(caminho, "utf8");
  } catch {
    return erro("NAO_ENCONTRADO", `Arquivo de configuração não encontrado: ${caminho}`);
  }

  let bruto: unknown;
  try {
    bruto = parseYaml(conteudo);
  } catch (e) {
    return erro("CONFIG_INVALIDA", `YAML inválido em ${caminho}: ${(e as Error).message}`);
  }

  return validarConfig(bruto);
}

// ---------------------------------------------------------------------------
// Adaptação para os objetos de domínio
// ---------------------------------------------------------------------------

export function paraPoliticaPreco(config: ConfigTenant): PoliticaPreco {
  const p = config.politica_preco;
  return {
    margemMinimaPercentual: p.margem_minima_percentual,
    tetoDescontoPercentual: {
      novo_lacrado: p.teto_desconto_percentual.novo_lacrado,
      seminovo: p.teto_desconto_percentual.seminovo,
      acessorio: p.teto_desconto_percentual.acessorio,
    },
    concessaoPorRodada: p.concessao_por_rodada,
    etiquetasSemDesconto: p.etiquetas_sem_desconto,
    alcadaAprovacaoHumana: reais(p.alcada_aprovacao_humana_reais),
    arredondamentoCentavos: reais(p.arredondamento_reais),
  };
}

export function paraTabelaParcelamento(config: ConfigTenant): TabelaParcelamento {
  const tabela: Record<number, number> = {};
  for (const [parcelas, taxa] of Object.entries(config.politica_preco.taxas_parcelamento)) {
    tabela[Number(parcelas)] = taxa;
  }
  return tabela;
}

export function paraRegraTroca(config: ConfigTenant): RegraTroca {
  const t = config.troca;
  return {
    estados: t.estados,
    redutores: t.redutores,
    recusaAutomatica: t.recusa_automatica,
    validadeHoras: t.validade_horas,
    faixaPercentual: t.faixa_percentual,
    ajusteMinimo: t.ajuste_minimo,
    exigeConferenciaFisica: t.exige_conferencia_fisica,
    valorMinimoAceito: reais(t.valor_minimo_aceito_reais),
  };
}

/**
 * Base do contexto do auditor: o que a loja pode citar independente da
 * conversa. Os valores de cada rodada são somados a isto pelo orquestrador.
 */
export function paraContextoAuditoriaBase(config: ConfigTenant): ContextoAuditoria {
  const numeros = [...config.tenant.numeros_publicos];
  const telefone = config.tenant.telefone_publico;
  if (telefone !== undefined) {
    const somenteDigitos = Number(telefone.replace(/\D/g, ""));
    if (Number.isFinite(somenteDigitos)) numeros.push(somenteDigitos);
  }

  return {
    monetariosPermitidos: [],
    percentuaisPermitidos: [],
    parcelasPermitidas: [],
    numerosPermitidos: numeros,
    limiarNumeroSolto: 100,
    toleranciaCentavos: 0,
    frasesProibidas: config.conformidade.frases_proibidas,
  };
}

/** Valor mínimo que a loja compra, em centavos. */
export function valorMinimoTroca(config: ConfigTenant): Centavos {
  return reais(config.troca.valor_minimo_aceito_reais);
}
