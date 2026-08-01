// Log estruturado em JSON, sem dependência externa. Conteúdo de mensagem de
// cliente não entra no log: para ler a conversa existe o painel.

export type NivelLog = "debug" | "info" | "warn" | "error";

const ORDEM: Record<NivelLog, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(evento: string, dados?: Record<string, unknown>): void;
  info(evento: string, dados?: Record<string, unknown>): void;
  warn(evento: string, dados?: Record<string, unknown>): void;
  error(evento: string, dados?: Record<string, unknown>): void;
  filho(contexto: Record<string, unknown>): Logger;
}

export interface OpcoesLogger {
  readonly nivel?: NivelLog;
  readonly contexto?: Record<string, unknown>;
  readonly escrever?: (linha: string) => void;
  readonly agora?: () => Date;
}

export function criarLogger(opcoes: OpcoesLogger = {}): Logger {
  const nivel = opcoes.nivel ?? "info";
  const contexto = opcoes.contexto ?? {};
  const escrever = opcoes.escrever ?? ((linha: string) => process.stdout.write(`${linha}\n`));
  const agora = opcoes.agora ?? (() => new Date());

  const emitir = (nivelEvento: NivelLog, evento: string, dados?: Record<string, unknown>): void => {
    if (ORDEM[nivelEvento] < ORDEM[nivel]) return;
    escrever(
      JSON.stringify({
        ts: agora().toISOString(),
        nivel: nivelEvento,
        evento,
        ...contexto,
        ...dados,
      }),
    );
  };

  return {
    debug: (e, d) => emitir("debug", e, d),
    info: (e, d) => emitir("info", e, d),
    warn: (e, d) => emitir("warn", e, d),
    error: (e, d) => emitir("error", e, d),
    filho: (novo) => criarLogger({ ...opcoes, nivel, contexto: { ...contexto, ...novo } }),
  };
}

/** Logger que não escreve nada. Usado em teste e em script silencioso. */
export const loggerSilencioso: Logger = criarLogger({ nivel: "error", escrever: () => undefined });
