# Segurança

## Reportar uma falha

Não abra issue pública. Descreva o problema e o caminho de reprodução por e-mail para o
responsável técnico do projeto. Retorno em até 3 dias úteis.

## O que este sistema protege

O ativo mais sensível não é o código: é o **número de WhatsApp da loja** com o histórico de
clientes, e a **margem** de cada venda. As decisões abaixo saem daí.

### Canal

- API oficial da Meta em produção. Bibliotecas não oficiais que conectam por leitura de QR code
  colocam o número principal do negócio em risco de suspensão e ficam restritas ao ambiente de
  homologação, com chip descartável.
- Todo webhook recebido tem a assinatura conferida contra o segredo do app antes de qualquer
  processamento.
- Mensagem repetida é descartada por identificador externo único, para o mesmo evento não gerar
  duas respostas.

### Preço e margem

- Nenhum valor sai sem origem em consulta registrada. O auditor bloqueia o envio e o incidente
  fica gravado.
- A política de desconto é versionada; alterar não sobrescreve, cria versão nova.
- Toda proposta guarda as versões de política, prompt e modelo que a produziram.
- Existe interruptor de desligamento que devolve todas as conversas ao atendimento humano sem
  depender de deploy.

### Aplicação

- TypeScript estrito e validação com Zod em toda fronteira: webhook, saída do modelo e
  configuração de loja.
- Consultas por ORM com parâmetros; nada de SQL montado por concatenação.
- Segredo só em variável de ambiente. `config/tenants/*.yml` real fica fora do repositório.
- Senha de usuário do painel com hash forte; sessão assinada.
- Log estruturado sem dado pessoal no corpo da mensagem.

### Dependências

- Auditoria de dependências de produção no CI, falhando em severidade alta.
- Dependabot semanal.
- Análise estática de segurança no CI.

## Fora de escopo

- Segurança física do servidor quando o cliente opta por máquina dentro da loja. Nesse arranjo, a
  responsabilidade por acesso físico, energia e rede é do cliente, e a contingência em nuvem é o
  que evita que a operação pare.
