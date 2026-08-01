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

## Estado atual

O núcleo de domínio está pronto e coberto por testes. O que ainda não existe está listado em
[docs/roadmap.md](docs/roadmap.md).

| Módulo | Situação |
| --- | --- |
| Motor de preço (margem, desconto em rodadas, parcelamento) | pronto |
| Motor de avaliação de usado (redutores, recusas, checklist) | pronto |
| Auditor de saída e resolução de marcadores | pronto |
| Máquina de estados da conversa e catálogo de ferramentas | pronto |
| Configuração por loja validada por esquema | pronto |
| Bateria de conversas de referência | pronto |
| Modelo de dados (Prisma) | pronto |
| Canal WhatsApp, orquestrador e painel | em construção |

## Como rodar

```bash
npm ci
npm test              # 172 testes, incluindo a bateria de regressão
make verify           # tipos + lint + cobertura + validação de configuração
```

Para subir o banco local:

```bash
make db-up
cp .env.example .env  # preencha DATABASE_URL e SESSION_SECRET
npm run db:push
```

## Como funciona uma resposta

```
mensagem do cliente
  -> fila e agrupamento (junta mensagem picotada)
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
  dominio/preco.ts       margem, piso, concessão por rodada, parcelamento   (função pura)
  dominio/troca.ts       avaliação de usado, redutores, recusas, checklist  (função pura)
  dominio/proposta.ts    junta produto e cotação, confere margem do conjunto
  dominio/conversa.ts    estados, transições e ferramentas visíveis
  auditor/               extração de números, marcadores, conferência final
  ferramentas/catalogo   contrato fechado do que o modelo pode chamar
  tenant/                esquema e carregamento da configuração de cada loja
  pipeline.ts            o caminho completo entre o modelo e o WhatsApp
evals/                   bateria de conversas de referência e executor
config/tenants/          configuração por loja (só o exemplo vai para o repositório)
prisma/                  modelo de dados
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

## Documentação

- [docs/arquitetura.md](docs/arquitetura.md) — as camadas e por que elas existem
- [docs/homologacao.md](docs/homologacao.md) — como colocar em homologação
- [docs/roadmap.md](docs/roadmap.md) — o que falta, em ordem
- [CONTRIBUTING.md](CONTRIBUTING.md) — convenções de commit e de código
- [SECURITY.md](SECURITY.md) — modelo de ameaças e como reportar falha
- [LGPD.md](LGPD.md) — dados pessoais, base legal, retenção e direitos do titular

## Licença

Software proprietário. Uso mediante licença.
