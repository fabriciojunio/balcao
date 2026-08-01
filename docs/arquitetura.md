# Arquitetura

## O problema

Um agente de vendas que conversa bem e erra o preço é pior do que nenhum agente: o vendedor humano
tem que desdizer a oferta na frente do cliente. O erro do bot anterior da loja não era falta de
capacidade do modelo, era o preço nascer dentro do texto gerado. Modelo de linguagem produz a
próxima palavra mais provável, e um número no meio de uma frase é só mais uma palavra provável.

Somava-se a isso: versão do modelo apontada por apelido genérico (o fornecedor troca o motor por
baixo e o comportamento muda sem aviso), ausência de bateria de regressão e catálogo colado dentro
do prompt, que envelhece em horas.

## A inversão

A IA perde o direito de escrever números. Ela entende a intenção, escolhe a estratégia da conversa
e chama funções. Quem calcula é código determinístico.

Efeito colateral relevante para custo: como nenhuma decisão de negócio depende do modelo, não é
preciso um modelo gigante. Um modelo aberto de 14B a 32B resolve, e cabe num Mac mini de 64 GB.

## Camadas

```
canal          API oficial da Meta, webhook com assinatura conferida
recepção       fila, deduplicação, agrupamento de mensagem picotada, limite de vazão
orquestrador   máquina de estados, memória da conversa, seleção de ferramentas
modelo         runtime local com versão travada, contingência em nuvem
ferramentas    motor de preço, motor de troca, estoque, parcelamento, reserva, lead
auditor        conferência de todo número, filtro de frase proibida
dados          PostgreSQL, trilha de auditoria, backup diário fora do servidor
painel         assumir conversa, aprovar proposta, editar política, botão de desligar
```

Cada camada tem uma responsabilidade e pode ser trocada sem reescrever as outras. É isso que
permite começar em nuvem e migrar o modelo para dentro da loja depois, sem refazer o projeto.

## As cinco travas entre a IA e o preço

Para um valor errado chegar ao cliente, as cinco precisam falhar ao mesmo tempo.

1. **A IA só recebe valores por função.** Ela não vê tabela de preço. Chama `consultar_estoque`,
   `cotar_usado`, `simular_parcelamento`, `avaliar_desconto` e recebe objeto com números prontos.
   O catálogo é fechado: `lib/ferramentas/catalogo.ts`.

2. **Resposta em formato fechado.** O modelo devolve um objeto com marcadores no lugar dos números
   (`{{preco_avista}}`). O sistema substitui pelos valores da consulta. O texto final nunca passa
   por onde a IA poderia digitar um algarismo. Ver `lib/auditor/marcadores.ts`.

3. **Auditor de saída.** Antes do envio, um validador extrai todo valor monetário, percentual e
   prazo. Número que não corresponde a uma consulta registrada bloqueia o envio.
   Ver `lib/auditor/index.ts`.

4. **Política no código.** Margem mínima, teto de desconto por categoria, concessão em rodadas e
   itens que não descontam ficam em política versionada, editável pelo dono. A IA pergunta "posso
   oferecer X?" e recebe sim ou não. Ver `lib/dominio/preco.ts`.

5. **Alçada e passagem para humano.** Acima de um limite configurável, ou em troca de valor alto, a
   proposta vai para aprovação antes de ser enviada. Cliente irritado, pedido fora de escopo ou
   duas falhas seguidas do auditor também acionam a passagem.

Rede de segurança: um interruptor no painel devolve todas as conversas ao atendimento humano em
segundos, sem deploy.

## Decisões registradas

**Dinheiro em centavos inteiros.** Elimina a classe inteira de erro de arredondamento que faz uma
proposta fechar um centavo abaixo da margem. `lib/dinheiro.ts` formata e interpreta valores em
português sem depender de ICU, para o resultado ser idêntico em qualquer servidor.

**A faixa da cotação nunca sobe acima do valor apurado.** `faixaMax === valor`. Prometer acima da
tabela é o erro que a conferência física teria que desdizer na frente do cliente.

**Item fora da tabela não vira chute.** Estado ou defeito desconhecido marca `exigeAvaliacaoHumana`
e mantém o ajuste conservador, em vez de inventar redutor.

**Taxa de parcelamento ausente é recusa, não estimativa.** `simularParcelamento` devolve erro
quando o número de parcelas não está na tabela da loja.

**Concessão por rodada não é o mesmo que teto.** O teto da categoria é limite; a rodada é oferta.
O piso final é o maior entre mínimo por margem e mínimo por teto, arredondado para cima.

**Evento sem sentido no estado atual é ignorado, não é erro.** A conversa fica onde está e o log
registra. Cliente não tem obrigação de seguir o fluxo.

## Multi-loja

Regra que decide tudo: se uma loja diferente precisaria de outro valor, é configuração; se toda
loja de celular precisa igual, é núcleo. Nunca `if (cliente === "X")` no código.

O que é configuração está em `lib/tenant/schema.ts` e o exemplo comentado em
`config/tenants/loja-exemplo.yml`. Implantar loja nova é preencher o arquivo, carregar a tabela de
troca, conectar o estoque e rodar a bateria com os dados dela.

## Integração com estoque

Item de maior risco de cronograma e o único que depende de terceiros. Em ordem de preferência:

1. O sistema da loja tem API: integração direta, estoque sempre real.
2. Tem exportação de arquivo: importação agendada, com aviso quando o arquivo envelhece.
3. Não tem nada: o painel vira a fonte de verdade do estoque de vitrine.

Em qualquer caso, `estoque.idade_maxima_dado_segundos` bloqueia oferta com dado velho.
