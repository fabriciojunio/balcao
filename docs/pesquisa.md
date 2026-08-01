# O que a pesquisa mudou no sistema

Levantamento de quem já opera esse tipo de atendimento, no Brasil e fora, e do
que a lei brasileira exige. Cada achado abaixo virou código ou virou item de
roadmap. As fontes estão no fim.

## 1. Metade do que o cliente manda é áudio

No Brasil, entre 40% e 55% das mensagens que chegam a uma empresa pelo WhatsApp
são áudio. O sistema descartava tudo que não fosse texto: na prática, metade
dos clientes falaria sozinha.

**O que foi feito.** Áudio, foto e outros arquivos agora são reconhecidos.
Áudio passa por transcrição e segue como se fosse texto. Sem transcritor
configurado, a conversa vai para um vendedor com um aviso claro, em vez de
sumir. Ver `lib/adaptadores/whatsapp.ts` e `resolverMidia` no orquestrador.

## 2. A oferta da IA vincula a loja

Uma concessionária BMW em Toronto teve que honrar uma proposta de troca feita
pelo chatbot, cerca de R$ 26 mil acima do que pretendia pagar, e só recuou
depois que o caso chegou à imprensa. A Air Canada tentou argumentar que o
chatbot era "uma entidade separada" e foi condenada. No Brasil o artigo 30 do
CDC diz que a oferta suficientemente precisa vincula o fornecedor, com a
exceção estreita do erro grosseiro.

**O que foi feito.** Toda mensagem que cita valor de troca é obrigada a conter
a palavra **pré-avaliação**; sem ela o auditor bloqueia o envio. O texto da
ressalva fica na configuração da loja (`troca.texto_ressalva`) e o auditor
confere o termo (`troca.termo_ressalva`). Ver `ressalva_ausente` em
`lib/auditor/index.ts`.

## 3. Urgência inventada é publicidade enganosa

O artigo 37 do CDC proíbe publicidade enganosa, e a simulação de urgência
artificial (contador falso, estoque fictício, promoção que se renova sozinha)
entra nessa proibição.

**O que foi feito.** O auditor bloqueia "última unidade", "só hoje", "frete
grátis" e variações, a menos que uma ferramenta tenha comprovado. `consultar_estoque`
e `detalhar_produto` só liberam "última unidade" quando a quantidade em estoque
é realmente um.

## 4. Falar com gente é direito, não é cortesia

O Decreto 11.034/2022 garante atendimento humano sempre que o consumidor pedir,
inclusive em canal automatizado, e proíbe que o bot impeça o contato direto.

**O que foi feito.** `lib/dominio/triagem.ts` roda antes do modelo, sobre a
mensagem crua. Pedido de atendente, sinal de irritação e pedido de saída são
resolvidos ali, sem depender de o modelo entender. Pedido de saída encerra a
conversa, registra a revogação do consentimento e para de responder.

## 5. Foto ajuda, mas não decide

A avaliação visual automática existe em produção e funciona: robôs de grading
como o da Phonecheck processam até 55 aparelhos por hora e sistemas de visão
chegam a mais de 90% de acerto na detecção de trinca. Só que isso é com
iluminação controlada e múltiplos ângulos. A foto que o cliente tira no sofá
não tem nada disso.

**O que foi feito.** A foto entra como pré-avaliação, e vale uma regra só:
**a foto pode confirmar ou piorar o estado, nunca melhorar**. Se o modelo de
visão alucinar uma trinca, a conferência física corrige para cima; se deixar de
ver um defeito, o que o cliente declarou continua valendo. O caminho em que a
loja paga demais não existe. Toda foto que acusa algo novo, ou que não deu para
ler, manda a proposta para aprovação humana. Ver `lib/dominio/visao.ts`.

O agente **nunca pede foto**. Se o cliente mandar por conta própria, ela entra;
o checklist sozinho já fecha a cotação.

## 6. Velocidade é o que converte

