import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { reais } from "../lib/dinheiro.js";
import {
  carregarConfigDeArquivo,
  paraContextoAuditoriaBase,
  paraPoliticaPreco,
  paraRegraTroca,
  paraTabelaParcelamento,
  validarConfig,
  valorMinimoTroca,
} from "../lib/tenant/carregar.js";
import { CAMINHO_CONFIG_EXEMPLO, config } from "./fixtures.js";

const pasta = mkdtempSync(join(tmpdir(), "balcao-config-"));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

function arquivoCom(conteudo: string, nome = "teste.yml"): string {
  const caminho = join(pasta, nome);
  writeFileSync(caminho, conteudo, "utf8");
  return caminho;
}

describe("carregamento", () => {
  it("carrega e valida o arquivo de exemplo do repositório", () => {
    const r = carregarConfigDeArquivo(CAMINHO_CONFIG_EXEMPLO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tenant.slug).toBe("loja-exemplo");
  });

  it("avisa quando o arquivo não existe", () => {
    const r = carregarConfigDeArquivo(join(pasta, "nao-existe.yml"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("NAO_ENCONTRADO");
  });

  it("avisa quando o YAML está quebrado", () => {
    const r = carregarConfigDeArquivo(arquivoCom("tenant: [\n  slug: x\n"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONFIG_INVALIDA");
  });
});

describe("validação", () => {
  it("lista todos os problemas de uma vez", () => {
    const r = validarConfig({ tenant: { slug: "MAIÚSCULO" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("CONFIG_INVALIDA");
    expect((r.error.detalhes?.problemas as string[]).length).toBeGreaterThan(1);
  });

  it("recusa slug fora do padrão", () => {
    const invalido = structuredClone(config) as Record<string, unknown>;
    (invalido.tenant as Record<string, unknown>).slug = "Loja Exemplo";
    expect(validarConfig(invalido).ok).toBe(false);
  });

  it("recusa política de preço incoerente antes de a loja subir", () => {
    const invalido = structuredClone(config) as Record<string, unknown>;
    (invalido.politica_preco as Record<string, unknown>).concessao_por_rodada = [8, 2];
    const r = validarConfig(invalido);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("diminuir");
  });

  it("recusa redutor positivo na tabela de troca", () => {
    const invalido = structuredClone(config) as Record<string, unknown>;
    (invalido.troca as { redutores: Record<string, unknown> }).redutores.brinde = 0.2;
    expect(validarConfig(invalido).ok).toBe(false);
  });

  it("recusa versão de modelo vazia", () => {
    const invalido = structuredClone(config) as Record<string, unknown>;
    (invalido.modelo as { primario: Record<string, unknown> }).primario.id = "";
    expect(validarConfig(invalido).ok).toBe(false);
  });

  it("aplica os padrões de quem não preencheu tudo", () => {
    const semEscalonamento = structuredClone(config) as Record<string, unknown>;
    delete semEscalonamento.escalonamento;
    const r = validarConfig(semEscalonamento);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.escalonamento.max_falhas_auditor).toBe(2);
    expect(r.value.escalonamento.max_rodadas_negociacao).toBe(3);
  });
});

describe("adaptação para o domínio", () => {
  it("converte reais em centavos", () => {
    const politica = paraPoliticaPreco(config);
    expect(politica.alcadaAprovacaoHumana).toBe(reais(250));
    expect(politica.arredondamentoCentavos).toBe(100);
    expect(valorMinimoTroca(config)).toBe(reais(150));
  });

  it("converte a tabela de parcelamento para chaves numéricas", () => {
    const tabela = paraTabelaParcelamento(config);
    expect(tabela[12]).toBe(15);
    expect(tabela[1]).toBe(0);
    expect(tabela[7]).toBeUndefined();
  });

  it("leva as regras de troca inteiras para o domínio", () => {
    const regra = paraRegraTroca(config);
    expect(regra.redutores.tela_trincada).toBe(-0.35);
    expect(regra.redutores.nao_liga).toBe("recusar");
    expect(regra.recusaAutomatica).toContain("aparelho_bloqueado");
    expect(regra.valorMinimoAceito).toBe(reais(150));
  });

  it("libera os números públicos da loja para o auditor", () => {
    const contexto = paraContextoAuditoriaBase(config);
    expect(contexto.numerosPermitidos).toContain(1500);
    expect(contexto.numerosPermitidos).toContain(1433334444);
    expect(contexto.frasesProibidas).toContain("garantia estendida");
    expect(contexto.monetariosPermitidos).toEqual([]);
  });

  it("funciona sem telefone público cadastrado", () => {
    const semTelefone = structuredClone(config) as { tenant: Record<string, unknown> };
    delete semTelefone.tenant.telefone_publico;
    const r = validarConfig(semTelefone);
    if (!r.ok) throw new Error("deveria validar");
    expect(paraContextoAuditoriaBase(r.value).numerosPermitidos).not.toContain(1433334444);
  });
});
