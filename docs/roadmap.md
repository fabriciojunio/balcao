# O que falta

Ordem de construção. Cada item só começa quando o anterior está com teste verde.

## Pronto

- Valores em centavos inteiros, com formatação e leitura em português
- Motor de preço: margem mínima, teto por categoria, concessão por rodada, parcelamento com taxa
  real, validação da política
- Motor de avaliação de usado: estados, redutores, recusa automática, limite de queda, checklist
  guiado, conversão de respostas em defeitos
- Proposta de troca com conferência de margem do conjunto
- Auditor de saída: extração de valores, resolução de marcadores, conferência, frases proibidas
- Máquina de estados da conversa e catálogo fechado de ferramentas
- Pipeline entre modelo e envio, com repetição e escalonamento
- Configuração por loja validada por esquema, com adaptação para o domínio
- Bateria de conversas de referência com executor
- Modelo de dados

## Próximo

**1. Camada de dados**
Repositórios sobre o Prisma, com o tenant aplicado na consulta e não no código de chamada. Reserva
de produto transacional, testada sob concorrência: duas conversas disputando a última unidade não
podem ambas fechar.

**2. Ferramentas ligadas ao banco**
Implementação de cada item de `lib/ferramentas/catalogo.ts` sobre os repositórios, devolvendo o id
de consulta que alimenta o auditor.

**3. Camada de modelo**
Interface única com adaptadores para runtime local e contingência em nuvem, versão travada por
identificador exato, teto de tokens por conversa e troca automática quando o principal cai.

**4. Canal WhatsApp**
Webhook com conferência de assinatura, deduplicação por identificador externo, fila com
agrupamento de mensagem picotada e limite de vazão. Simulador de conversa para desenvolvimento.

**5. Orquestrador**
Junta estado, memória da conversa, seleção de ferramentas, pipeline e escalonamento. É a peça que
transforma os módulos prontos em atendimento.

**6. Painel**
Fila de atendimento em tempo real, assumir conversa, aprovar proposta, editar política e tabela de
troca com versionamento, relatórios e o botão de desligar.

**7. Conectores de estoque**
Um adaptador por sistema, mesma interface. Começa pelo que a loja do primeiro contrato usa.

**8. Observabilidade**
Log estruturado por conversa, métricas de escalonamento e de bloqueio do auditor, alertas.

**9. Retomada de lead**
Templates aprovados, respeito ao consentimento e limite de duas retomadas.

## Depois

- Migração do modelo para servidor na loja, com contingência em nuvem
- Segunda loja, para provar que o custo de implantação cai
- Calibragem da tabela de troca com os valores conferidos na loja contra os cotados na conversa
