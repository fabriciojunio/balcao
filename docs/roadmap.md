# O que falta

## Pronto

- Valores em centavos inteiros, com formatação e leitura em português
- Motor de preço: margem mínima, teto por categoria, concessão por rodada, parcelamento com taxa
  real, validação da política
- Motor de avaliação de usado: estados, redutores, recusa automática, limite de queda, checklist
  guiado, tradução da resposta livre do cliente em opção do checklist
- Proposta de troca com conferência de margem do conjunto
- Auditor de saída: extração de valores, resolução de marcadores, conferência, frases proibidas
- Máquina de estados da conversa e catálogo fechado de ferramentas
- Pipeline entre modelo e envio, com repetição e escalonamento
- Execução das onze ferramentas sobre os repositórios
- Orquestrador: dedupe, aviso de conformidade, ciclo de ferramentas, escalonamento
- Camada de modelo: Ollama, compatível com OpenAI, simulador determinístico e contingência
  automática, com versão travada por identificador exato
- Canal WhatsApp Cloud API: envio, verificação do webhook e conferência de assinatura
- Persistência em PostgreSQL com tenant aplicado na consulta e reserva transacional
- Servidor HTTP com cabeçalhos de segurança
- Painel: fila, assumir e devolver conversa, aprovar proposta, trilha de auditoria, botão de
  desligar, simulador de conversa
- Configuração por loja validada por esquema
- Bateria de conversas de referência com executor
- Carga inicial do banco e conversa de demonstração no CI

- Triagem determinística antes do modelo: pedido de atendente, sinal de irritação
  e pedido de saída, conforme o Decreto 11.034/2022
- Áudio transcrito, foto lida como pré-avaliação e envio de imagem do produto
- Pré-avaliação obrigatória em toda mensagem com valor de troca
- Bloqueio de escassez e prazo sem comprovação da ferramenta

## Próximo

**0. Métricas de operação**
Taxa de contenção, resolução, tempo até o vendedor assumir (o Decreto fala em
60 segundos), bloqueios do auditor e propostas emitidas. As referências de
mercado estão em `docs/pesquisa.md`. É o que falta para o dono medir sem
depender do nosso relato.


**1. Conectores de estoque**
Um adaptador por sistema, mesma interface. Começa pelo ERP da primeira loja, descoberto na fase 0.
Enquanto não existir, o painel é a fonte de verdade do estoque de vitrine.

**2. Fila e agrupamento de mensagem picotada**
Hoje cada mensagem é atendida na hora. Falta a espera de poucos segundos para juntar mensagem
quebrada em três partes, e a fila com repetição em caso de falha de envio.

**3. Edição da política e da tabela de troca pelo painel**
O modelo de dados já versiona; falta a tela. Enquanto isso, os valores vêm do arquivo da loja.

**4. Observabilidade**
Métricas de escalonamento, bloqueio do auditor e tempo de resposta, com alerta no celular de quem
está de plantão.

**5. Retomada de lead**
Templates aprovados na Meta, respeito ao consentimento e limite de duas retomadas.

**6. Expurgo automático**
Rotina de retenção conforme `conformidade.retencao_conversas_dias` e anonimização a pedido.

## Depois

- Migração do modelo para servidor na loja, com contingência em nuvem
- Segunda loja, para provar que o custo de implantação cai
- Calibragem da tabela de troca comparando o valor conferido na loja com o cotado na conversa
