// Exige PostgreSQL. Confere o que o teste em memória não consegue provar:
// transação da reserva, isolamento entre lojas e a chave única do idExterno.

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { repositoriosPrisma } from "../../lib/adaptadores/prisma.js";
import { reais } from "../../lib/dinheiro.js";
import type { Relogio } from "../../lib/portas.js";
import { gerarHashSenha } from "../../lib/sessao.js";

const db = new PrismaClient();
const relogio: Relogio = { agora: () => new Date("2026-08-03T14:00:00.000Z") };

let lojaA: string;
let lojaB: string;
let repos: ReturnType<typeof repositoriosPrisma>;
let reposOutraLoja: ReturnType<typeof repositoriosPrisma>;

async function limpar(): Promise<void> {
  await db.$transaction([
    db.registroAuditoria.deleteMany(),
    db.escalonamento.deleteMany(),
    db.proposta.deleteMany(),
    db.avaliacaoUsado.deleteMany(),
    db.reserva.deleteMany(),
    db.mensagem.deleteMany(),
    db.conversa.deleteMany(),
    db.contato.deleteMany(),
    db.produto.deleteMany(),
    db.tabelaTroca.deleteMany(),
    db.usuario.deleteMany(),
    db.tenant.deleteMany(),
  ]);
}

async function criarLoja(slug: string): Promise<string> {
  const tenant = await db.tenant.create({
    data: { slug, nomeExibicao: slug, configuracao: {} },
  });

  await db.produto.createMany({
    data: [
      {
        tenantId: tenant.id,
        sku: `${slug}-IPH14`,
        descricao: "iPhone 14 128 GB preto",
        categoria: "NOVO_LACRADO",
        memoriaGb: 128,
        cor: "preto",
        precoTabela: reais(3200),
        custo: reais(2700),
        quantidade: 2,
      },
      {
        tenantId: tenant.id,
        sku: `${slug}-ULTIMO`,
        descricao: "Galaxy S23 256 GB verde",
        categoria: "NOVO_LACRADO",
        memoriaGb: 256,
        precoTabela: reais(3600),
        custo: reais(3050),
        quantidade: 1,
      },
    ],
  });

  await db.tabelaTroca.create({
    data: { tenantId: tenant.id, modelo: "Galaxy S22", valorBase: reais(1200) },
  });

  await db.usuario.create({
    data: {
      tenantId: tenant.id,
      email: `dono@${slug}.com`,
      nome: "Dono",
      papel: "DONO",
      senhaHash: gerarHashSenha("senha-do-dono"),
    },
  });

  return tenant.id;
}

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await limpar();
  await db.$disconnect();
});

beforeEach(async () => {
  await limpar();
  lojaA = await criarLoja("loja-a");
  lojaB = await criarLoja("loja-b");
  repos = repositoriosPrisma({ db, tenantId: lojaA, relogio });
  reposOutraLoja = repositoriosPrisma({ db, tenantId: lojaB, relogio });
});

