import { afterEach, describe, expect, it, vi } from "vitest";
import { calcularMetricas, mediana } from "../lib/dominio/metricas.js";
import { validarEnv } from "../lib/env.js";
import { extrairJson, postJson } from "../lib/modelo/http.js";
import { montarPrompt } from "../lib/modelo/prompt.js";
import { config } from "./fixtures.js";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres";

describe("validarEnv", () => {
  afterEach(() => vi.restoreAllMocks());

  it("devolve o ambiente quando está tudo certo", () => {
    const env = validarEnv({ SESSION_SECRET: SEGREDO } as NodeJS.ProcessEnv);
    expect(env.PORTA).toBe(3000);
  });

  it("lista cada problema e encerra o processo quando o ambiente é inválido", () => {
    const saida = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    const erros: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((t) => {
      erros.push(String(t));
      return true;
    });

    expect(() => validarEnv({ SESSION_SECRET: "curto", PORTA: "0" } as NodeJS.ProcessEnv)).toThrow("exit");
    expect(saida).toHaveBeenCalledWith(1);
    expect(erros[0]).toContain("[FATAL]");
    expect(erros.some((e) => e.includes("SESSION_SECRET"))).toBe(true);
    expect(erros.some((e) => e.includes("PORTA"))).toBe(true);
  });
});

describe("postJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("devolve o corpo quando a resposta é 2xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":1}', { status: 200 })));
    const r = await postJson({ url: "http://modelo/api", corpo: {}, timeoutMs: 1000 });
    expect(r.ok && r.value).toEqual({ ok: 1 });
  });

  it("transforma status de erro em erro tipado, com o corpo cortado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(900), { status: 502 })));
    const r = await postJson({ url: "http://modelo/api", corpo: {}, timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toBe("HTTP 502 em http://modelo/api");
      expect((r.error.detalhes?.corpo as string).length).toBe(500);
    }
  });

  it("transforma falha de rede e timeout em erro, sem lançar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    const rede = await postJson({ url: "http://modelo/api", corpo: {}, timeoutMs: 1000 });
    expect(!rede.ok && rede.error.message).toContain("ECONNREFUSED");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject("abortado")));
    const texto = await postJson({ url: "http://modelo/api", corpo: {}, timeoutMs: 1000 });
    expect(!texto.ok && texto.error.message).toContain("abortado");
  });
});

describe("extrairJson", () => {
  it("recusa chaves que não formam um JSON válido", () => {
    const r = extrairJson('resposta: {"acao": responder}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe("JSON malformado na resposta do modelo.");
  });
});

describe("métricas", () => {
  it("mediana de quantidade par arredonda a média dos dois do meio", () => {
    expect(mediana([10, 40, 20, 31])).toBe(26);
    expect(mediana([5, 1, 9])).toBe(5);
    expect(mediana([])).toBeNull();
  });

  it("período sem conversa dá contenção zero, sem divisão por zero", () => {
    const m = calcularMetricas(new Date(0), {
      conversas: 0,
      conversasComEscalonamento: 0,
      motivos: [],
      bloqueiosAuditor: 0,
      propostas: 0,
      esperasSegundos: [],
    });
    expect(m.taxaContencao).toBe(0);
    expect(m.medianaAteHumanoSegundos).toBeNull();
  });

  it("conta escalonamento por motivo e espera acima do limite do SAC", () => {
    const m = calcularMetricas(new Date(0), {
      conversas: 4,
      conversasComEscalonamento: 1,
      motivos: ["frustracao", "frustracao", "pedido_do_cliente"],
      bloqueiosAuditor: 2,
      propostas: 3,
      esperasSegundos: [30, 61, 120],
    });
    expect(m.taxaContencao).toBe(75);
    expect(m.escalonamentos).toEqual({ frustracao: 2, pedido_do_cliente: 1 });
    expect(m.acimaDe60Segundos).toBe(2);
  });
});

describe("horário no prompt", () => {
  it("omite o dia fechado e avisa quando não abre no domingo", () => {
    const fechadoSabado = {
      ...config,
      tenant: { ...config.tenant, horario: { seg_sex: "08:00-17:00", sabado: null, domingo: null } },
    };
    const texto = montarPrompt({ config: fechadoSabado, estado: "descoberta", memoria: {} });
    expect(texto).toContain("segunda a sexta 08:00-17:00, fechado no domingo");
    expect(texto).not.toContain("sábado");
  });

  it("mostra o horário de domingo quando a loja abre", () => {
    const abreDomingo = {
      ...config,
      tenant: { ...config.tenant, horario: { seg_sex: null, sabado: "09:00-13:00", domingo: "10:00-14:00" } },
    };
    const texto = montarPrompt({ config: abreDomingo, estado: "descoberta", memoria: {} });
    expect(texto).toContain("sábado 09:00-13:00, domingo 10:00-14:00");
  });
});
