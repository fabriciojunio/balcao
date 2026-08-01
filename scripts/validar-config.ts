// Valida os arquivos de configuração das lojas.
// Uso: npm run config:validar [caminho...]
// Sem argumento, valida tudo que estiver em config/tenants.

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { carregarConfigDeArquivo } from "../lib/tenant/carregar.js";

const PASTA_PADRAO = fileURLToPath(new URL("../config/tenants", import.meta.url));

function arquivosAlvo(): string[] {
  const args = process.argv.slice(2);
  if (args.length > 0) return args.map((a) => resolve(a));
  return readdirSync(PASTA_PADRAO)
    .filter((nome) => nome.endsWith(".yml") || nome.endsWith(".yaml"))
    .map((nome) => join(PASTA_PADRAO, nome));
}

const alvos = arquivosAlvo();
if (alvos.length === 0) {
  console.error("Nenhum arquivo de configuração encontrado.");
  process.exit(1);
}

let houveErro = false;

for (const caminho of alvos) {
  const resultado = carregarConfigDeArquivo(caminho);
  if (resultado.ok) {
    console.log(`ok    ${resultado.value.tenant.slug.padEnd(20)} ${caminho}`);
    continue;
  }

  houveErro = true;
  console.error(`falha ${caminho}`);
  console.error(`      ${resultado.error.message}`);
  const problemas = resultado.error.detalhes?.problemas;
  if (Array.isArray(problemas)) {
    for (const p of problemas) console.error(`      - ${String(p)}`);
  }
}

process.exit(houveErro ? 1 : 0);