describe("estoque", () => {
  it("busca por termo, memória e preço", async () => {
    const porTermo = await repos.estoque.buscar({ termo: "iPhone 14" });
    expect(porTermo).toHaveLength(1);
    expect(porTermo[0]?.precoTabela).toBe(reais(3200));
    expect(porTermo[0]?.categoria).toBe("novo_lacrado");

    expect(await repos.estoque.buscar({ termo: "iPhone", memoriaGb: 512 })).toHaveLength(0);
    expect(await repos.estoque.buscar({ termo: "iPhone", precoMaximo: reais(1000) })).toHaveLength(0);
    expect(await repos.estoque.buscar({ termo: "iPhone", cor: "PRETO" })).toHaveLength(1);
  });

  it("não enxerga produto de outra loja", async () => {
    const daLojaA = await repos.estoque.buscar({ termo: "iPhone" });
    const idDaLojaA = daLojaA[0]!.id;

    expect(await reposOutraLoja.estoque.porId(idDaLojaA)).toBeNull();
  });

  it("reserva a última unidade uma vez só, com oito tentativas em paralelo", async () => {
    const produtos = await repos.estoque.buscar({ termo: "Galaxy S23" });
    const ultimo = produtos[0]!;
    const conversa = await repos.conversas.abrirOuRecuperar("5514900000001");
    const expira = new Date(relogio.agora().getTime() + 3_600_000);

    const tentativas = await Promise.all(
      Array.from({ length: 8 }, () => repos.estoque.reservar(ultimo.id, conversa.id, expira)),
    );

    expect(tentativas.filter((r) => r.ok)).toHaveLength(1);
    expect(await db.reserva.count({ where: { produtoId: ultimo.id } })).toBe(1);
  });

  it("com duas unidades, duas conversas conseguem e a terceira não", async () => {
    const produtos = await repos.estoque.buscar({ termo: "iPhone 14" });
    const produto = produtos[0]!;
    const conversa = await repos.conversas.abrirOuRecuperar("5514900000009");
    const expira = new Date(relogio.agora().getTime() + 3_600_000);

    const tentativas = await Promise.all(
      Array.from({ length: 6 }, () => repos.estoque.reservar(produto.id, conversa.id, expira)),
    );

    expect(tentativas.filter((r) => r.ok)).toHaveLength(2);
  });

  it("libera a unidade quando a reserva vence", async () => {
    const produtos = await repos.estoque.buscar({ termo: "Galaxy S23" });
    const ultimo = produtos[0]!;
    const conversa = await repos.conversas.abrirOuRecuperar("5514900000002");

    const vencida = new Date(relogio.agora().getTime() - 1000);
    await repos.estoque.reservar(ultimo.id, conversa.id, vencida);

    const nova = await repos.estoque.reservar(
      ultimo.id,
      conversa.id,
      new Date(relogio.agora().getTime() + 3_600_000),
    );
    expect(nova.ok).toBe(true);
  });

  it("recusa reservar produto que não existe", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514900000003");
    const r = await repos.estoque.reservar("nao-existe", conversa.id, new Date());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NAO_ENCONTRADO");
  });
});

describe("tabela de troca", () => {
  it("acha o modelo dentro da frase do cliente e devolve o nome da tabela", async () => {
    const achado = await repos.tabelaTroca.buscar("quero trocar meu galaxy s22 128");
    expect(achado).toEqual({ modelo: "Galaxy S22", valorBase: reais(1200) });
  });

  it("devolve null quando a loja não tem o modelo", async () => {
    expect(await repos.tabelaTroca.buscar("Xiaomi Poco X6")).toBeNull();
  });
});

