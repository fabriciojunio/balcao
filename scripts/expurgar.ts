// Expurgo de retenção (LGPD). Roda por agendamento, uma vez ao dia.
// Uso: TENANT_ATIVO=loja npm run expurgar [--simular]
//
// A proposta não é apagada: ela é o registro do que a loja ofereceu. O que sai
// é o que identifica a pessoa.

import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { carregarConfigDeArquivo } from "../lib/tenant/carregar.js";

const slug = process.env.TENANT_ATIVO ?? "loja-exemplo";
const simular = process.argv.includes("--simular");

const caminho = fileURLToPath(new URL(`../config/tenants/${slug}.yml`, import.meta.url));
const config = carregarConfigDeArquivo(caminho);
if (!config.ok) {
  console.error(`Configuração inválida: ${config.error.message}`);
  process.exit(1);
}

const db = new PrismaClient();
const tenant = await db.tenant.findUnique({ where: { slug } });
if (tenant === null) {
  console.error(`Loja ${slug} não está cadastrada.`);
  process.exit(1);
}

const dias = config.value.conformidade.retencao_conversas_dias;
const corte = new Date(Date.now() - dias * 86_400_000);

const conversas = await db.conversa.findMany({
  where: { tenantId: tenant.id, ultimaMensagemEm: { lt: corte } },
  select: { id: true, contatoId: true },
});

const mensagens = await db.mensagem.count({ where: { conversaId: { in: conversas.map((c) => c.id) } } });

console.log(`Loja ${slug}: retenção de ${dias} dias, corte em ${corte.toISOString().slice(0, 10)}.`);
console.log(`${conversas.length} conversas e ${mensagens} mensagens fora do prazo.`);

if (simular) {
  console.log("Modo simulação: nada foi alterado.");
  await db.$disconnect();
  process.exit(0);
}

const contatos = [...new Set(conversas.map((c) => c.contatoId))];

await db.$transaction([
  db.mensagem.deleteMany({ where: { conversaId: { in: conversas.map((c) => c.id) } } }),
  // O contato é anonimizado, não apagado: a proposta continua explicável sem
  // identificar ninguém.
  db.contato.updateMany({
    where: { id: { in: contatos }, anonimizadoEm: null },
    data: { nome: null, telefone: `anonimizado-${Date.now()}`, aceitaContato: false, anonimizadoEm: new Date() },
  }),
  db.registroAuditoria.create({
    data: {
      tenantId: tenant.id,
      tipo: "expurgo_retencao",
      detalhe: { conversas: conversas.length, mensagens, contatos: contatos.length, corte: corte.toISOString() },
    },
  }),
]);

console.log(`Expurgo concluído: ${mensagens} mensagens removidas, ${contatos.length} contatos anonimizados.`);
await db.$disconnect();
