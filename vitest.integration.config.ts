import { defineConfig } from "vitest/config";

// Suíte que precisa de PostgreSQL. Roda no CI e localmente quando o banco
// estiver de pé: DATABASE_URL=... npm run test:integration
export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/integracao/**/*.test.ts"],
    // Cada arquivo mexe no mesmo banco; sem paralelismo não há corrida falsa.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
