import type { AdaptadoresMemoria } from "./adaptadores/memoria.js";
import type { Logger } from "./log.js";
import type { DependenciasOrquestrador } from "./orquestrador.js";
import type { Canal, ClienteModelo, Relogio } from "./portas.js";
import {
  paraContextoAuditoriaBase,
  paraPoliticaPreco,
  paraRegraTroca,
  paraTabelaParcelamento,
} from "./tenant/carregar.js";
import type { ConfigTenant } from "./tenant/schema.js";

/** Usuários e métricas são assunto do painel, não do orquestrador. */
type Repositorios = Omit<AdaptadoresMemoria, "estado" | "canal" | "usuarios" | "metricas">;

export interface OpcoesMontagem {
  readonly config: ConfigTenant;
  readonly repositorios: Repositorios;
  readonly modelo: ClienteModelo;
  readonly canal: Canal;
  readonly relogio: Relogio;
  readonly log: Logger;
  readonly agenteAtivo: () => boolean;
}

/** Junta configuração, domínio e adaptadores num orquestrador pronto para uso. */
export function montarOrquestrador(opcoes: OpcoesMontagem): DependenciasOrquestrador {
  return {
    config: opcoes.config,
    politica: paraPoliticaPreco(opcoes.config),
    tabelaParcelamento: paraTabelaParcelamento(opcoes.config),
    regraTroca: paraRegraTroca(opcoes.config),
    contextoBase: paraContextoAuditoriaBase(opcoes.config),
    ...opcoes.repositorios,
    modelo: opcoes.modelo,
    canal: opcoes.canal,
    relogio: opcoes.relogio,
    log: opcoes.log,
    agenteAtivo: opcoes.agenteAtivo,
  };
}
