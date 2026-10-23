// Implementação das portas sobre o PostgreSQL. Toda consulta carrega o
// tenantId: o isolamento entre lojas fica aqui.

import { PrismaClient, type Prisma } from "@prisma/client";
import type { EstadoConversa, MotivoEscalonamento } from "../dominio/conversa.js";
import type { CategoriaProduto } from "../dominio/preco.js";
import type {
  AvaliacaoRegistro,
  ConversaRegistro,
  DirecaoMensagem,
  MensagemRegistro,
  ProdutoEmEstoque,
  PropostaRegistro,
  Relogio,
  RepositorioAuditoria,
  RepositorioAvaliacoes,
  RepositorioConversas,
  RepositorioEscalonamentos,
  RepositorioEstoque,
  RepositorioLeads,
  RepositorioPropostas,
  RepositorioTabelaTroca,
  RepositorioMetricas,
  RepositorioUsuarios,
  Reserva,
} from "../portas.js";
import { erro, ok, type Result } from "../result.js";
import { normalizarChave } from "../texto.js";
import { calcularMetricas } from "../dominio/metricas.js";
import { modeloCombina } from "../dominio/troca.js";

export type Banco = PrismaClient;

let unico: PrismaClient | undefined;

export function bancoCompartilhado(): PrismaClient {
  unico ??= new PrismaClient();
  return unico;
}

const ESTADO_PARA_BANCO: Record<EstadoConversa, string> = {
  recepcao: "RECEPCAO",
  descoberta: "DESCOBERTA",
  apresentacao: "APRESENTACAO",
  avaliacao_usado: "AVALIACAO_USADO",
  negociacao: "NEGOCIACAO",
  fechamento: "FECHAMENTO",
  atendimento_humano: "ATENDIMENTO_HUMANO",
  retomada: "RETOMADA",
  encerrada: "ENCERRADA",
};

const CATEGORIA_PARA_BANCO: Record<CategoriaProduto, string> = {
  novo_lacrado: "NOVO_LACRADO",
  seminovo: "SEMINOVO",
  acessorio: "ACESSORIO",
};

const paraDominio = <T extends string>(valor: string): T => valor.toLowerCase() as T;

function objeto(valor: Prisma.JsonValue | null): Record<string, string> {
  return valor === null || typeof valor !== "object" || Array.isArray(valor)
    ? {}
    : (valor as Record<string, string>);
}

interface LinhaProduto {
  id: string;
  descricao: string;
  categoria: string;
  precoTabela: number;
  custo: number;
  quantidade: number;
  memoriaGb: number | null;
  cor: string | null;
  etiquetas: string[];
  sincronizadoEm: Date;
}

function produtoDeLinha(linha: LinhaProduto): ProdutoEmEstoque {
  return {
    id: linha.id,
    descricao: linha.descricao,
    categoria: paraDominio<CategoriaProduto>(linha.categoria),
    precoTabela: linha.precoTabela,
    custo: linha.custo,
    quantidade: linha.quantidade,
    etiquetas: linha.etiquetas,
    sincronizadoEm: linha.sincronizadoEm,
    ...(linha.memoriaGb === null ? {} : { memoriaGb: linha.memoriaGb }),
    ...(linha.cor === null ? {} : { cor: linha.cor }),
  };
}

interface LinhaConversa {
  id: string;
  contatoId: string;
  estado: string;
  rodadasNegociacao: number;
  falhasAuditor: number;
  responsavelId: string | null;
  ultimaMensagemEm: Date;
  memoria: Prisma.JsonValue;
  contato: { telefone: string; nome: string | null };
}

function conversaDeLinha(linha: LinhaConversa): ConversaRegistro {
  return {
    id: linha.id,
    contatoId: linha.contatoId,
    telefone: linha.contato.telefone,
    estado: paraDominio<EstadoConversa>(linha.estado),
    rodadasNegociacao: linha.rodadasNegociacao,
    falhasAuditor: linha.falhasAuditor,
    responsavelId: linha.responsavelId,
    ultimaMensagemEm: linha.ultimaMensagemEm,
    memoria: objeto(linha.memoria),
    ...(linha.contato.nome === null ? {} : { nomeContato: linha.contato.nome }),
  };
}

export interface OpcoesPrisma {
  readonly db: Banco;
  readonly tenantId: string;
  readonly relogio: Relogio;
}

