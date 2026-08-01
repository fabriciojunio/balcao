// Dados compartilhados pelos testes. A configuração vem do arquivo de exemplo
// de verdade: se alguém quebrar o YAML de referência, a suíte inteira acusa.

import { fileURLToPath } from "node:url";
import { reais } from "../lib/dinheiro.js";
import { desempacotar } from "../lib/result.js";
import {
  carregarConfigDeArquivo,
  paraContextoAuditoriaBase,
  paraPoliticaPreco,
  paraRegraTroca,
  paraTabelaParcelamento,
} from "../lib/tenant/carregar.js";
import type { Produto } from "../lib/dominio/preco.js";

export const CAMINHO_CONFIG_EXEMPLO = fileURLToPath(
  new URL("../config/tenants/loja-exemplo.yml", import.meta.url),
);

export const config = desempacotar(carregarConfigDeArquivo(CAMINHO_CONFIG_EXEMPLO));
export const politica = paraPoliticaPreco(config);
export const tabelaParcelamento = paraTabelaParcelamento(config);
export const regraTroca = paraRegraTroca(config);
export const contextoBase = paraContextoAuditoriaBase(config);

/** Aparelho novo com margem folgada: dá para negociar. */
export const iphoneNovo: Produto = {
  id: "p-001",
  descricao: "iPhone 14 128 GB preto",
  categoria: "novo_lacrado",
  precoTabela: reais(3200),
  custo: reais(2700),
};

/** Seminovo com margem apertada: o piso vem da margem, não do teto. */
export const seminovoApertado: Produto = {
  id: "p-002",
  descricao: "Galaxy S22 128 GB",
  categoria: "seminovo",
  precoTabela: reais(1800),
  custo: reais(1700),
};

/** Lançamento etiquetado: não desconta em nenhuma hipótese. */
export const lancamento: Produto = {
  id: "p-003",
  descricao: "iPhone 16 256 GB",
  categoria: "novo_lacrado",
  precoTabela: reais(6500),
  custo: reais(5600),
  etiquetas: ["lancamento_30_dias"],
};

export const acessorio: Produto = {
  id: "p-004",
  descricao: "Capa de silicone",
  categoria: "acessorio",
  precoTabela: reais(80),
  custo: reais(30),
};

export const AGORA = new Date("2026-08-01T12:00:00.000Z");
