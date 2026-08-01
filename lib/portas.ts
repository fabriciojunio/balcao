// Portas do sistema. O orquestrador depende só destas interfaces, o que
// permite rodar o fluxo inteiro em teste, sem banco e sem rede.

import type { Centavos } from "./dinheiro.js";
import type { EstadoConversa, MotivoEscalonamento } from "./dominio/conversa.js";
import type { Produto } from "./dominio/preco.js";
import type { Result } from "./result.js";
import type { LeituraDeImagem } from "./dominio/visao.js";

// ---------------------------------------------------------------------------
// Estoque
// ---------------------------------------------------------------------------

export interface ProdutoEmEstoque extends Produto {
  readonly quantidade: number;
  readonly memoriaGb?: number;
  readonly cor?: string;
  readonly garantiaMeses?: number;
  /** Foto do aparelho, enviada junto da proposta. */
  readonly fotoUrl?: string;
  /** Momento da última sincronização com o sistema da loja. */
  readonly sincronizadoEm: Date;
}

export interface FiltroEstoque {
  readonly termo: string;
  readonly memoriaGb?: number;
  readonly cor?: string;
  readonly precoMaximo?: Centavos;
}

export interface Reserva {
  readonly id: string;
  readonly produtoId: string;
  readonly expiraEm: Date;
}

export interface RepositorioEstoque {
  buscar(filtro: FiltroEstoque): Promise<ProdutoEmEstoque[]>;
  porId(produtoId: string): Promise<ProdutoEmEstoque | null>;
  /** Transacional: duas conversas não podem reservar a última unidade. */
  reservar(produtoId: string, conversaId: string, expiraEm: Date): Promise<Result<Reserva>>;
}

export interface ModeloTabelado {
  /** Nome canônico da tabela, para não repetir a frase do cliente. */
  readonly modelo: string;
  readonly valorBase: Centavos;
}

export interface RepositorioTabelaTroca {
  /** Devolve null quando a loja não tem esse modelo na tabela. */
  buscar(modeloDeclarado: string): Promise<ModeloTabelado | null>;
}

// ---------------------------------------------------------------------------
// Conversa
// ---------------------------------------------------------------------------

export type DirecaoMensagem = "entrada" | "saida";

export interface MensagemRegistro {
  readonly id: string;
  readonly conversaId: string;
  readonly direcao: DirecaoMensagem;
  readonly texto: string;
  readonly criadoEm: Date;
}

export interface ConversaRegistro {
  readonly id: string;
  readonly contatoId: string;
  readonly telefone: string;
  readonly nomeContato?: string;
  readonly estado: EstadoConversa;
  readonly rodadasNegociacao: number;
  readonly falhasAuditor: number;
  readonly responsavelId: string | null;
  readonly ultimaMensagemEm: Date;
  /** Anotações que a conversa carrega entre turnos (produto em foco, cotação). */
  readonly memoria: Readonly<Record<string, string>>;
}

export type AtualizacaoConversa = Partial<
  Pick<ConversaRegistro, "estado" | "rodadasNegociacao" | "falhasAuditor" | "responsavelId" | "memoria">
>;

export interface RepositorioConversas {
  abrirOuRecuperar(telefone: string, nome?: string): Promise<ConversaRegistro>;
  porId(conversaId: string): Promise<ConversaRegistro | null>;
  atualizar(conversaId: string, dados: AtualizacaoConversa): Promise<ConversaRegistro>;
  registrarMensagem(
    conversaId: string,
    direcao: DirecaoMensagem,
    texto: string,
    idExterno?: string,
  ): Promise<MensagemRegistro>;
  historico(conversaId: string, limite: number): Promise<MensagemRegistro[]>;
  /** Deduplicação: a Meta reenvia o mesmo evento em caso de falha de entrega. */
  mensagemJaProcessada(idExterno: string): Promise<boolean>;
  listarAtivas(limite: number): Promise<ConversaRegistro[]>;
}

// ---------------------------------------------------------------------------
// Avaliação e proposta
// ---------------------------------------------------------------------------

export interface AvaliacaoRegistro {
  readonly id: string;
  readonly conversaId: string;
  readonly modeloDeclarado: string;
  readonly respostas: Readonly<Record<string, string>>;
  readonly valorBase: Centavos;
  readonly valorApurado: Centavos | null;
  readonly validadeAte: Date | null;
  readonly exigeAvaliacaoHumana: boolean;
  readonly recusado: boolean;
}

export interface RepositorioAvaliacoes {
  criar(dados: {
    conversaId: string;
    modeloDeclarado: string;
    valorBase: Centavos;
  }): Promise<AvaliacaoRegistro>;
  porId(avaliacaoId: string): Promise<AvaliacaoRegistro | null>;
  concluir(
    avaliacaoId: string,
    dados: Partial<Pick<AvaliacaoRegistro, "respostas" | "valorApurado" | "validadeAte" | "exigeAvaliacaoHumana" | "recusado">>,
  ): Promise<AvaliacaoRegistro>;
}