export function repositorioEstoque(opcoes: OpcoesPrisma): RepositorioEstoque {
  const { db, tenantId } = opcoes;

  return {
    async buscar(filtro) {
      const palavras = normalizarChave(filtro.termo)
        .split("_")
        .filter((p) => p.length >= 3);

      const linhas = await db.produto.findMany({
        where: {
          tenantId,
          ativo: true,
          quantidade: { gt: 0 },
          ...(palavras.length === 0 ? {} : { OR: palavras.map((p) => ({ descricao: { contains: p, mode: "insensitive" as const } })) }),
          ...(filtro.memoriaGb === undefined ? {} : { memoriaGb: filtro.memoriaGb }),
          ...(filtro.cor === undefined ? {} : { cor: { equals: filtro.cor, mode: "insensitive" as const } }),
          ...(filtro.precoMaximo === undefined ? {} : { precoTabela: { lte: filtro.precoMaximo } }),
        },
        orderBy: { precoTabela: "asc" },
        take: 10,
      });

      return linhas.map(produtoDeLinha);
    },

    async porId(produtoId) {
      const linha = await db.produto.findFirst({ where: { id: produtoId, tenantId } });
      return linha === null ? null : produtoDeLinha(linha);
    },

    async reservar(produtoId, conversaId, expiraEm): Promise<Result<Reserva>> {
      try {
        const reserva = await db.$transaction(async (tx) => {
          // Trava a linha do produto antes de contar. Sem isso, duas conversas
          // simultâneas contam zero reserva ao mesmo tempo e ambas levam a
          // última unidade: o teste de integração pegou isso acontecendo.
          const travado = await tx.$queryRaw<Array<{ quantidade: number }>>`
            SELECT quantidade FROM produtos
            WHERE id = ${produtoId} AND "tenantId" = ${tenantId}
            FOR UPDATE`;

          const produto = travado[0];
          if (produto === undefined) throw new Error("NAO_ENCONTRADO");

          const ativas = await tx.reserva.count({
            where: { produtoId, liberadaEm: null, expiraEm: { gt: opcoes.relogio.agora() } },
          });
          if (produto.quantidade - ativas <= 0) throw new Error("CONFLITO");

          return tx.reserva.create({ data: { tenantId, produtoId, conversaId, expiraEm } });
        });

        return ok({ id: reserva.id, produtoId, expiraEm });
      } catch (e) {
        const causa = (e as Error).message;
        return causa === "NAO_ENCONTRADO"
          ? erro("NAO_ENCONTRADO", "Produto não encontrado.")
          : erro("CONFLITO", "Sem unidade disponível para reservar.");
      }
    },
  };
}

export function repositorioTabelaTroca(opcoes: OpcoesPrisma): RepositorioTabelaTroca {
  return {
    async buscar(modeloDeclarado) {
      const linhas = await opcoes.db.tabelaTroca.findMany({
        where: { tenantId: opcoes.tenantId, ativo: true },
      });

      for (const linha of linhas) {
        if (modeloCombina(modeloDeclarado, linha.modelo)) {
          return { modelo: linha.modelo, valorBase: linha.valorBase };
        }
      }
      return null;
    },
  };
}

