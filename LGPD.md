# Dados pessoais e LGPD

Este documento descreve o que o Balcão coleta, com qual base legal, por quanto tempo guarda e como
atende os direitos do titular. Ele é parte do sistema, não anexo de marketing: quando um dado novo
passa a ser tratado, este arquivo muda no mesmo PR.

## Papéis

- **Controladora**: a loja que contrata o sistema. É ela quem decide as finalidades.
- **Operadora**: a empresa de desenvolvimento, que trata os dados em nome da loja.

O contrato entre as partes precisa registrar isso por escrito.

## Dados tratados

| Dado | Origem | Finalidade | Base legal |
| --- | --- | --- | --- |
| Telefone | WhatsApp | Identificar o cliente e responder | Execução de contrato / procedimentos preliminares |
| Nome | Informado na conversa | Tratamento pessoal no atendimento | Execução de contrato |
| Conteúdo das mensagens | Conversa | Atender, negociar e comprovar o que foi oferecido | Legítimo interesse |
| Interesse de compra | Conversa | Retomada comercial | Consentimento |
| Descrição do aparelho usado | Checklist | Avaliar a troca | Execução de contrato |
| Propostas emitidas | Sistema | Prova do que foi oferecido e auditoria | Cumprimento de obrigação e legítimo interesse |

Nenhum dado sensível é solicitado. Se o cliente enviar espontaneamente documento, foto de nota ou
qualquer outro dado além do necessário, ele entra na retenção normal e é descartado no mesmo prazo.

## Transparência

A primeira mensagem de cada conversa avisa que o atendimento é automatizado e oferece caminho para
falar com um vendedor. O texto fica em `conformidade.aviso_inicial`, na configuração da loja, e o
endereço da política de privacidade em `conformidade.url_privacidade`.

## Consentimento para contato ativo

Responder a quem escreveu não exige consentimento. **Iniciar** conversa (retomada de lead frio,
campanha) exige consentimento livre, informado e inequívoco, registrado em `contatos.aceitaContato`
com a data em `contatos.consentimentoEm`. A saída é sempre oferecida e, uma vez pedida, encerra o
contato ativo em definitivo.

Limite operacional: no máximo duas retomadas por lead.

## Retenção

- Conversas e mensagens: `conformidade.retencao_conversas_dias` (padrão 365 dias).
- Propostas e trilha de auditoria: 5 anos, por interesse de defesa em eventual questionamento
  sobre o que foi oferecido.
- Passado o prazo, o expurgo é automático.

## Direitos do titular

| Direito | Como é atendido |
| --- | --- |
| Confirmação e acesso | Exportação das conversas e propostas do titular, pelo painel |
| Correção | Edição do cadastro do contato |
| Eliminação | Anonimização do contato e das mensagens, preservando a proposta sem identificação |
| Portabilidade | Exportação em formato aberto |
| Revogação de consentimento | Baixa imediata do contato ativo |
| Oposição | Encerramento do tratamento por legítimo interesse mediante análise |

Prazo de resposta: 15 dias.

A eliminação é feita por **anonimização**, não por apagamento cego: o registro contábil da proposta
permanece, sem qualquer dado que identifique a pessoa.

## Segurança

- Acesso ao painel por usuário nomeado, com papel e trilha de acesso.
- Dados em repouso cifrados no servidor de banco.
- Log estruturado sem conteúdo de mensagem.
- Backup diário, com restauração testada.

## Incidente

Havendo incidente com risco relevante, a loja é comunicada em até 24 horas para que ela, como
controladora, comunique a ANPD e os titulares no prazo legal. O runbook de incidente fica em
`infra/runbooks`.