export interface PropostaRegistro {
  readonly id: string;
  readonly conversaId: string;
  readonly precoProduto: Centavos;
  readonly valorAparelhoUsado: Centavos;
  readonly diferencaAPagar: Centavos;
  readonly exigeAprovacaoHumana: boolean;
  readonly situacao: "rascunho" | "aguardando_aprovacao" | "enviada" | "aceita" | "recusada" | "expirada";
  readonly validadeAte: Date;
  readonly versaoModelo: string;
  readonly versaoPrompt: string;
}

export interface RepositorioPropostas {
  criar(dados: Omit<PropostaRegistro, "id">): Promise<PropostaRegistro>;
  porId(propostaId: string): Promise<PropostaRegistro | null>;
  aprovar(propostaId: string, usuarioId: string): Promise<PropostaRegistro>;
  listarPendentes(limite: number): Promise<PropostaRegistro[]>;
}

// ---------------------------------------------------------------------------
// Operação
// ---------------------------------------------------------------------------

export interface RepositorioEscalonamentos {
  criar(conversaId: string, motivo: MotivoEscalonamento, resumo: string): Promise<{ id: string }>;
  assumir(escalonamentoId: string, usuarioId: string): Promise<void>;
  listarAbertos(limite: number): Promise<Array<{ id: string; conversaId: string; motivo: string; resumo: string; criadoEm: Date }>>;
}

export interface RepositorioLeads {
  registrar(dados: {
    conversaId: string;
    interesse: string;
    nome?: string;
    aceitaContato: boolean;
  }): Promise<{ id: string }>;
}

export interface UsuarioPainel {
  readonly id: string;
  readonly nome: string;
  readonly papel: string;
  readonly senhaHash: string;
}

export interface RepositorioUsuarios {
  porEmail(email: string): Promise<UsuarioPainel | null>;
}

export interface RepositorioAuditoria {
  registrar(tipo: string, detalhe: Record<string, unknown>, conversaId?: string): Promise<void>;
  listar(limite: number): Promise<Array<{ tipo: string; detalhe: Record<string, unknown>; criadoEm: Date }>>;
}

// ---------------------------------------------------------------------------
// Infraestrutura
// ---------------------------------------------------------------------------

export interface Relogio {
  agora(): Date;
}

export const relogioDoSistema: Relogio = { agora: () => new Date() };

export interface EnvioCanal {
  readonly idExterno: string;
}

export interface Canal {
  readonly nome: string;
  enviar(telefone: string, texto: string): Promise<Result<EnvioCanal>>;
  /** Manda a foto do produto junto da proposta. A legenda passa pelo auditor. */
  enviarImagem?(telefone: string, urlOuId: string, legenda: string): Promise<Result<EnvioCanal>>;
  /** Baixa a mídia que o cliente enviou, para transcrever ou ler. */
  baixarMidia?(midiaId: string): Promise<Result<{ conteudo: Buffer; mime: string }>>;
}

export interface Transcritor {
  transcrever(audio: { conteudo: Buffer; mime: string }): Promise<Result<string>>;
}

export interface AnalisadorDeImagem {
  analisar(imagem: { conteudo: Buffer; mime: string }): Promise<Result<LeituraDeImagem>>;
}

export interface Metricas {
  readonly desde: Date;
  readonly conversas: number;
  readonly conversasContidas: number;
  readonly taxaContencao: number;
  readonly escalonamentos: Readonly<Record<string, number>>;
  readonly bloqueiosAuditor: number;
  readonly propostas: number;
  /** Segundos até um vendedor assumir. O Decreto 11.034 fala em 60. */
  readonly medianaAteHumanoSegundos: number | null;
  readonly acimaDe60Segundos: number;
}

export interface RepositorioMetricas {
  resumo(desde: Date): Promise<Metricas>;
}

export interface MensagemModelo {
  readonly papel: "sistema" | "usuario" | "assistente" | "ferramenta";
  readonly conteudo: string;
}

export interface EntradaModelo {
  readonly mensagens: readonly MensagemModelo[];
  readonly temperatura: number;
  readonly tetoTokens: number;
}

export interface SaidaModelo {
  /** O objeto que o modelo devolveu, ainda sem validar. */
  readonly conteudo: unknown;
  /** Versão exata que respondeu, para gravar na proposta. */
  readonly versao: string;
  readonly duracaoMs: number;
}

export interface ClienteModelo {
  readonly nome: string;
  readonly versao: string;
  gerar(entrada: EntradaModelo): Promise<Result<SaidaModelo>>;
}
