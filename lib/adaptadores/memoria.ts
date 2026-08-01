// Implementação em memória de todas as portas, para teste e demonstração.
// A semântica é a mesma do banco, inclusive a reserva sem venda duplicada.

import type { Centavos } from "../dinheiro.js";
import type { MotivoEscalonamento } from "../dominio/conversa.js";
import type {
  AtualizacaoConversa,
  AvaliacaoRegistro,
  Canal,
  ConversaRegistro,
  DirecaoMensagem,
  FiltroEstoque,
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
  RepositorioMetricas,
  RepositorioPropostas,
  RepositorioTabelaTroca,
  RepositorioUsuarios,
  Reserva,
  UsuarioPainel,
} from "../portas.js";
import { calcularMetricas } from "../dominio/metricas.js";
import { erro, ok, type Result } from "../result.js";
import { normalizarChave, semAcento } from "../texto.js";

export interface EnvioRegistrado {
  readonly telefone: string;
  readonly texto: string;
  readonly em: Date;
  readonly imagem?: string;
}

export interface EstadoMemoria {
  produtos: ProdutoEmEstoque[];
  tabelaTroca: Map<string, { modelo: string; valorBase: Centavos }>;
  conversas: Map<string, ConversaRegistro>;
  mensagens: MensagemRegistro[];
  idsExternos: Set<string>;
  avaliacoes: Map<string, AvaliacaoRegistro>;
  propostas: Map<string, PropostaRegistro>;
  reservas: Reserva[];
  escalonamentos: Array<{ id: string; conversaId: string; motivo: string; resumo: string; criadoEm: Date; assumidoPor?: string; assumidoEm?: Date }>;
  leads: Array<{ id: string; conversaId: string; interesse: string; nome?: string; aceitaContato: boolean }>;
  auditoria: Array<{ tipo: string; detalhe: Record<string, unknown>; criadoEm: Date; conversaId?: string }>;
  enviados: EnvioRegistrado[];
}

export interface OpcoesMemoria {
  readonly produtos?: readonly ProdutoEmEstoque[];
  readonly usuarios?: readonly (UsuarioPainel & { email: string })[];
  readonly tabelaTroca?: Readonly<Record<string, Centavos>>;
  /** Mídias que o cliente teria enviado, por id. */
  readonly midias?: Readonly<Record<string, { conteudo: Buffer; mime: string }>>;
  readonly relogio: Relogio;
}

let sequencia = 0;
const id = (prefixo: string): string => `${prefixo}-${(++sequencia).toString(36)}`;

function combina(texto: string, termo: string): boolean {
  const alvo = semAcento(texto).toLowerCase();
  const palavras = semAcento(termo)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 3);
  return palavras.length === 0 ? false : palavras.some((p) => alvo.includes(p));
}

export interface AdaptadoresMemoria {
  readonly estado: EstadoMemoria;
  readonly estoque: RepositorioEstoque;
  readonly tabelaTroca: RepositorioTabelaTroca;
  readonly conversas: RepositorioConversas;
  readonly avaliacoes: RepositorioAvaliacoes;
  readonly propostas: RepositorioPropostas;
  readonly leads: RepositorioLeads;
  readonly escalonamentos: RepositorioEscalonamentos;
  readonly auditoria: RepositorioAuditoria;
  readonly usuarios: RepositorioUsuarios;
  readonly metricas: RepositorioMetricas;
  readonly canal: Canal;
}

