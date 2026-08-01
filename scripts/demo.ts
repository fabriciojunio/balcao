// Roda uma conversa completa em memória e imprime a transcrição.
// Uso: npm run demo
// Serve para mostrar o atendimento funcionando sem banco, sem GPU e sem Meta.

import { fileURLToPath } from "node:url";
import { criarAdaptadoresMemoria } from "../lib/adaptadores/memoria.js";
import { reais } from "../lib/dinheiro.js";
import { loggerSilencioso } from "../lib/log.js";
import { clienteSimulador } from "../lib/modelo/simulador.js";
import { montarOrquestrador } from "../lib/montagem.js";
import { atender } from "../lib/orquestrador.js";
import { relogioDoSistema, type ProdutoEmEstoque } from "../lib/portas.js";
import { carregarConfigDeArquivo } from "../lib/tenant/carregar.js";

const slug = process.env.TENANT_ATIVO ?? "loja-exemplo";
const caminho = fileURLToPath(new URL(`../config/tenants/${slug}.yml`, import.meta.url));
const config = carregarConfigDeArquivo(caminho);
if (!config.ok) {
  console.error(config.error.message);
  process.exit(1);
}

const agora = new Date();
const produtos: ProdutoEmEstoque[] = [
  {
    id: "p-001",
    descricao: "iPhone 14 128 GB preto",
    categoria: "novo_lacrado",
    precoTabela: reais(3200),
    custo: reais(2700),
    quantidade: 3,
    memoriaGb: 128,
    cor: "preto",
    garantiaMeses: 12,
    sincronizadoEm: agora,
  },
  {
    id: "p-002",
    descricao: "Galaxy S23 256 GB verde",
    categoria: "novo_lacrado",
    precoTabela: reais(3600),
    custo: reais(3050),
    quantidade: 1,
    memoriaGb: 256,
    cor: "verde",
    sincronizadoEm: agora,
  },
];

const adaptadores = criarAdaptadoresMemoria({
  relogio: relogioDoSistema,
  produtos,
  tabelaTroca: { "galaxy s22": reais(1200), "iphone 12": reais(1500) },
});

const deps = montarOrquestrador({
  config: config.value,
  repositorios: {
    estoque: adaptadores.estoque,
    tabelaTroca: adaptadores.tabelaTroca,
    conversas: adaptadores.conversas,
    avaliacoes: adaptadores.avaliacoes,
    propostas: adaptadores.propostas,
    leads: adaptadores.leads,
    escalonamentos: adaptadores.escalonamentos,
    auditoria: adaptadores.auditoria,
  },
  modelo: clienteSimulador(),
  canal: adaptadores.canal,
  relogio: relogioDoSistema,
  log: loggerSilencioso,
  agenteAtivo: () => true,
});

const roteiro = [
  "oi, vocês tem iPhone 14?",
  "quanto fica em 12x?",
  "faz por 2500 à vista?",
  "e agora, consegue melhorar?",
  "tenho um Galaxy S22 pra dar na troca",
  "não, sem bloqueio nenhum",
  "sim, liga normal",
  "a tela tem um risco leve",
  "a bateria está acima de 85",
  "a carcaça está inteira",
  "tenho a caixa e a nota",
  "fechado, pode separar",
];

const TELEFONE = "5514999990000";
let enviadosLidos = 0;

for (const fala of roteiro) {
  console.log(`\x1b[36mcliente >\x1b[0m ${fala}`);
  const r = await atender({ telefone: TELEFONE, texto: fala }, deps);
  if (!r.ok) {
    console.error(`  erro: ${r.error.message}`);
    continue;
  }
  for (const enviado of adaptadores.estado.enviados.slice(enviadosLidos)) {
    console.log(`\x1b[32mbalcão  >\x1b[0m ${enviado.texto}`);
  }
  enviadosLidos = adaptadores.estado.enviados.length;
  if (r.value.escalou) {
    console.log(`\x1b[33m  [conversa passada para um vendedor: ${r.value.motivoEscalonamento}]\x1b[0m`);
  }
}

const conversas = await adaptadores.conversas.listarAtivas(1);
const chamadas = adaptadores.estado.auditoria.filter((a) => a.tipo === "ferramenta").length;

console.log("\n--- resumo ---");
console.log(`estado final: ${conversas[0]?.estado ?? "-"}`);
console.log(`ferramentas chamadas: ${chamadas}`);
console.log(`bloqueios do auditor: ${adaptadores.estado.auditoria.filter((a) => a.tipo === "bloqueio_auditor").length}`);
console.log(`propostas geradas: ${adaptadores.estado.propostas.size}`);
console.log(`reservas: ${adaptadores.estado.reservas.length}`);
