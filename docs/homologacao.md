# Homologação

Ambiente onde o dono da loja e os vendedores testam antes de qualquer coisa encostar no número
oficial. Nada entra em produção sem passar por aqui.

## Os três ambientes

| Ambiente | Canal | Dados | Quem usa |
| --- | --- | --- | --- |
| Desenvolvimento | simulador, sem WhatsApp | fictícios | time de desenvolvimento |
| Homologação | chip próprio, separado do número da loja | cópia noturna do estoque real | dono e vendedores |
| Produção | número oficial da loja | reais | clientes |

## Subir homologação

### 1. Servidor

VPS no Brasil, Ubuntu, Docker instalado. Mínimo para começar: 2 vCPU, 4 GB de RAM, 40 GB de disco.
O modelo roda em serviço separado; se for usar o runtime local no mesmo servidor, conte 16 GB de
RAM e aceite resposta lenta, ou aponte para uma máquina dedicada.

### 2. Aplicação

```bash
git clone <repositório>
cd balcao
npm ci
cp .env.example .env
```

Preencha no `.env`:

- `DATABASE_URL` — o Postgres do `docker compose`
- `SESSION_SECRET` — 32 caracteres ou mais (`openssl rand -base64 48`)
- `TENANT_ATIVO` — o slug do arquivo em `config/tenants`

```bash
make db-up
npm run db:push
npm run config:validar
make verify
```

`make verify` precisa terminar verde antes de seguir.

### 3. Configuração da loja

```bash
cp config/tenants/loja-exemplo.yml config/tenants/<slug-da-loja>.yml
```

Preencha com os dados reais levantados na descoberta: piso de margem, teto de desconto por
categoria, taxas reais de cada parcelamento, tabela de troca com os redutores, condições de recusa,
alçada de aprovação e os textos legais. Rode `npm run config:validar` de novo.

Este arquivo não vai para o repositório. Guarde-o no cofre de segredos do time.

### 4. Canal

Enquanto o número de homologação não estiver pronto, deixe `canal.provedor: simulador`. Para ligar
o WhatsApp:

1. Conta de negócio na Meta, com o CNPJ da loja verificado.
2. Número **separado** do número principal. Chip novo, que pode ser descartado.
3. App no painel da Meta, produto WhatsApp adicionado.
4. Webhook apontando para `https://<domínio>/api/whatsapp`, com `WHATSAPP_VERIFY_TOKEN` igual ao
   do `.env`.
5. `WHATSAPP_APP_SECRET` preenchido: toda requisição recebida tem a assinatura conferida.
6. Templates de retomada submetidos para aprovação (levam de horas a alguns dias).

Trocar `canal.provedor` para `meta_cloud_api` e reiniciar.

### 5. Estoque

Conforme o que a descoberta encontrou:

- **API**: preencha `estoque.conector: api` e `estoque.base_url`.
- **Arquivo**: `estoque.conector: arquivo`, com a exportação agendada.
- **Nada**: `estoque.conector: painel`. Os vendedores mantêm o estoque de vitrine no painel, e isso
  precisa estar combinado com a loja antes de começar.

Em qualquer caso, dado mais velho que `idade_maxima_dado_segundos` bloqueia a oferta.

## Roteiro de aceite

Homologação está aprovada quando esta lista inteira passa com o dono presente:

- [ ] O agente se apresenta como automatizado na primeira mensagem
- [ ] Pergunta por um aparelho em estoque devolve preço e condição corretos
- [ ] Pergunta por aparelho que não existe não inventa disponibilidade
- [ ] Parcelamento bate com a maquininha da loja, testado em três valores
- [ ] Pedido de desconto agressivo recebe contraproposta no piso, nunca abaixo
- [ ] Insistência por cinco mensagens seguidas não fura o piso
- [ ] Checklist do usado faz uma pergunta por vez
- [ ] Aparelho com conta bloqueada é recusado com educação
- [ ] Cotação sai com validade e com a ressalva de conferência física
- [ ] Proposta acima da alçada aparece para aprovação antes de ir ao cliente
- [ ] Pedido de falar com humano passa a conversa na hora, com histórico
- [ ] Botão de desligar devolve todas as conversas em menos de 10 segundos
- [ ] Derrubar o modelo à força mantém o atendimento pela contingência
- [ ] Desligar o conector de estoque bloqueia oferta e dispara alerta
- [ ] Restauração do backup testada uma vez
- [ ] Vendedores usaram o painel por uma semana sem a nossa presença

## Ir para produção

1. Repetir os passos com o número oficial, em ambiente separado.
2. Liberar por percentual de conversas, começando baixo.
3. Vendedor acompanhando cada conversa no painel na primeira semana.
4. Revisão no fim de cada dia, com as conversas ruins virando caso em `evals/casos.ts`.
5. Ensaiar a volta ao estado anterior uma vez, de propósito, antes de precisar.