describe("conversas", () => {
  it("recupera a conversa aberta em vez de criar outra", async () => {
    const primeira = await repos.conversas.abrirOuRecuperar("5514911112222", "Ana");
    const segunda = await repos.conversas.abrirOuRecuperar("5514911112222");

    expect(segunda.id).toBe(primeira.id);
    expect(segunda.nomeContato).toBe("Ana");
    expect(await db.contato.count({ where: { tenantId: lojaA } })).toBe(1);
  });

  it("abre conversa nova depois de a anterior encerrar", async () => {
    const primeira = await repos.conversas.abrirOuRecuperar("5514911113333");
    await repos.conversas.atualizar(primeira.id, { estado: "encerrada" });

    const segunda = await repos.conversas.abrirOuRecuperar("5514911113333");
    expect(segunda.id).not.toBe(primeira.id);
    expect(segunda.estado).toBe("recepcao");
  });

  it("guarda estado, anotações e contadores", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514911114444");
    const atualizada = await repos.conversas.atualizar(conversa.id, {
      estado: "negociacao",
      rodadasNegociacao: 2,
      falhasAuditor: 1,
      memoria: { produto_id: "p-1", preco_negociado: "307200" },
    });

    expect(atualizada.estado).toBe("negociacao");
    expect(atualizada.rodadasNegociacao).toBe(2);
    expect(atualizada.memoria.produto_id).toBe("p-1");

    const relida = await repos.conversas.porId(conversa.id);
    expect(relida?.memoria).toEqual({ produto_id: "p-1", preco_negociado: "307200" });
  });

  it("guarda o histórico em ordem de leitura", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514911115555");
    await repos.conversas.registrarMensagem(conversa.id, "entrada", "primeira");
    await repos.conversas.registrarMensagem(conversa.id, "saida", "segunda");
    await repos.conversas.registrarMensagem(conversa.id, "entrada", "terceira");

    const historico = await repos.conversas.historico(conversa.id, 10);
    expect(historico.map((m) => m.texto)).toEqual(["primeira", "segunda", "terceira"]);
    expect(historico[1]?.direcao).toBe("saida");
  });

  it("reconhece o reenvio do mesmo evento da Meta", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514911116666");
    expect(await repos.conversas.mensagemJaProcessada("wamid.abc")).toBe(false);

    await repos.conversas.registrarMensagem(conversa.id, "entrada", "oi", "wamid.abc");
    expect(await repos.conversas.mensagemJaProcessada("wamid.abc")).toBe(true);
  });

  it("aceita envio sem identificador externo", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514911117777");
    await repos.conversas.registrarMensagem(conversa.id, "saida", "sem id", "");
    await repos.conversas.registrarMensagem(conversa.id, "saida", "outro sem id", "");

    expect(await repos.conversas.historico(conversa.id, 10)).toHaveLength(2);
  });

  it("lista as ativas da loja e ignora as de outra", async () => {
    await repos.conversas.abrirOuRecuperar("5514911118888");
    await reposOutraLoja.conversas.abrirOuRecuperar("5514911119999");

    const ativas = await repos.conversas.listarAtivas(10);
    expect(ativas).toHaveLength(1);
    expect(ativas[0]?.telefone).toBe("5514911118888");
  });

  it("não devolve conversa de outra loja pelo id", async () => {
    const daOutra = await reposOutraLoja.conversas.abrirOuRecuperar("5514922220000");
    expect(await repos.conversas.porId(daOutra.id)).toBeNull();
  });
});

describe("avaliação de usado", () => {
  it("cria, acumula respostas e conclui", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514933330000");
    const avaliacao = await repos.avaliacoes.criar({
      conversaId: conversa.id,
      modeloDeclarado: "Galaxy S22",
      valorBase: reais(1200),
    });

    expect(avaliacao.valorApurado).toBeNull();
    expect(avaliacao.respostas).toEqual({});

    await repos.avaliacoes.concluir(avaliacao.id, { respostas: { tela: "sem_marca" } });
    const concluida = await repos.avaliacoes.concluir(avaliacao.id, {
      respostas: { tela: "sem_marca", bateria: "acima_85" },
      valorApurado: reais(1104),
      validadeAte: new Date("2026-08-05T14:00:00.000Z"),
      exigeAvaliacaoHumana: true,
      recusado: false,
    });

    expect(concluida.valorApurado).toBe(reais(1104));
    expect(concluida.exigeAvaliacaoHumana).toBe(true);
    expect(concluida.respostas).toEqual({ tela: "sem_marca", bateria: "acima_85" });

    const relida = await repos.avaliacoes.porId(avaliacao.id);
    expect(relida?.validadeAte?.toISOString()).toBe("2026-08-05T14:00:00.000Z");
  });

  it("não devolve avaliação de outra loja", async () => {
    const conversa = await reposOutraLoja.conversas.abrirOuRecuperar("5514933331111");
    const avaliacao = await reposOutraLoja.avaliacoes.criar({
      conversaId: conversa.id,
      modeloDeclarado: "Galaxy S22",
      valorBase: reais(1200),
    });

    expect(await repos.avaliacoes.porId(avaliacao.id)).toBeNull();
  });
});

