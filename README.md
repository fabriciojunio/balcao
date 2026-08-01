# Balcão

Atendimento, negociação e avaliação de aparelhos usados no WhatsApp para lojas de celular.

A diferença para os chatbots de prateleira está em uma decisão de arquitetura: **o modelo de
linguagem não escreve números**. Ele entende o cliente, escolhe a estratégia da conversa e chama
funções; quem calcula preço à vista, parcelamento, desconto máximo e valor de troca é código
determinístico, testado e versionado. A mensagem final ainda passa por um auditor que confere cada
algarismo antes do envio.

Isso resolve o problema que motivou o projeto: bots montados sobre prompt gigante começam a
inventar valor de aparelho toda vez que o fornecedor atualiza o modelo por baixo. Aqui, valor
inventado não chega ao cliente, porque não existe caminho no código em que ele chegue.

## Ver funcionando em 30 segundos

```bash
npm ci
npm run demo
```

Roda uma conversa completa (consulta de estoque, parcelamento, negociação em rodadas, checklist do
usado, cotação e proposta de troca) sem banco, sem GPU e sem WhatsApp.

## Situação

| Módulo | Situação |
| --- | --- |
| Motor de preço (margem, desconto em rodadas, parcelamento) | pronto |
| Motor de avaliação de usado (redutores, recusas, checklist) | pronto |
| Auditor de saída e resolução de marcadores | pronto |
| Máquina de estados e catálogo de ferramentas | pronto |
| Ferramentas ligadas aos repositórios | pronto |
| Orquestrador da conversa | pronto |
| Camada de modelo (Ollama, compatível com OpenAI, simulador, contingência) | pronto |
| Canal WhatsApp Cloud API com conferência de assinatura | pronto |
| Persistência em PostgreSQL | pronto |
| Painel: fila, assumir conversa, aprovar proposta, auditoria, botão de desligar | pronto |
| Configuração por loja validada por esquema | pronto |
| Bateria de conversas de referência | pronto |
| Áudio transcrito, foto como pré-avaliação, envio de imagem | pronto |
| Triagem de pedido de humano e pedido de saída, antes do modelo | pronto |
| Métricas de operação | falta (ver [docs/roadmap.md](docs/roadmap.md)) |
| Conectores de estoque por ERP | falta (ver [docs/roadmap.md](docs/roadmap.md)) |

`298 testes de unidade` mais `31 de integração` contra PostgreSQL de verdade.
Cobertura acima de 88% no conjunto e acima de 95% no domínio.

```bash
make verify                                    # tipos, lint, cobertura, configuração
DATABASE_URL=... npm run test:integration      # precisa do banco de pé
```

## Subir local

```bash
cp .env.example .env       # preencha SESSION_SECRET e DATABASE_URL
make db-up                 # PostgreSQL em container
npm run db:push
npm run db:seed            # cria a loja, o usuário do painel e um estoque de exemplo
npm run dev
```

- Painel: `http://localhost:3000/painel`
- Simulador de conversa: `http://localhost:3000/simulador`
- Saúde: `http://localhost:3000/saude`
- Webhook da Meta: `POST /api/whatsapp`

Verificação completa antes de abrir PR:

```bash
make verify                # tipos + lint + cobertura + configuração
```

## Como funciona uma resposta

```
mensagem do cliente
  -> webhook confere a assinatura da Meta e descarta reenvio
  -> máquina de estados decide quais ferramentas o modelo enxerga
  -> modelo devolve objeto fechado, com {{marcadores}} no lugar dos números
  -> ferramentas de domínio calculam os valores reais
  -> sistema substitui os marcadores
  -> auditor confere todo número contra as consultas registradas
  -> envio, ou nova tentativa, ou passagem para um vendedor
```

Duas falhas do auditor na mesma conversa encerram a atuação do agente e chamam gente. Não existe
terceira tentativa.

## Estrutura

```
lib/
  dinheiro.ts            valores em centavos inteiros, formatação e leitura em pt-BR
  result.ts              Result explícito no lugar de exceção
  portas.ts              interfaces de tudo que é externo ao domínio
  dominio/preco.ts       margem, piso, concessão por rodada, parcelamento   (função pura)
  dominio/troca.ts       avaliação de usado, redutores, recusas, checklist  (função pura)
  dominio/proposta.ts    junta produto e cotação, confere margem do conjunto
  dominio/conversa.ts    estados, transições e ferramentas visíveis
  auditor/               extração de números, marcadores, conferência final
  ferramentas/           contrato fechado e execução sobre os repositórios
  modelo/                prompt versionado, Ollama, compatível com OpenAI, simulador
  adaptadores/           memória (teste), Prisma (produção), WhatsApp
  tenant/                esquema e carregamento da configuração de cada loja
  pipeline.ts            o caminho completo entre o modelo e o WhatsApp
  orquestrador.ts        junta tudo e conduz a conversa
app/                     servidor HTTP, webhook, painel e simulador
evals/                   bateria de conversas de referência e executor
config/tenants/          configuração por loja (só o exemplo vai para o repositório)
prisma/                  modelo de dados e carga inicial
```

`dominio/preco.ts` e `dominio/troca.ts` não importam nada de fora: sem banco, sem HTTP, sem IA. Se
algum dia alguém precisar chamar o modelo de dentro deles para "decidir melhor", o projeto voltou
ao problema original.

## Um cliente novo

Não se toca no código. Copia-se `config/tenants/loja-exemplo.yml`, ajustam-se os valores e roda-se
`npm run config:validar`. Estão na configuração: tom de voz, piso de margem, teto de desconto por
categoria, concessão por rodada, taxas reais de cada parcelamento, tabela de troca com redutores
por defeito, condições de recusa, alçadas, conector de estoque e textos legais.

Configuração inválida derruba a subida daquela loja e não encosta nas outras.

## Modelo de linguagem

Em produção, `modelo.primario` aponta para um runtime local (Ollama ou compatível com OpenAI) com
**versão exata**, nunca apelido genérico. `modelo.contingencia` assume sozinho se o principal cair.

Como toda decisão de negócio saiu da IA, não é preciso um modelo grande: 14B a 32B resolvem, e é
isso que torna o servidor dentro da loja viável.

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md) — as camadas e por que elas existem
- [docs/pesquisa.md](docs/pesquisa.md) — o que a pesquisa de mercado e a lei mudaram no sistema
- [docs/homologacao.md](docs/homologacao.md) — como colocar em homologação
- [docs/roadmap.md](docs/roadmap.md) — o que falta, em ordem
- [CONTRIBUTING.md](CONTRIBUTING.md) — convenções de commit e de código
- [SECURITY.md](SECURITY.md) — modelo de ameaças e como reportar falha
- [LGPD.md](LGPD.md) — dados pessoais, base legal, retenção e direitos do titular

## Licença

Software proprietário. Uso mediante licença.
