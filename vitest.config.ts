import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts", "app/**/*.ts"],
      // Fora do gate: código que só existe para falar com serviço externo e
      // que é exercitado na homologação, não em teste de unidade.
      exclude: [
        "lib/portas.ts",
        "lib/adaptadores/prisma.ts",
        "lib/modelo/ollama.ts",
        "lib/modelo/openai-compat.ts",
        "lib/modelo/index.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
        // O domínio e o auditor decidem preço: aqui a régua é mais alta.
        "lib/dominio/**": { lines: 95, functions: 95, branches: 90, statements: 95 },
        "lib/auditor/**": { lines: 90, functions: 95, branches: 85, statements: 90 },
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