Resposta em até 5 minutos multiplica por 10 a chance de conversão, e o ideal na
primeira interação é abaixo de 2 minutos. Quem cai de 30 para 2 minutos ganha
até 75% de conversão.

**Situação.** O agente responde em segundos, então o ponto está coberto. O que
falta é medir: taxa de contenção, tempo até o vendedor assumir e bloqueios do
auditor. Está no roadmap.

## 7. Referência de contenção

Agentes que só respondem ficam entre 40% e 60% de contenção; agentes que
executam ações (consultar pedido, reservar, cotar) ficam entre 55% e 75%.
Resolução real, que é diferente de contenção, fica entre 50% e 70% em operação
madura. Vale medir as duas coisas: contenção alta com resolução baixa é cliente
insatisfeito que desistiu.

## 8. Cadência de retomada

Carrinho abandonado recuperado por WhatsApp fica entre 15% e 20%, e chega a 35%
quando a primeira mensagem sai entre 15 e 60 minutos. A recomendação é de três
mensagens em cinco dias; mais que isso raramente converte e aumenta denúncia de
spam. Para lead frio, uma a duas mensagens por semana no máximo, com pelo menos
um mês entre tentativas de reativação.

**Situação.** O limite de duas retomadas já está na política do produto; a
execução entra junto com os templates aprovados na Meta.

## Fontes

- [SocialHub — transcrição de áudio no atendimento](https://www.socialhub.pro/blog/chatbot-ia-audio-whatsapp-transcricao-2026/)
- [AutoPapo — concessionária obrigada a honrar negócio fechado pela IA](https://autopapo.com.br/curta/concessionaria-usa-ia-para-negociar-com-clientes-e-e-obrigada-a-honrar-mau-negocio-fechado-pela-inteligencia-artificial/)
- [ConJur — Air Canada perde disputa por trapalhada de chatbot](https://www.conjur.com.br/2024-fev-21/air-canada-perde-disputa-na-justica-por-trapalhada-de-chatbot/)
- [Legale — erro grosseiro e o limite da oferta vinculante](https://legale.com.br/blog/erro-grosseiro-o-limite-da-oferta-vinculante-no-consumidor/)
- [TJDFT — publicidade enganosa ou abusiva](https://www.tjdft.jus.br/consultas/jurisprudencia/jurisprudencia-em-temas/cdc-na-visao-do-tjdft-1/praticas-abusivas/publicidade-enganosa-ou-abusiva)
- [Projuris — Lei do SAC e o Decreto 11.034/2022](https://www.projuris.com.br/blog/lei-do-sac/)
- [Resource Recycling — robô de grading que processa 55 aparelhos por hora](https://resource-recycling.com/e-scrap/2022/12/07/ai-robot-grades-erases-up-to-55-phones-an-hour/)
- [Seasia — detecção de dano em tela por visão computacional](https://www.seasiainfotech.com/screen-damage-detection)
- [Likewize — cotação com contraproposta após conferência](https://tradein.likewize.com/)
- [Gazelle — como o valor de troca é determinado](https://www.gazelle.com/thehorn/2018/01/19/gazelle-grading-devices-trade-value-determined/)
- [E-Commerce Brasil — tempo de resposta e conversão](https://www.ecommercebrasil.com.br/artigos/tempo-de-resposta-no-whatsapp-o-indicador-que-define-conversao-antes-da-venda)
- [Bookbag — referências de contenção em e-commerce](https://bookbag.ai/blog/chatbot-containment-rate-benchmarks)
- [Lorikeet — resolução real x contenção](https://www.lorikeetcx.ai/articles/resolution-rate-ai-customer-support-benchmarks-2026)
- [SocialHub — cadência de recuperação e lead frio](https://www.socialhub.pro/blog/recuperar-lead-frio-whatsapp-2026-estrategias-mensagens/)
- [Uptail — o que bloqueia número no WhatsApp Business](https://www.uptail.ai/blog/whatsapp-business-messaging-rules-2026-what-actually-gets-you-blocked-(and-what-gets-results))
