// Páginas do painel. HTML gerado no servidor, sem build e sem JavaScript de
// cliente.

import { formatarBRL } from "../lib/dinheiro.js";
import type { ConversaRegistro, MensagemRegistro, PropostaRegistro } from "../lib/portas.js";

const ESTILO = `
:root{color-scheme:light dark;--linha:#c9d4d2;--fundo:#f1f4f3;--cartao:#fff;--tinta:#17262a;--acento:#0b6e63;--alerta:#a75b12}
@media(prefers-color-scheme:dark){:root{--linha:#274043;--fundo:#0b1416;--cartao:#121f22;--tinta:#dce7e5;--acento:#4fc4b2;--alerta:#e0a163}}
*{box-sizing:border-box}
body{margin:0;background:var(--fundo);color:var(--tinta);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
header{border-bottom:2px solid var(--tinta);padding:16px 24px;display:flex;gap:24px;align-items:center;flex-wrap:wrap}
header b{font-size:18px}
nav a{color:var(--acento);text-decoration:none;margin-right:16px}
main{max-width:1000px;margin:0 auto;padding:24px}
h1{font-size:22px;margin:0 0 16px}
h2{font-size:16px;margin:28px 0 12px}
table{width:100%;border-collapse:collapse;background:var(--cartao);border:1px solid var(--linha);font-size:14px}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--linha);vertical-align:top}
th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.7}
tr:last-child td{border-bottom:none}
form{display:inline}
button{font:inherit;padding:6px 12px;border:1px solid var(--acento);background:transparent;color:var(--acento);cursor:pointer}
button.perigo{border-color:var(--alerta);color:var(--alerta)}
input{font:inherit;padding:8px;border:1px solid var(--linha);background:var(--cartao);color:var(--tinta);width:100%;max-width:320px}
.campo{margin-bottom:12px}
.chip{display:inline-block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border:1px solid var(--linha)}
.msg{margin:0 0 8px;padding:8px 12px;border-left:3px solid var(--linha);background:var(--cartao)}
.msg.saida{border-left-color:var(--acento)}
.vazio{opacity:.6;padding:16px 0}
`;

function pagina(titulo: string, corpo: string, navegacao = true): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapar(titulo)} - Balcão</title><style>${ESTILO}</style></head><body>
${navegacao ? `<header><b>Balcão</b><nav><a href="/painel">Conversas</a><a href="/painel/propostas">Propostas</a><a href="/painel/auditoria">Auditoria</a></nav></header>` : ""}
<main>${corpo}</main></body></html>`;
}

export function escapar(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function paginaLogin(erro?: string): string {
  return pagina(
    "Entrar",
    `<h1>Painel da loja</h1>
${erro === undefined ? "" : `<p class="chip">${escapar(erro)}</p>`}
<form method="post" action="/painel/entrar">
  <div class="campo"><label>E-mail<br><input name="email" type="email" required autofocus></label></div>
  <div class="campo"><label>Senha<br><input name="senha" type="password" required></label></div>
  <button type="submit">Entrar</button>
</form>`,
    false,
  );
}

export interface DadosFila {
  readonly conversas: readonly ConversaRegistro[];
  readonly escalonamentos: ReadonlyArray<{ id: string; conversaId: string; motivo: string; resumo: string }>;
  readonly agenteAtivo: boolean;
}

export function paginaFila(dados: DadosFila): string {
  const interruptor = `
<h2>Agente</h2>
<p>Situação: <span class="chip">${dados.agenteAtivo ? "ligado" : "desligado"}</span></p>
<form method="post" action="/painel/agente">
  <input type="hidden" name="ativo" value="${dados.agenteAtivo ? "false" : "true"}">
  <button type="submit" class="${dados.agenteAtivo ? "perigo" : ""}">
    ${dados.agenteAtivo ? "Desligar agente e passar tudo para humano" : "Ligar agente"}
  </button>