export function repositorioConversas(opcoes: OpcoesPrisma): RepositorioConversas {
  const { db, tenantId, relogio } = opcoes;
  const comContato = { contato: { select: { telefone: true, nome: true } } };

  return {
    async abrirOuRecuperar(telefone, nome) {
      const contato = await db.contato.upsert({
        where: { tenantId_telefone: { tenantId, telefone } },
        create: { tenantId, telefone, ...(nome === undefined ? {} : { nome }) },
        update: nome === undefined ? {} : { nome },
      });

      const aberta = await db.conversa.findFirst({
        where: { tenantId, contatoId: contato.id, estado: { not: "ENCERRADA" } },
        orderBy: { ultimaMensagemEm: "desc" },
        include: comContato,
      });
      if (aberta !== null) return conversaDeLinha(aberta);

      const nova = await db.conversa.create({
        data: { tenantId, contatoId: contato.id },
        include: comContato,
      });
      return conversaDeLinha(nova);
    },

    async porId(conversaId) {
      const linha = await db.conversa.findFirst({
        where: { id: conversaId, tenantId },
        include: comContato,
      });
      return linha === null ? null : conversaDeLinha(linha);
    },

    async atualizar(conversaId, dados) {
      const linha = await db.conversa.update({
        where: { id: conversaId },
        data: {
          ...(dados.estado === undefined ? {} : { estado: ESTADO_PARA_BANCO[dados.estado] as never }),
          ...(dados.rodadasNegociacao === undefined ? {} : { rodadasNegociacao: dados.rodadasNegociacao }),
          ...(dados.falhasAuditor === undefined ? {} : { falhasAuditor: dados.falhasAuditor }),
          ...(dados.responsavelId === undefined ? {} : { responsavelId: dados.responsavelId }),
          ...(dados.memoria === undefined ? {} : { memoria: dados.memoria as Prisma.InputJsonValue }),
          ultimaMensagemEm: relogio.agora(),
        },
        include: comContato,
      });
      return conversaDeLinha(linha);
    },

    async registrarMensagem(conversaId, direcao: DirecaoMensagem, texto, idExterno) {
      const linha = await db.mensagem.create({
        data: {
          conversaId,
          direcao: direcao === "entrada" ? "ENTRADA" : "SAIDA",
          texto,
          ...(idExterno === undefined || idExterno === "" ? {} : { idExterno }),
        },
      });
      return {
        id: linha.id,
        conversaId,
        direcao,
        texto,
        criadoEm: linha.criadoEm,
      } satisfies MensagemRegistro;
    },

    async historico(conversaId, limite) {
      const linhas = await db.mensagem.findMany({
        where: { conversaId },
        // Empates no timestamp são possíveis quando mensagens chegam juntas.
        // O id CUID dá uma ordem estável para desempatar esses registros.
        orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
        take: limite,
      });
      return linhas.reverse().map((m) => ({
        id: m.id,
        conversaId,
        direcao: m.direcao === "ENTRADA" ? ("entrada" as const) : ("saida" as const),
        texto: m.texto,
        criadoEm: m.criadoEm,
      }));
    },

    async mensagemJaProcessada(idExterno) {
      const existente = await db.mensagem.findUnique({ where: { idExterno } });
      return existente !== null;
    },

    async listarAtivas(limite) {
      const linhas = await db.conversa.findMany({
        where: { tenantId, estado: { not: "ENCERRADA" } },
        orderBy: { ultimaMensagemEm: "desc" },
        take: limite,
        include: comContato,
      });
      return linhas.map(conversaDeLinha);
    },
  };
}

export function repositorioAvaliacoes(opcoes: OpcoesPrisma): RepositorioAvaliacoes {
  const { db, tenantId } = opcoes;

  const paraRegistro = (linha: {
    id: string;
    conversaId: string;
    modeloDeclarado: string;
    respostas: Prisma.JsonValue;
    valorBase: number;
    valorApurado: number | null;
    validadeAte: Date | null;
    exigeAvaliacaoHumana: boolean;
    recusado: boolean;
  }): AvaliacaoRegistro => ({
    id: linha.id,
    conversaId: linha.conversaId,
    modeloDeclarado: linha.modeloDeclarado,
    respostas: objeto(linha.respostas),
    valorBase: linha.valorBase,
    valorApurado: linha.valorApurado,
    validadeAte: linha.validadeAte,
    exigeAvaliacaoHumana: linha.exigeAvaliacaoHumana,
    recusado: linha.recusado,
  });

  return {
    async criar(dados) {
      const linha = await db.avaliacaoUsado.create({
        data: {
          tenantId,
          conversaId: dados.conversaId,
          modeloDeclarado: dados.modeloDeclarado,
          valorBase: dados.valorBase,
          respostas: {},
        },
      });
      return paraRegistro(linha);
    },

    async porId(avaliacaoId) {
      const linha = await db.avaliacaoUsado.findFirst({ where: { id: avaliacaoId, tenantId } });
      return linha === null ? null : paraRegistro(linha);
    },

    async concluir(avaliacaoId, dados) {
      const linha = await db.avaliacaoUsado.update({
        where: { id: avaliacaoId },
        data: {
          ...(dados.respostas === undefined ? {} : { respostas: dados.respostas as Prisma.InputJsonValue }),
          ...(dados.valorApurado === undefined ? {} : { valorApurado: dados.valorApurado }),
          ...(dados.validadeAte === undefined ? {} : { validadeAte: dados.validadeAte }),
          ...(dados.exigeAvaliacaoHumana === undefined ? {} : { exigeAvaliacaoHumana: dados.exigeAvaliacaoHumana }),
          ...(dados.recusado === undefined ? {} : { recusado: dados.recusado }),
        },
      });
      return paraRegistro(linha);
    },
  };
}

