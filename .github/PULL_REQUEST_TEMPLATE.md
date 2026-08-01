## O que muda

<!-- Uma frase. Se precisar de parágrafo, provavelmente são dois PRs. -->

## Por quê

<!-- O problema que isto resolve, do ponto de vista da loja. -->

## Checklist

- [ ] `make verify` passou local (tipos, lint, testes, cobertura, configuração)
- [ ] Toquei em preço, desconto ou avaliação de usado? Então adicionei caso em `evals/casos.ts`
- [ ] Nenhum valor monetário novo trafega como decimal (tudo em centavos inteiros)
- [ ] Nenhum `if` por nome de cliente: o que muda por loja virou configuração
- [ ] Se mudei a versão do modelo ou o prompt, a bateria de regressão continua verde
- [ ] Dado pessoal novo? Então atualizei `LGPD.md`

## Como testar
