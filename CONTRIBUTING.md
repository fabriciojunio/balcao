# Como contribuir

## Antes de abrir PR

```bash
make verify
```

Roda tipos, lint, testes com gate de cobertura e validação das configurações. O CI roda o mesmo,
então o que passa aqui passa lá.

## Commits

Conventional Commits, mensagem em português, imperativo, minúscula no início do assunto.

```
feat(preco): aplica concessão por rodada na contraproposta
fix(auditor): reconhece valor colado ao símbolo do real
test(troca): cobre recusa por conta bloqueada
docs: registra a decisão de manter a faixa abaixo do valor apurado
refactor(conversa): extrai a tabela de transições
chore(deps): atualiza o zod
```

Escopos em uso: `preco`, `troca`, `proposta`, `conversa`, `auditor`, `tenant`, `pipeline`,
`ferramentas`, `evals`, `db`, `ci`.

Um commit resolve uma coisa. Se o assunto precisa de "e", provavelmente são dois commits.

## Regras de código que não se negociam

**Dinheiro é inteiro.** Todo valor monetário trafega em centavos, do domínio ao banco. Nenhum
`number` decimal representando reais atravessa fronteira de módulo. Use `lib/dinheiro.ts`.

**Domínio não conhece o mundo.** `dominio/preco.ts` e `dominio/troca.ts` não importam banco, HTTP,
nem cliente de modelo. São funções puras, e é por isso que a cobertura delas fica acima de 90%.

**Nada de `if` por cliente.** O que muda de loja para loja é configuração validada por esquema. Se
apareceu a vontade de escrever o nome de um cliente no código, o lugar certo é
`lib/tenant/schema.ts`.

**O modelo não escreve número.** Se um caminho novo permite que texto gerado chegue ao envio sem
passar por `lib/pipeline.ts`, esse caminho está errado.

**Recusa é resultado, não exceção.** Funções de domínio que podem negar devolvem `Result`. Exceção
fica para o que é bug de programação.

## Mexeu em regra de negócio?

Adicione o caso em `evals/casos.ts` antes de mudar o código. A bateria é o que impede que uma
mudança de política, de prompt ou de versão de modelo quebre algo em silêncio, e cada erro real
observado em produção deve virar um caso ali com origem `bot_antigo` ou `operacao`.

## Testes

- Teste comportamento, não implementação.
- Nome do teste descreve a regra da loja, não o nome da função.
- Caso adversarial é bem-vindo: tentativa deliberada de furar o auditor vale mais que teste feliz.