</form>`;

  const pendentes =
    dados.escalonamentos.length === 0
      ? '<p class="vazio">Nenhuma conversa esperando atendimento.</p>'
      : `<table><thead><tr><th>Motivo</th><th>Resumo</th><th></th></tr></thead><tbody>${dados.escalonamentos
          .map(
            (e) => `<tr><td><span class="chip">${escapar(e.motivo)}</span></td><td>${escapar(e.resumo)}</td>
<td><form method="post" action="/painel/assumir"><input type="hidden" name="id" value="${escapar(e.id)}">
<input type="hidden" name="conversaId" value="${escapar(e.conversaId)}">
<button type="submit">Assumir</button></form>
<a href="/painel/conversa/${escapar(e.conversaId)}">abrir</a></td></tr>`,
          )
          .join("")}</tbody></table>`;

  const ativas =
    dados.conversas.length === 0
      ? '<p class="vazio">Nenhuma conversa ainda.</p>'
      : `<table><thead><tr><th>Telefone</th><th>Estado</th><th>Rodadas</th><th>Última mensagem</th><th></th></tr></thead><tbody>${dados.conversas
          .map(
            (c) => `<tr><td>${escapar(c.telefone)}</td><td><span class="chip">${escapar(c.estado)}</span></td>
<td>${c.rodadasNegociacao}</td><td>${c.ultimaMensagemEm.toLocaleString("pt-BR")}</td>
<td><a href="/painel/conversa/${escapar(c.id)}">abrir</a></td></tr>`,
          )
          .join("")}</tbody></table>`;

  return pagina("Conversas", `<h1>Conversas</h1>${interruptor}<h2>Esperando um vendedor</h2>${pendentes}<h2>Todas</h2>${ativas}`);
}

export function paginaConversa(conversa: ConversaRegistro, mensagens: readonly MensagemRegistro[]): string {
  const corpo = mensagens
    .map(
      (m) =>
        `<p class="msg ${m.direcao === "saida" ? "saida" : ""}"><small>${m.criadoEm.toLocaleString("pt-BR")}</small><br>${escapar(m.texto)}</p>`,
    )
    .join("");

  const anotacoes = Object.entries(conversa.memoria)
    .map(([k, v]) => `<tr><td>${escapar(k)}</td><td>${escapar(v)}</td></tr>`)
    .join("");

  return pagina(
    `Conversa ${conversa.telefone}`,
    `<h1>${escapar(conversa.telefone)}</h1>
<p><span class="chip">${escapar(conversa.estado)}</span> rodadas: ${conversa.rodadasNegociacao} · bloqueios do auditor: ${conversa.falhasAuditor}</p>
<form method="post" action="/painel/devolver"><input type="hidden" name="conversaId" value="${escapar(conversa.id)}">
<button type="submit">Devolver ao agente</button></form>
<h2>Mensagens</h2>${corpo || '<p class="vazio">Sem mensagens.</p>'}
<h2>Anotações</h2>${anotacoes === "" ? '<p class="vazio">Nenhuma.</p>' : `<table>${anotacoes}</table>`}`,
  );
}

export function paginaPropostas(propostas: readonly PropostaRegistro[]): string {
  const corpo =
    propostas.length === 0
      ? '<p class="vazio">Nenhuma proposta esperando aprovação.</p>'
      : `<table><thead><tr><th>Produto</th><th>Usado</th><th>Diferença</th><th>Validade</th><th></th></tr></thead><tbody>${propostas
          .map(
            (p) => `<tr><td>${formatarBRL(p.precoProduto)}</td><td>${formatarBRL(p.valorAparelhoUsado)}</td>
<td>${formatarBRL(p.diferencaAPagar)}</td><td>${p.validadeAte.toLocaleString("pt-BR")}</td>
<td><form method="post" action="/painel/aprovar"><input type="hidden" name="id" value="${escapar(p.id)}">
<button type="submit">Aprovar</button></form></td></tr>`,
          )
          .join("")}</tbody></table>`;

  return pagina("Propostas", `<h1>Propostas aguardando aprovação</h1>${corpo}`);
}

export function paginaAuditoria(
  registros: ReadonlyArray<{ tipo: string; detalhe: Record<string, unknown>; criadoEm: Date }>,
): string {
  const corpo =
    registros.length === 0
      ? '<p class="vazio">Nada registrado ainda.</p>'
      : `<table><thead><tr><th>Quando</th><th>Tipo</th><th>Detalhe</th></tr></thead><tbody>${registros
          .map(
            (r) =>
              `<tr><td>${r.criadoEm.toLocaleString("pt-BR")}</td><td><span class="chip">${escapar(r.tipo)}</span></td>
<td><code>${escapar(JSON.stringify(r.detalhe))}</code></td></tr>`,
          )
          .join("")}</tbody></table>`;

  return pagina("Auditoria", `<h1>Trilha de auditoria</h1>${corpo}`);
}

export function paginaSimulador(historico: readonly MensagemRegistro[]): string {
  const corpo = historico
    .map(
      (m) =>
        `<p class="msg ${m.direcao === "saida" ? "saida" : ""}">${escapar(m.texto)}</p>`,
    )
    .join("");

  return pagina(
    "Simulador",
    `<h1>Simulador de conversa</h1>
<p>Escreva como se fosse o cliente no WhatsApp. Serve para demonstrar o atendimento sem depender da Meta.</p>
<form method="post" action="/simulador">
  <div class="campo"><input name="texto" placeholder="oi, tem iPhone 14?" autofocus required></div>
  <button type="submit">Enviar</button>
</form>
<h2>Conversa</h2>${corpo || '<p class="vazio">Sem mensagens ainda.</p>'}`,
  );
}