export function criarAdaptadoresMemoria(opcoes: OpcoesMemoria): AdaptadoresMemoria {
  const { relogio } = opcoes;

  const estado: EstadoMemoria = {
    produtos: [...(opcoes.produtos ?? [])],
    tabelaTroca: new Map(
      Object.entries(opcoes.tabelaTroca ?? {}).map(([modelo, valorBase]) => [
        normalizarChave(modelo).replaceAll("_", " "),
        { modelo, valorBase },
      ]),
    ),
    conversas: new Map(),
    mensagens: [],
    idsExternos: new Set(),
    avaliacoes: new Map(),
    propostas: new Map(),
    reservas: [],
    escalonamentos: [],
    leads: [],
    auditoria: [],
    enviados: [],
  };

  const reservasAtivas = (produtoId: string): number =>
    estado.reservas.filter(
      (r) => r.produtoId === produtoId && r.expiraEm.getTime() > relogio.agora().getTime(),
    ).length;

  const estoque: RepositorioEstoque = {
    async buscar(filtro: FiltroEstoque) {
      return estado.produtos.filter((p) => {
        if (!combina(p.descricao, filtro.termo)) return false;
        if (filtro.memoriaGb !== undefined && p.memoriaGb !== filtro.memoriaGb) return false;
        if (filtro.cor !== undefined && normalizarChave(p.cor ?? "") !== normalizarChave(filtro.cor)) return false;
        if (filtro.precoMaximo !== undefined && p.precoTabela > filtro.precoMaximo) return false;
        return true;
      });
    },

    async porId(produtoId) {
      return estado.produtos.find((p) => p.id === produtoId) ?? null;
    },

    async reservar(produtoId, conversaId, expiraEm): Promise<Result<Reserva>> {
      const produto = estado.produtos.find((p) => p.id === produtoId);
      if (produto === undefined) return erro("NAO_ENCONTRADO", "Produto não encontrado.");
      if (produto.quantidade - reservasAtivas(produtoId) <= 0) {
        return erro("CONFLITO", "Sem unidade disponível para reservar.");
      }
      const reserva: Reserva = { id: id("res"), produtoId, expiraEm };
      estado.reservas.push(reserva);
      void conversaId;
      return ok(reserva);
    },
  };

  const tabelaTroca: RepositorioTabelaTroca = {
    async buscar(modeloDeclarado) {
      const chave = normalizarChave(modeloDeclarado).replaceAll("_", " ");
      for (const [alvo, linha] of estado.tabelaTroca) {
        if (chave.includes(alvo)) return linha;
      }
      return null;
    },
  };

  const conversas: RepositorioConversas = {
    async abrirOuRecuperar(telefone, nome) {
      for (const c of estado.conversas.values()) {
        if (c.telefone === telefone && c.estado !== "encerrada") return c;
      }
      const nova: ConversaRegistro = {
        id: id("conv"),
        contatoId: id("cont"),
        telefone,
        ...(nome === undefined ? {} : { nomeContato: nome }),
        estado: "recepcao",
        rodadasNegociacao: 0,
        falhasAuditor: 0,
        responsavelId: null,
        ultimaMensagemEm: relogio.agora(),
        memoria: {},
      };
      estado.conversas.set(nova.id, nova);
      return nova;
    },

    async porId(conversaId) {
      return estado.conversas.get(conversaId) ?? null;
    },

    async atualizar(conversaId, dados: AtualizacaoConversa) {
      const atual = estado.conversas.get(conversaId);
      if (atual === undefined) throw new Error(`Conversa ${conversaId} não existe.`);
      const nova: ConversaRegistro = { ...atual, ...dados, ultimaMensagemEm: relogio.agora() };
      estado.conversas.set(conversaId, nova);
      return nova;
    },

    async registrarMensagem(conversaId, direcao: DirecaoMensagem, texto, idExterno) {
      if (idExterno !== undefined) estado.idsExternos.add(idExterno);
      const mensagem: MensagemRegistro = {
        id: id("msg"),
        conversaId,
        direcao,
        texto,
        criadoEm: relogio.agora(),
      };
      estado.mensagens.push(mensagem);
      return mensagem;
    },

    async historico(conversaId, limite) {
      return estado.mensagens.filter((m) => m.conversaId === conversaId).slice(-limite);
    },

    async mensagemJaProcessada(idExterno) {
      return estado.idsExternos.has(idExterno);
    },

    async listarAtivas(limite) {
      return [...estado.conversas.values()]
        .sort((a, b) => b.ultimaMensagemEm.getTime() - a.ultimaMensagemEm.getTime())
        .slice(0, limite);
    },
  };

  const avaliacoes: RepositorioAvaliacoes = {
    async criar(dados) {
      const registro: AvaliacaoRegistro = {
        id: id("aval"),
        conversaId: dados.conversaId,
        modeloDeclarado: dados.modeloDeclarado,
        respostas: {},
        valorBase: dados.valorBase,
        valorApurado: null,
        validadeAte: null,
        exigeAvaliacaoHumana: false,
        recusado: false,
      };
      estado.avaliacoes.set(registro.id, registro);
      return registro;
    },

    async porId(avaliacaoId) {
      return estado.avaliacoes.get(avaliacaoId) ?? null;
    },

    async concluir(avaliacaoId, dados) {
      const atual = estado.avaliacoes.get(avaliacaoId);
      if (atual === undefined) throw new Error(`Avaliação ${avaliacaoId} não existe.`);
      const nova = { ...atual, ...dados };
      estado.avaliacoes.set(avaliacaoId, nova);
      return nova;
    },
  };

  const propostas: RepositorioPropostas = {
    async criar(dados) {
      const registro: PropostaRegistro = { id: id("prop"), ...dados };
      estado.propostas.set(registro.id, registro);
      return registro;
    },

    async porId(propostaId) {
      return estado.propostas.get(propostaId) ?? null;
    },

    async aprovar(propostaId, usuarioId) {
      const atual = estado.propostas.get(propostaId);
      if (atual === undefined) throw new Error(`Proposta ${propostaId} não existe.`);
      const nova: PropostaRegistro = { ...atual, situacao: "enviada" };
      estado.propostas.set(propostaId, nova);
      void usuarioId;
      return nova;
    },

    async listarPendentes(limite) {
      return [...estado.propostas.values()]
        .filter((p) => p.situacao === "aguardando_aprovacao")
        .slice(0, limite);
    },
  };

  const leads: RepositorioLeads = {
    async registrar(dados) {
      const registro = { id: id("lead"), ...dados };
      estado.leads.push(registro);
      return { id: registro.id };
    },
  };

  const escalonamentos: RepositorioEscalonamentos = {
    async criar(conversaId, motivo: MotivoEscalonamento, resumo) {
      const registro = { id: id("esc"), conversaId, motivo, resumo, criadoEm: relogio.agora() };
      estado.escalonamentos.push(registro);
      return { id: registro.id };
    },

    async assumir(escalonamentoId, usuarioId) {
      const alvo = estado.escalonamentos.find((e) => e.id === escalonamentoId);
      if (alvo !== undefined) {
        alvo.assumidoPor = usuarioId;
        alvo.assumidoEm = relogio.agora();
      }
    },

    async listarAbertos(limite) {
      return estado.escalonamentos.filter((e) => e.assumidoPor === undefined).slice(0, limite);
    },
  };

  const auditoria: RepositorioAuditoria = {
    async registrar(tipo, detalhe, conversaId) {
      estado.auditoria.push({
        tipo,
        detalhe,
        criadoEm: relogio.agora(),
        ...(conversaId === undefined ? {} : { conversaId }),
      });
    },

    async listar(limite) {
      return estado.auditoria.slice(-limite).reverse();
    },
  };

  const metricas: RepositorioMetricas = {
    async resumo(desde) {
      const conversas = [...estado.conversas.values()].filter((c) => c.ultimaMensagemEm >= desde);
      const escalonamentos = estado.escalonamentos.filter((e) => e.criadoEm >= desde);
      const comEscalonamento = new Set(escalonamentos.map((e) => e.conversaId));

      return calcularMetricas(desde, {
        conversas: conversas.length,
        conversasComEscalonamento: conversas.filter((c) => comEscalonamento.has(c.id)).length,
        motivos: escalonamentos.map((e) => e.motivo),
        bloqueiosAuditor: estado.auditoria.filter((a) => a.tipo === "bloqueio_auditor" && a.criadoEm >= desde).length,
        propostas: [...estado.propostas.values()].length,
        esperasSegundos: escalonamentos
          .filter((e) => e.assumidoEm !== undefined)
          .map((e) => Math.round((e.assumidoEm!.getTime() - e.criadoEm.getTime()) / 1000)),
      });
    },
  };

  const usuarios: RepositorioUsuarios = {
    async porEmail(email) {
      const alvo = (opcoes.usuarios ?? []).find((u) => u.email.toLowerCase() === email.toLowerCase());
      return alvo === undefined ? null : { id: alvo.id, nome: alvo.nome, papel: alvo.papel, senhaHash: alvo.senhaHash };
    },
  };

  const canal: Canal = {
    nome: "memoria",

    async enviar(telefone, texto) {
      estado.enviados.push({ telefone, texto, em: relogio.agora() });
      return ok({ idExterno: id("out") });
    },

    async enviarImagem(telefone, urlOuId, legenda) {
      estado.enviados.push({ telefone, texto: legenda, em: relogio.agora(), imagem: urlOuId });
      return ok({ idExterno: id("out") });
    },

    async baixarMidia(midiaId) {
      const arquivo = (opcoes.midias ?? {})[midiaId];
      return arquivo === undefined
        ? erro("NAO_ENCONTRADO", `Mídia ${midiaId} não existe.`)
        : ok(arquivo);
    },
  };

  return {
    estado,
    estoque,
    tabelaTroca,
    conversas,
    avaliacoes,
    propostas,
    leads,
    escalonamentos,
    auditoria,
    usuarios,
    metricas,
    canal,
  };
}
