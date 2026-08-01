// Carga inicial: cria a loja a partir do arquivo de configuração, um usuário
// para o painel e um estoque de demonstração.
// Uso: TENANT_ATIVO=loja-exemplo npm run db:seed

import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { reais } from "../lib/dinheiro.js";
import { gerarHashSenha } from "../lib/sessao.js";
import { carregarConfigDeArquivo } from "../lib/tenant/carregar.js";

const slug = process.env.TENANT_ATIVO ?? "loja-exemplo";
const email = process.env.SEED_EMAIL ?? "dono@lojaexemplo.com.br";
const senha = process.env.SEED_SENHA ?? "trocar-esta-senha";

const db = new PrismaClient();

const caminho = fileURLToPath(new URL(`../config/tenants/${slug}.yml`, import.meta.url));
const config = carregarConfigDeArquivo(caminho);
if (!config.ok) {
  console.error(`Configuração inválida em ${caminho}: ${config.error.message}`);
  process.exit(1);
}

const tenant = await db.tenant.upsert({
  where: { slug },
  create: {
    slug,
    nomeExibicao: config.value.tenant.nome_exibicao,
    configuracao: config.value as object,
  },
  update: { nomeExibicao: config.value.tenant.nome_exibicao, configuracao: config.value as object },
});

await db.usuario.upsert({
  where: { tenantId_email: { tenantId: tenant.id, email } },
  create: {
    tenantId: tenant.id,
    email,
    nome: "Dono da loja",
    papel: "DONO",
    senhaHash: gerarHashSenha(senha),
  },
  update: {},
});

const produtos = [
  {
    sku: "IPH14-128-PRETO",
    descricao: "iPhone 14 128 GB preto",
    categoria: "NOVO_LACRADO" as const,
    memoriaGb: 128,
    cor: "preto",
    precoTabela: reais(3200),
    custo: reais(2700),
    quantidade: 3,
  },
  {
    sku: "IPH13-128-AZUL",
    descricao: "iPhone 13 128 GB azul seminovo",
    categoria: "SEMINOVO" as const,
    memoriaGb: 128,
    cor: "azul",
    precoTabela: reais(2400),
    custo: reais(1950),
    quantidade: 2,
  },
  {
    sku: "S23-256-VERDE",
    descricao: "Galaxy S23 256 GB verde",
    categoria: "NOVO_LACRADO" as const,
    memoriaGb: 256,
    cor: "verde",
    precoTabela: reais(3600),
    custo: reais(3050),
    quantidade: 1,
  },
  {
    sku: "MOTO-G84-128",
    descricao: "Moto G84 128 GB grafite",
    categoria: "NOVO_LACRADO" as const,
    memoriaGb: 128,
    cor: "grafite",
    precoTabela: reais(1500),
    custo: reais(1250),
    quantidade: 4,
  },
  {
    sku: "CAPA-SILICONE",
    descricao: "Capa de silicone",
    categoria: "ACESSORIO" as const,
    precoTabela: reais(80),
    custo: reais(30),
    quantidade: 20,
  },
];

for (const produto of produtos) {
  await db.produto.upsert({
    where: { tenantId_sku: { tenantId: tenant.id, sku: produto.sku } },
    create: { tenantId: tenant.id, ...produto },
    update: { ...produto, sincronizadoEm: new Date() },
  });
}

const tabelaTroca = [
  { modelo: "iPhone 11", valorBase: reais(1100) },
  { modelo: "iPhone 12", valorBase: reais(1500) },
  { modelo: "iPhone 13", valorBase: reais(2000) },
  { modelo: "Galaxy S21", valorBase: reais(900) },
  { modelo: "Galaxy S22", valorBase: reais(1200) },
  { modelo: "Moto G73", valorBase: reais(500) },
];

for (const linha of tabelaTroca) {
  await db.tabelaTroca.upsert({
    where: { tenantId_modelo: { tenantId: tenant.id, modelo: linha.modelo } },
    create: { tenantId: tenant.id, ...linha },
    update: { valorBase: linha.valorBase, ativo: true },
  });
}

console.log(`Loja "${slug}" pronta.`);
console.log(`Painel: ${email} / ${senha}`);
console.log(`${produtos.length} produtos e ${tabelaTroca.length} modelos na tabela de troca.`);

await db.$disconnect();
