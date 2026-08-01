# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).
Versionamento semântico.

## [Não lançado]

### Adicionado (rodada de pesquisa de mercado)

- Áudio, foto e arquivo do cliente deixam de ser descartados. Áudio é
  transcrito e segue como texto; sem transcritor, a conversa vai para um
  vendedor. No Brasil, de 40% a 55% das mensagens para empresa são áudio.
- Foto do aparelho entra como pré-avaliação, com a regra de que só pode
  confirmar ou piorar o estado declarado, nunca melhorar. O agente nunca pede
  foto; só aceita a que o cliente mandar.
- Envio de imagem pelo canal: a foto do produto acompanha a proposta, com a
  legenda passando pelo mesmo auditor da mensagem.
- Toda mensagem com valor de troca é obrigada a dizer que é pré-avaliação.
- Bloqueio de escassez e prazo sem comprovação: "última unidade" só sai quando
  o estoque tem uma unidade.
- Triagem determinística antes do modelo para pedido de atendente, sinal de
  irritação e pedido de saída.
- `docs/pesquisa.md` com os achados de mercado e de legislação que motivaram
  cada uma dessas mudanças.

### Adicionado (sistema completo)

- Orquestrador da conversa: deduplicação de reenvio da Meta, aviso de atendimento automatizado,
  ciclo de chamadas de ferramenta, contagem de rodadas e escalonamento para humano.
- Execução das onze ferramentas do catálogo sobre os repositórios, com o retorno anunciando os
  marcadores que o modelo pode usar.
- Camada de modelo com versão travada por identificador exato: Ollama, compatível com OpenAI,
  simulador determinístico e contingência automática quando o principal cai.
- Canal WhatsApp Cloud API: envio, verificação do webhook e conferência da assinatura em toda
  requisição recebida.
- Persistência em PostgreSQL com o tenant aplicado na consulta e reserva de produto transacional.
- Servidor HTTP com cabeçalhos de segurança e painel da loja: fila de atendimento, assumir e
  devolver conversa, aprovar proposta, trilha de auditoria, botão de desligar e simulador de
  conversa.
- Sessão do painel com cookie assinado e senha com scrypt, sem dependência externa.
- Tradução da resposta livre do cliente na opção do checklist de avaliação, no domínio.
- Carga inicial do banco e conversa de demonstração de ponta a ponta rodando no CI.

### Adicionado (núcleo)

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