const SITUACAO_PARA_BANCO: Record<PropostaRegistro["situacao"], string> = {
  rascunho: "RASCUNHO",
  aguardando_aprovacao: "AGUARDANDO_APROVACAO",
  enviada: "ENVIADA",
  aceita: "ACEITA",
  recusada: "RECUSADA",
  expirada: "EXPIRADA",
};

export function repositorioPropostas(opcoes: OpcoesPrisma): RepositorioPropostas {
  const { db, tenantId } = opcoes;

  const paraRegistro = (linha: {
    id: string;
    conversaId: string;
    precoProduto: number;
    valorAparelhoUsado: number;
    diferencaAPagar: number;
    exigeAprovacaoHumana: boolean;
    situacao: string;
    validadeAte: Date;
    versaoModelo: string;
    versaoPrompt: string;
  }): PropostaRegistro => ({
    id: linha.id,
    conversaId: linha.conversaId,
    precoProduto: linha.precoProduto,
    valorAparelhoUsado: linha.valorAparelhoUsado,
    diferencaAPagar: linha.diferencaAPagar,
    exigeAprovacaoHumana: linha.exigeAprovacaoHumana,
    situacao: paraDominio<PropostaRegistro["situacao"]>(linha.situacao),
    validadeAte: linha.validadeAte,
    versaoModelo: linha.versaoModelo,
    versaoPrompt: linha.versaoPrompt,
  });

  return {
    async criar(dados) {
      const linha = await db.proposta.create({
        data: {
          tenantId,
          conversaId: dados.conversaId,
          precoProduto: dados.precoProduto,
          valorAparelhoUsado: dados.valorAparelhoUsado,
          diferencaAPagar: dados.diferencaAPagar,
          exigeAprovacaoHumana: dados.exigeAprovacaoHumana,
          situacao: SITUACAO_PARA_BANCO[dados.situacao] as never,
          validadeAte: dados.validadeAte,
          versaoModelo: dados.versaoModelo,
          versaoPrompt: dados.versaoPrompt,
        },
      });
      return paraRegistro(linha);
    },

    async porId(propostaId) {
      const linha = await db.proposta.findFirst({ where: { id: propostaId, tenantId } });
      return linha === null ? null : paraRegistro(linha);
    },

    async aprovar(propostaId, usuarioId) {
      const linha = await db.proposta.update({
        where: { id: propostaId },
        data: { situacao: "ENVIADA", aprovadaPor: usuarioId },
      });
      return paraRegistro(linha);
    },

    async listarPendentes(limite) {
      const linhas = await db.proposta.findMany({
        where: { tenantId, situacao: "AGUARDANDO_APROVACAO" },
        orderBy: { criadoEm: "desc" },
        take: limite,
      });
      return linhas.map(paraRegistro);
    },
  };
}

export function repositorioLeads(opcoes: OpcoesPrisma): RepositorioLeads {
  return {
    async registrar(dados) {
      const conversa = await opcoes.db.conversa.findFirst({
        where: { id: dados.conversaId, tenantId: opcoes.tenantId },
      });
      if (conversa === null) return { id: "" };

      await opcoes.db.contato.update({
        where: { id: conversa.contatoId },
        data: {
          ...(dados.nome === undefined ? {} : { nome: dados.nome }),
          aceitaContato: dados.aceitaContato,
          ...(dados.aceitaContato ? { consentimentoEm: opcoes.relogio.agora() } : {}),
        },
      });

      await opcoes.db.registroAuditoria.create({
        data: {
          tenantId: opcoes.tenantId,
          conversaId: dados.conversaId,
          tipo: "lead",
          detalhe: { interesse: dados.interesse, aceitaContato: dados.aceitaContato },
        },
      });

      return { id: conversa.contatoId };
    },
  };
}

const MOTIVO_PARA_BANCO: Record<MotivoEscalonamento, string> = {
  frustracao: "FRUSTRACAO",
  fora_de_escopo: "FORA_DE_ESCOPO",
  falha_auditor: "FALHA_AUDITOR",
  valor_acima_alcada: "VALOR_ACIMA_ALCADA",
  pedido_do_cliente: "PEDIDO_DO_CLIENTE",
  avaliacao_humana_necessaria: "AVALIACAO_HUMANA_NECESSARIA",
};