describe("propostas", () => {
  it("grava com as versões usadas e aparece na fila de aprovação", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514944440000");
    const proposta = await repos.propostas.criar({
      conversaId: conversa.id,
      precoProduto: reais(3072),
      valorAparelhoUsado: reais(1104),
      diferencaAPagar: reais(1968),
      exigeAprovacaoHumana: true,
      situacao: "aguardando_aprovacao",
      validadeAte: new Date("2026-08-05T14:00:00.000Z"),
      versaoModelo: "qwen3:14b-q4",
      versaoPrompt: "p-abc123def456",
    });

    expect(proposta.situacao).toBe("aguardando_aprovacao");

    const pendentes = await repos.propostas.listarPendentes(10);
    expect(pendentes).toHaveLength(1);
    expect(pendentes[0]?.versaoModelo).toBe("qwen3:14b-q4");

    const aprovada = await repos.propostas.aprovar(proposta.id, "usuario-1");
    expect(aprovada.situacao).toBe("enviada");
    expect(await repos.propostas.listarPendentes(10)).toHaveLength(0);
  });

  it("não lista proposta pendente de outra loja", async () => {
    const conversa = await reposOutraLoja.conversas.abrirOuRecuperar("5514944441111");
    await reposOutraLoja.propostas.criar({
      conversaId: conversa.id,
      precoProduto: reais(1000),
      valorAparelhoUsado: 0,
      diferencaAPagar: reais(1000),
      exigeAprovacaoHumana: true,
      situacao: "aguardando_aprovacao",
      validadeAte: new Date(),
      versaoModelo: "x",
      versaoPrompt: "y",
    });

    expect(await repos.propostas.listarPendentes(10)).toHaveLength(0);
  });
});

describe("escalonamentos", () => {
  it("entra na fila e sai quando alguém assume", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514955550000");
    const usuario = await db.usuario.findFirstOrThrow({ where: { tenantId: lojaA } });

    const { id } = await repos.escalonamentos.criar(conversa.id, "pedido_do_cliente", "cliente pediu");
    const abertos = await repos.escalonamentos.listarAbertos(10);

    expect(abertos).toHaveLength(1);
    expect(abertos[0]?.motivo).toBe("pedido_do_cliente");

    await repos.escalonamentos.assumir(id, usuario.id);
    expect(await repos.escalonamentos.listarAbertos(10)).toHaveLength(0);
  });
});

describe("lead e consentimento", () => {
  it("grava o consentimento no contato", async () => {
    const conversa = await repos.conversas.abrirOuRecuperar("5514966660000");
    await repos.leads.registrar({
      conversaId: conversa.id,
      interesse: "iPhone 14",
      nome: "Ana",
      aceitaContato: true,
    });

    const contato = await db.contato.findFirstOrThrow({ where: { tenantId: lojaA } });
    expect(contato.nome).toBe("Ana");
    expect(contato.aceitaContato).toBe(true);
    expect(contato.consentimentoEm).not.toBeNull();
  });

  it("ignora conversa de outra loja", async () => {
    const daOutra = await reposOutraLoja.conversas.abrirOuRecuperar("5514966661111");
    const r = await repos.leads.registrar({
      conversaId: daOutra.id,
      interesse: "x",
      aceitaContato: true,
    });
    expect(r.id).toBe("");
  });
});

describe("auditoria e usuários", () => {
  it("registra e lista do mais recente para o mais antigo", async () => {
    await repos.auditoria.registrar("ferramenta", { nome: "consultar_estoque" });
    await repos.auditoria.registrar("kill_switch", { ativo: false });

    const registros = await repos.auditoria.listar(10);
    expect(registros[0]?.tipo).toBe("kill_switch");
    expect(registros).toHaveLength(2);
    expect(await reposOutraLoja.auditoria.listar(10)).toHaveLength(0);
  });

  it("acha o usuário do painel pelo e-mail e só o da própria loja", async () => {
    const usuario = await repos.usuarios.porEmail("dono@loja-a.com");
    expect(usuario?.papel).toBe("dono");
    expect(await repos.usuarios.porEmail("dono@loja-b.com")).toBeNull();
    expect(await repos.usuarios.porEmail("ninguem@loja-a.com")).toBeNull();
  });
});
