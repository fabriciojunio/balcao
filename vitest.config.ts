import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**/*.ts"],
      // O domínio e o auditor são funções puras: não há desculpa para
      // cobertura baixa. O gate protege exatamente o código que decide preço.
      exclude: ["lib/prisma.ts", "lib/**/tipos.ts", "lib/modelo/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
});