export function repositorioEscalonamentos(opcoes: OpcoesPrisma): RepositorioEscalonamentos {
  const { db, tenantId } = opcoes;

  return {
    async criar(conversaId, motivo, resumo) {
      const linha = await db.escalonamento.create({
        data: { tenantId, conversaId, motivo: MOTIVO_PARA_BANCO[motivo] as never, resumo },
      });
      return { id: linha.id };
    },

    async assumir(escalonamentoId, usuarioId) {
      await db.escalonamento.update({
        where: { id: escalonamentoId },
        data: { assumidoPor: usuarioId, assumidoEm: opcoes.relogio.agora() },
      });
    },

    async listarAbertos(limite) {
      const linhas = await db.escalonamento.findMany({
        where: { tenantId, assumidoEm: null },
        orderBy: { criadoEm: "desc" },
        take: limite,
      });
      return linhas.map((e) => ({
        id: e.id,
        conversaId: e.conversaId,
        motivo: paraDominio(e.motivo),
        resumo: e.resumo,
        criadoEm: e.criadoEm,
      }));
    },
  };
}

export function repositorioAuditoria(opcoes: OpcoesPrisma): RepositorioAuditoria {
  return {
    async registrar(tipo, detalhe, conversaId) {
      await opcoes.db.registroAuditoria.create({
        data: {
          tenantId: opcoes.tenantId,
          tipo,
          detalhe: detalhe as Prisma.InputJsonValue,
          ...(conversaId === undefined ? {} : { conversaId }),
        },
      });
    },

    async listar(limite) {
      const linhas = await opcoes.db.registroAuditoria.findMany({
        where: { tenantId: opcoes.tenantId },
        orderBy: { criadoEm: "desc" },
        take: limite,
      });
      return linhas.map((r) => ({
        tipo: r.tipo,
        detalhe: objeto(r.detalhe) as Record<string, unknown>,
        criadoEm: r.criadoEm,
      }));
    },
  };
}

export function repositorioUsuarios(opcoes: OpcoesPrisma): RepositorioUsuarios {
  return {
    async porEmail(email) {
      const linha = await opcoes.db.usuario.findFirst({
        where: { tenantId: opcoes.tenantId, email: email.toLowerCase(), ativo: true },
      });
      return linha === null
        ? null
        : { id: linha.id, nome: linha.nome, papel: paraDominio(linha.papel), senhaHash: linha.senhaHash };
    },
  };
}

export function repositorioMetricas(opcoes: OpcoesPrisma): RepositorioMetricas {
  const { db, tenantId } = opcoes;

  return {
    async resumo(desde) {
      const [conversas, escalonamentos, bloqueios, propostas] = await Promise.all([
        db.conversa.findMany({ where: { tenantId, criadoEm: { gte: desde } }, select: { id: true } }),
        db.escalonamento.findMany({
          where: { tenantId, criadoEm: { gte: desde } },
          select: { conversaId: true, motivo: true, criadoEm: true, assumidoEm: true },
        }),
        db.registroAuditoria.count({ where: { tenantId, tipo: "bloqueio_auditor", criadoEm: { gte: desde } } }),
        db.proposta.count({ where: { tenantId, criadoEm: { gte: desde } } }),
      ]);

      const comEscalonamento = new Set(escalonamentos.map((e) => e.conversaId));

      return calcularMetricas(desde, {
        conversas: conversas.length,
        conversasComEscalonamento: conversas.filter((c) => comEscalonamento.has(c.id)).length,
        motivos: escalonamentos.map((e) => e.motivo.toLowerCase()),
        bloqueiosAuditor: bloqueios,
        propostas,
        esperasSegundos: escalonamentos
          .filter((e): e is typeof e & { assumidoEm: Date } => e.assumidoEm !== null)
          .map((e) => Math.round((e.assumidoEm.getTime() - e.criadoEm.getTime()) / 1000)),
      });
    },
  };
}

/** Todos os repositórios de uma loja, prontos para a montagem. */
export function repositoriosPrisma(opcoes: OpcoesPrisma) {
  return {
    estoque: repositorioEstoque(opcoes),
    tabelaTroca: repositorioTabelaTroca(opcoes),
    conversas: repositorioConversas(opcoes),
    avaliacoes: repositorioAvaliacoes(opcoes),
    propostas: repositorioPropostas(opcoes),
    leads: repositorioLeads(opcoes),
    escalonamentos: repositorioEscalonamentos(opcoes),
    auditoria: repositorioAuditoria(opcoes),
    usuarios: repositorioUsuarios(opcoes),
    metricas: repositorioMetricas(opcoes),
  };
}

export type CategoriaBanco = keyof typeof CATEGORIA_PARA_BANCO;
export { CATEGORIA_PARA_BANCO };
