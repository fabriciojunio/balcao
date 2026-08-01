# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento semântico.

## [Não lançado]

### Adicionado

- Núcleo de valores monetários em centavos inteiros, com formatação e leitura em português sem
  depender de ICU.
- Motor de precificação: margem mínima, teto de desconto por categoria, concessão por rodada de
  negociação, piso que nenhum caminho do código consegue furar e parcelamento com as taxas reais
  da loja.
- Motor de avaliação de aparelho usado: ajuste por estado, redutores por defeito, recusa
  automática, limite de queda do valor, faixa que nunca promete acima do apurado e checklist
  guiado com uma pergunta por vez.
- Montagem de proposta de troca com conferência da margem do conjunto e regras de aprovação
  humana.
- Auditor de saída: extração de todo número da mensagem, resolução de marcadores, conferência
  contra as consultas registradas e bloqueio de frases proibidas.
- Máquina de estados da conversa, com o catálogo de ferramentas limitado por estado.
- Pipeline entre a resposta do modelo e o envio, com repetição e escalonamento após duas falhas.
- Configuração por loja validada por esquema, com arquivo de exemplo comentado.
- Bateria de conversas de referência com executor, cobrindo erros observados no bot anterior,
  regras de operação e tentativas adversariais.
- Modelo de dados completo em Prisma.
- Documentação de arquitetura, homologação, roadmap, segurança e LGPD.
