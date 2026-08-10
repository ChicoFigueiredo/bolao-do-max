# Plano — Nova arquitetura do Bolão do Max

Plano completo de reescrita: design, decisões e execução em fases.

| | |
|---|---|
| **Escrito em** | 09/08/2026 |
| **Branch** | `feat/nova-interface` |
| **Spec do sistema atual** | [`docs/spec/bolao-do-max.md`](../spec/bolao-do-max.md) |
| **Design da interface** | [Remodelagem bolão Maxmat](https://claude.ai/design/p/85d1781d-0cdb-41c0-b4ba-a7eb2d445ac9) · brief em [`docs/prompts/claude-design.md`](../prompts/claude-design.md) |
| **Servidor** | `root@ssh.chico-figueiredo.com.br` |

---

## 1. Objetivo

Substituir o Bolão do Max por uma aplicação nova — Bun, Next.js, PostgreSQL, worker dedicado — sem descartar nada do que existe, e com retorno a um comando de distância em qualquer momento.

Três ganhos que a arquitetura atual não consegue entregar:

1. **Histórico durável.** Hoje o resultado só existe no Redis. Nenhuma temporada anterior foi preservada.
2. **Independência de fonte única.** Hoje uma mudança no HTML do ge.globo derruba o cálculo, em silêncio.
3. **Base para o simulador.** Exige a tabela completa de partidas, que hoje não existe em lugar nenhum.

## 2. Decisões já tomadas

| Decisão | Escolha | Consequência |
|---|---|---|
| Formato do planejamento | Documento único cobrindo tudo | Este arquivo |
| Runtime | **Bun em tudo**, Next.js sob Bun | Uma imagem, um runtime. Versão do Next fixada e caminho de retorno para Node documentado (§11.4) |
| Redis compartilhado | Já existe: `cache`, redis:8-alpine | App nunca sobe Redis próprio em produção; chaves sob prefixo |
| PostgreSQL | Já existe: `banco`, pgvector/pg17, **vazio** | Database e role próprios; migrations nunca saem do schema do bolão |
| Estratégia de corte | Paralelo, imagens separadas, dado novo | Domínio provisório `bolao-novo.maxmat1.com.br`; rollback = não fazer nada |
| Histórico | Apostas importadas + tabelas finais como seed | Recálculo com as regras da época. As tabelas finais de **2022–2025** saem das APIs; **2018–2021 não tem fonte gratuita** (§6.5) |
| ORM | **Drizzle** | Nativo de Bun, SQL explícito, sem engine binário — importa numa máquina de 3,8 GB |
| Repositório | Monorepo **dentro da repo atual** | `z_legado/bolao-max-server/` permanece intacto; histórico do git contínuo |

## 3. Ambiente de destino

Levantado por inspeção direta em 09/08/2026.

```
ssh.chico-figueiredo.com.br — Ubuntu 24.04.4 · 2 vCPU · 3,8 GB RAM (2,8 livres) · swap 1 GB · 48 GB livres
Docker 29.7.2 · Compose v5.4.0 · nginx no host (9 vhosts, TLS por certbot)
Convenção da máquina: cada projeto em /opt/<nome>/compose.yml

  banco   pgvector/pgvector:pg17   rede-banco  172.21.0.2   127.0.0.1:5432   ← vazio: só a base postgres, 7 MB
  cache   redis:8-alpine           rede-cache  172.22.0.2   127.0.0.1:6380   ← senha via REDIS_PASSWORD

  bolao.maxmat1.com.br         node/bolao...   rede-maxmat1   127.0.0.1:5001   ← produção atual
  cache.bolao.maxmat1.com.br   redis:7.2       rede-maxmat1   127.0.0.1:6379   ← Redis próprio do atual

  Outros inquilinos: hermes-agent, hermes-webui, aritmetica-instrumental (client + server)
```

Duas restrições que moldam o plano:

- **`banco` e `cache` só escutam em `127.0.0.1`.** O container novo precisa entrar nas redes `rede-banco` e `rede-cache` como redes externas. Não há caminho pela rede pública.
- **2 vCPU e 2,8 GB livres com oito containers no ar.** `next build` não roda no servidor. A imagem é construída fora e enviada pronta (§11.2).

## 4. Arquitetura

### 4.1 A inversão central

```
                    ┌──────────────────────────────────┐
   fontes           │  provedores (porta + adaptadores)│
   GE (JSON) ──────►│  reconciliação + governo de cota │
   API-Football ───►│                                  │
   football-data ──►└────────────────┬─────────────────┘
                                     │
                                     ▼
                        ┌────────────────────────┐
                        │  worker (Bun + cron)   │
                        │  ingere · valida ·     │
                        │  calcula · snapshota   │
                        └────────┬───────────────┘
                                 │
                     ┌───────────▼────────────┐
                     │  PostgreSQL — verdade  │
                     │  partidas · apostas ·  │
                     │  snapshots · regras    │
                     └───────────┬────────────┘
                                 │
                     ┌───────────▼────────────┐
                     │  Redis — cache         │
                     │  derivado, descartável │
                     └───────────┬────────────┘
                                 │
                        ┌────────▼─────────┐
                        │  Next.js (Bun)   │
                        │  lê cache;       │
                        │  falta → Postgres│
                        └──────────────────┘
```

Hoje o Redis **é** o banco. Depois desta mudança, perder o Redis passa a ser um evento sem consequência: a aplicação fica um ciclo mais lenta e se recompõe sozinha.

### 4.2 A classificação passa a ser calculada, não buscada

Com todas as partidas em banco, a tabela do campeonato deixa de ser um dado externo e vira uma projeção dos resultados. Isso resolve três problemas de uma vez:

| Ganho | Como |
|---|---|
| **Independência** | Nenhuma fonte de classificação é indispensável — basta conhecer os resultados |
| **Verificação cruzada** | Tabela calculada × tabela do provedor; divergência vira alarme, não silêncio |
| **Simulador** | Simular é recalcular a tabela com resultados hipotéticos — a mesma função, outra entrada |
| **Economia de cota** | Os horários dizem ao worker quando vale consultar (§6.3) |

A classificação de provedor continua sendo ingerida, mas como **conferência**, não como fonte.

### 4.3 Estrutura do repositório

```
bolao.maxmat1.com.br/
├─ z_legado/bolao-max-server/          ← INTOCADO, continua em produção
├─ apps/
│  ├─ web/                    Next.js App Router, sob Bun
│  └─ worker/                 Bun: cron, ingestão, cálculo, snapshots
├─ packages/
│  ├─ db/                     Drizzle: schema, migrations, seeds
│  ├─ provider/               porta + adaptadores + governo de cota
│  ├─ regras/                 pontuação, desempate, prêmios, tabela — puro
│  ├─ dominio/                tipos compartilhados
│  └─ config/                 env validado com zod, fail-fast
├─ seeds/
│  ├─ apostas/                2018…2026
│  └─ tabelas-finais/         2018…2025
├─ docs/
├─ compose.yml                produção
└─ compose.dev.yml            local: postgres + redis descartáveis
```

`packages/regras` é a peça mais importante: **função pura**, sem I/O, sem banco, sem rede. Recebe partidas e apostas, devolve rankings. É o que permite testar exaustivamente, recalcular o passado e simular o futuro com o mesmo código.

## 5. Modelo de dados

### 5.1 Identidade entre temporadas

Os dados reais mostram o problema: `Chico 'Virus'` em 2024/2025 e `Chico` em 2026 são a mesma pessoa; o elenco de clubes muda todo ano com acesso e rebaixamento; a fonte externa escreve `Athletico-PR` onde a planilha escreve outra coisa.

Por isso `competidor` e `clube` são entidades estáveis com **apelidos por temporada e por fonte**. Casar por string exata, como hoje, é o que zera pontos em silêncio quando a fonte renomeia um clube.

### 5.2 Tabelas

| Tabela | Papel | Notas |
|---|---|---|
| `temporada` | ano, série, bolões vigentes, **regras de prêmio da época** | Permite recalcular 2018 com as regras de 2018 |
| `clube` | identidade estável | |
| `clube_apelido` | nome × temporada × fonte → clube | Resolve renomeação e divergência entre provedores |
| `competidor` | identidade estável | |
| `competidor_apelido` | nome × temporada → competidor | Resolve `Chico` vs `Chico 'Virus'` |
| `aposta_classico` | competidor × temporada × 4 clubes com grupo GP1–GP4 | |
| `aposta_posicao` | competidor × temporada × 8 palpites | Só existe de **2024** em diante |
| `partida` | temporada, rodada, mandante, visitante, início, estádio, status, placar | O centro do modelo (§5.3) |
| `partida_alteracao` | histórico de mudança de horário e status | "sempre pode mudar" — fica registrado |
| `snapshot` | instante, hash da tabela, origem | Só nasce quando algo muda (§6.2) |
| `snapshot_clube` | classificação dos 20 clubes naquele instante | |
| `snapshot_competidor` | pontos e posição de cada competidor, nos dois bolões | Alimenta as sparklines e o indicador de movimentação |
| `fonte` | provedor, credencial, cota, estado | §6.3 |
| `fonte_chamada` | log de consumo por provedor e janela | Governo de free-tier |
| `divergencia` | discordância entre fontes ou entre calculado e informado | Nunca falha em silêncio |

As regras de prêmio moram em `temporada`, não no código. É onde a divergência dos **R$ 650 / R$ 350** (documentada na §10.1 da spec) será corrigida — com o valor certo por ano, sem reescrever história.

### 5.3 `partida` — o centro

```
partida
  id, temporada_id, rodada
  mandante_id, visitante_id
  inicio_previsto        timestamptz   ← pode mudar
  inicio_confirmado      timestamptz
  estadio
  status                 agendada | em_andamento | encerrada | adiada | cancelada
  gols_mandante, gols_visitante
  fonte_id, atualizado_em
```

Toda alteração de `inicio_previsto` ou `status` grava uma linha em `partida_alteracao`. Adiamento no Brasileirão é rotina, e o simulador precisa saber o que era esperado *versus* o que aconteceu.

Com essa tabela completa — passadas e futuras — o simulador futuro é uma chamada a `packages/regras` com placares hipotéticos nas partidas ainda `agendada`.

### 5.4 Volume

Snapshot só quando a tabela muda de verdade (§6.2). Uma tabela de futebol muda algumas vezes por dia, não a cada minuto.

| | Por ano |
|---|---|
| Partidas | 380 |
| Snapshots | ~800 (estimativa: pico nas rodadas) |
| `snapshot_clube` | ~16.000 |
| `snapshot_competidor` | ~48.000 (30 competidores × 2 bolões) |

Irrelevante para Postgres. **Nenhuma política de expurgo é necessária** — o histórico completo cabe indefinidamente.

## 6. Camada de provedores

### 6.1 A porta

```ts
interface ProvedorEsportivo {
  nome: string
  capacidades: Array<'classificacao' | 'partidas' | 'resultados'>
  obterClassificacao?(temporada, serie): Promise<Classificacao>
  obterPartidas?(temporada, serie): Promise<Partida[]>
  custoEstimado(operacao): number      // requisições consumidas
}
```

| Adaptador | Papel | Cota |
|---|---|---|
| `GeGloboProvider` | Alta frequência, custo zero. **Passa a consumir `api.globoesporte.globo.com` (JSON)** em vez de regex sobre HTML | sem cota formal; limite auto-imposto |
| `ApiFootballProvider` | Fonte autoritativa de conferência e fallback; melhor latência ao vivo (15 s) | 100 req/dia · 10 req/min |
| `FootballDataProvider` | Terceira opinião e sincronismo de calendário | 10 req/min, sem teto diário publicado |
| `SeedProvider` | Tabelas finais curadas — alimenta a reconstrução histórica | — |
| `FakeProvider` | Testes, com tabelas e calendários montados à mão | — |

**Toda resposta é validada antes de virar dado**: 20 clubes, nomes resolvíveis via `clube_apelido`, números coerentes, soma de jogos plausível. Lixo é rejeitado com erro explícito. O modo de falha atual — Promise que nunca resolve e timestamp congelado sem aviso — deixa de ser possível.

### 6.2 Reconciliação

Ordem de confiança configurável por tipo de dado. O worker consulta a fonte primária e, quando a cota permite, uma secundária para conferência.

```
1. calcular a tabela a partir das partidas conhecidas   → tabela_calculada
2. obter a tabela do provedor primário                  → tabela_fonte
3. comparar
   ├─ iguais       → grava snapshot, segue
   └─ divergem     → grava em `divergencia`, consulta uma terceira fonte,
                     adota a maioria e alarma
4. hash(tabela adotada) == hash do último snapshot?
   ├─ sim          → não grava nada
   └─ não          → grava snapshot + recalcula rankings
```

Divergência nunca é resolvida em silêncio nem descartada: fica registrada e visível.

### 6.3 Governo de free-tier

Cada fonte declara sua cota em configuração (por minuto, dia e mês). `fonte_chamada` registra consumo real. Antes de qualquer requisição o worker consulta o orçamento — se não couber, a fonte é pulada e o fato é logado.

**A cadência é guiada pelo calendário**, que é justamente o que a tabela `partida` fornece:

| Janela | GE (sem cota) | APIs (cota) | Racional |
|---|---|---|---|
| Partida em andamento (início até fim + 30 min) | a cada 3 min | só se GE falhar ou divergir | É quando a tabela muda |
| Bloco de jogos encerrado | 1× | **1 req de conferência** | Fecha a rodada com fonte autoritativa |
| Dia com jogos, fora da janela | a cada 30 min | — | Adiamentos, atrasos |
| Dia sem jogos | 2×/dia | — | Nada muda |
| Diário, 03:00 | — | **1 req de calendário** | Mudança de tabela pela CBF |
| Fora de temporada | 1×/dia | — | Só calendário |

### Orçamento diário de API-Football (teto: 100 req/dia, 10 req/min)

| Consumo | Dia de rodada cheia | Dia sem jogos |
|---|---|---|
| Sincronismo de calendário às 03:00 | 1 | 1 |
| Conferência ao fim de cada bloco (≈3 blocos) | 3 | 0 |
| **Uso típico** | **4** | **1** |
| Reserva para fallback e desempate | até 56 | até 59 |
| **Teto de segurança configurado** | **60** | **60** |

Sobram 40 requisições de folga sobre o limite. A carga de alta frequência fica no GE, que não tem cota — a cota paga é gasta em **conferência e resgate**, exatamente o papel de *fallback e check*.

Isso inverte o comportamento atual, que faz **até 80 requisições por hora ao ge.globo, 24 h por dia, o ano inteiro**, inclusive fora de temporada e sem ninguém acessando (§10.3 da spec). A cadência nova consome uma fração disso e chega *mais* atualizada nos momentos que importam.

O `GeGloboProvider` não tem cota formal, mas entra no mesmo governo com um limite auto-imposto. A pesquisa registra que acessos frequentes do mesmo IP podem ser tratados como raspagem e bloqueados — ser educado com uma fonte gratuita é requisito de disponibilidade, não gentileza.

### 6.4 Degradação

```
primária indisponível  → secundária
todas indisponíveis    → mantém o último snapshot bom,
                         marca `stale`, e a interface informa a idade do dado
```

A interface **sempre** mostra a idade do dado. Nunca mais um timestamp parado sem ninguém perceber.

### 6.5 As fontes

Levantamento consolidado em *APIs Para Jogos Do Brasileirão* (pesquisa fornecida em 09/08/2026).

| Provedor | Cobertura | Free tier | Limites do free tier | Ao vivo | Mínimo pago |
|---|---|---|---|---|---|
| **API-Football** (API-Sports) | Séries A, B, C, Copa do Brasil, Feminino | sim, todos os endpoints | **100 req/dia · 10 req/min** | 15 s | $19/mês (7.500/dia · 300/min) |
| **football-data.org** | Série A, código `BSA` | sim, 12 competições | **10 req/min**, sem teto diário publicado | leve atraso no free | €12/mês |
| **GE** `api.globoesporte.globo.com` | Séries A e B | sim, **não oficial** | sem documentação nem SLA | tempo real | — |
| **API Futebol** (br) | Nacionais, estaduais, regionais | só protótipo | restrito a testes | tempo real | planos em BRL |
| **TheSportsDB** | Série A e copas | sim, **truncado** | respostas parciais nas rotas públicas | assíncrona | $9/mês via Patreon |
| **Sportmonks** | Série A **só em plano pago** | não cobre o Brasil | free tier é só Dinamarca e Escócia | tempo real | €29/mês |

**Descartados:** Sportmonks (free tier não cobre o Brasil), TheSportsDB (respostas truncadas inviabilizam conferência) e API Futebol (free tier só de protótipo). Os três voltam à mesa se o projeto passar a ter orçamento.

### Papéis escolhidos

> **Corrigido em 09/08/2026 após medir cada API.** O free tier entrega menos do
> que a documentação promete. A tabela abaixo reflete o que foi verificado, não
> o que foi prometido. Detalhe em [`docs/_atual/cfg.fornecedores.md`](../_atual/cfg.fornecedores.md) §0.

| Temporada | GE | API-Football | football-data |
|---|---|---|---|
| 2018–2021 | ✗ | ✗ | ✗ |
| 2022 | ✗ | ✓ | ✗ |
| 2023–2024 | ✗ | ✓ | ✓ |
| 2025 | ✗ | ✗ | ✓ |
| **2026 (corrente)** | **✓** | **✗** | **✓** |

| Fonte | Papel | Por quê |
|---|---|---|
| **GE (JSON)** | Primária de alta frequência | Custo zero, tempo real, sem cota. Só cobre a temporada corrente |
| **football-data.org** | **Conferência da temporada corrente** | É a única API que enxerga 2026 no free tier. 10 req/min, sem teto diário publicado |
| **API-Football** | Histórico de 2022–2024 | O plano gratuito recusa 2025 e 2026 — não serve de conferência ao vivo |

Isso implementa literalmente o pedido — as APIs como **fallback e check** — e mantém o dado sempre fresco sem gastar cota: a frequência fica na fonte gratuita, a autoridade fica na fonte com cota.

### Duas consequências de projeto

**O `GeGloboProvider` deixa de raspar HTML.** A pesquisa aponta que `api.globoesporte.globo.com` devolve JSON — as mesmas rotas que alimentam o portal. Isso elimina a regex sobre HTML que é a causa da falha silenciosa documentada na §10.5 da spec. Segue sem SLA e sujeita a mudar sem aviso, o que é precisamente o motivo de existirem duas outras fontes.

**O calendário custa quase nada.** Uma única requisição no início da temporada traz os 380 confrontos com data, hora, estádio, rodada, mandante e visitante. Depois disso, 1 requisição por dia às 03:00 basta para capturar remarcações da CBF. A tabela `partida` (§5.3) se mantém atualizada com **cerca de 365 requisições por ano** — 1% do free tier anual da API-Football.

## 7. Motor de regras

`packages/regras` — puro, sem I/O.

```
calcularTabela(partidas)                    → Classificacao
calcularClassico(classificacao, apostas, regrasDaTemporada)   → Ranking
calcularPosicao(classificacao, palpites, regrasDaTemporada)   → Ranking
```

Porta as regras documentadas nas §5 e §6 da spec: soma dos 4 clubes, cinco critérios de desempate em cascata, premiação por posição; G4/Z4 com 1 ponto por faixa e 4 por posição exata, quatro critérios de desempate, divisão do prêmio entre empatados na liderança.

### 7.1 Duas correções decididas

**Prêmios de 2º e 3º — R$ 650,00 e R$ 350,00, retroativo a todas as temporadas.** O código calcula R$ 600/R$ 300 desde antes de março/2025, contra um texto que promete R$ 650/R$ 350. A aritmética confirma o texto: 2.000 + 650 + 350 + 120 = 3.120, mais 1.000 do Bolão por Posição, sobram exatamente os R$ 530 da Mega Sena citados no item 8 das regras.

Os valores ficam em `temporada.regras_premio`, então qualquer ano pode ser ajustado individualmente se surgir registro de que foi diferente. Como não há registro de nenhuma temporada anterior (§1), o seed aplica 2.000 / 650 / 350 / 120 a todas.

**Empates passam a ser colapsados em qualquer posição.** Hoje só empate na liderança do Bolão por Posição é tratado; Alan e Chico, ambos com 16 pontos, aparecem como 2º e 3º. Passa a valer ranking de competição padrão — pontos iguais, posição igual, e a posição seguinte pula:

```
antes:  1º Renato 17   2º Alan 16   3º Chico 16   4º Gilson 14   5º Daiane 14
depois: 1º Renato 17   2º Alan 16   2º Chico 16   4º Gilson 14   4º Daiane 14
```

> **Consequência a confirmar.** O prêmio de lanterna do Clássico é hoje atribuído por `posição == total de competidores`. Com posições colapsadas, um empate no fim da tabela deixa duas pessoas na última posição e essa comparação passa a falhar. Vou aplicar a mesma regra já usada na liderança — **os empatados na última posição dividem os R$ 120,00** — a menos que você prefira outro tratamento. Na prática o Clássico tem cinco critérios de desempate e dificilmente empata; o caso é raro, mas o código precisa decidir.

### 7.2 Teste de ouro

A captura de produção de 09/08/2026 (`/resultados`, 30 competidores, 112 KB) vira fixture. O motor novo tem que reproduzi-la campo a campo — **inclusive com os valores errados de prêmio e os empates não colapsados**. Só depois de bater exatamente é que as duas correções acima entram, cada uma com seu próprio teste e seu próprio commit.

Isso separa "reescrevi" de "mudei o resultado". Sem esse passo, qualquer divergência futura fica impossível de atribuir.

## 8. Worker

Processo Bun independente do web.

```
ciclo:
  1. cadência devida agora? (§6.3)              não → dorme
  2. orçamento de cota disponível? (§6.3)       não → pula fonte, loga
  3. ingerir partidas (calendário e resultados)
  4. calcular tabela a partir das partidas
  5. reconciliar com provedor (§6.2)
  6. mudou? não → fim
  7. gravar snapshot + snapshot_clube
  8. recalcular os dois rankings de todas as temporadas ativas
  9. gravar snapshot_competidor
 10. reescrever o cache Redis
 11. registrar consumo e duração
```

Idempotente e seguro para rodar em paralelo: `snapshot` tem restrição de unicidade sobre `(temporada, hash)`.

## 9. Web

Next.js App Router sob Bun, portando o design aprovado: três temas com script anti-FOUC, abas, menu sanduíche, busca, marcador "VOCÊ", detalhe em sheet, sparklines de trajetória e indicador de movimentação em 24 h.

Componentes de servidor entregam só o necessário — acaba o padrão de 3,3 KB de JSON por linha em atributo `onclick` que hoje infla a página para 220 KB (§10.4 da spec).

Rotas:

| Rota | Conteúdo |
|---|---|
| `/` | Temporada corrente, duas abas |
| `/t/[ano]` | Temporada encerrada |
| `/historico` | Hall da fama entre temporadas |
| `/api/resultados` | **Contrato compatível com o `/resultados` atual** |

O endpoint compatível é deliberado: o CORS está aberto hoje e pode haver consumidores. Quebrar sem aviso não é opção.

Dois ajustes no porte do design:

- **Posição normalizada.** O design usa `(p - 1) / 29`, com o 29 fixo em 30 competidores. Passa a usar o total real da temporada.
- **Time do coração.** O campo `Coracao` permanece no modelo e ganha um **❤️ ao lado do nome do clube**, substituindo o fundo cinza `#AAAAAA` de hoje — que não sobrevive a três temas. Está `false` em todos os competidores de 2026, então a marcação só aparecerá quando os dados voltarem a usá-la.

## 10. Configuração

`packages/config`, validada com zod, **falha no boot se algo faltar**. Nada de fallback com senha embutida, que é o padrão atual (§10.9 da spec).

| Variável | Papel |
|---|---|
| `DATABASE_URL` | Postgres — database e role próprios do bolão |
| `REDIS_URL` | Redis compartilhado |
| `REDIS_PREFIX` | Namespace de chaves — convivência com outros inquilinos |
| `PROVIDER_<NOME>_KEY` | Credencial por fonte |
| `PROVIDER_<NOME>_QUOTA_*` | Cotas por minuto, dia, mês |
| `TZ` | `America/Sao_Paulo` |

Segredos em `/opt/bolao-do-max/.env` no servidor, fora do git. As credenciais versionadas do projeto atual **não são replicadas**.

## 11. Deploy e plano de retorno

### 11.1 Convivência

| | Atual | Novo |
|---|---|---|
| Diretório | `/opt/bolao-maxmat1/` | `/opt/bolao-do-max/` |
| Redes | `rede-maxmat1` | `rede-banco` + `rede-cache` (externas) |
| Porta | 5001 | 5002 |
| Domínio | bolao.maxmat1.com.br | bolao-novo.maxmat1.com.br |
| Redis | próprio, 7.2 | compartilhado, 8, com prefixo |
| Banco | nenhum | `bolao` em `banco` |

**Nada do stack atual é parado, alterado ou apagado.** Os dois rodam lado a lado pelo tempo que for preciso.

### 11.2 Build fora do servidor

2 vCPU e 2,8 GB livres com oito containers não comportam `next build`. A imagem é construída na máquina local (ou em CI), exportada e carregada no servidor. O `compose.yml` de produção **não tem `build:`** — só `image:`.

### 11.3 Virada

1. Novo sobe em `bolao-novo.maxmat1.com.br`, vhost próprio, certbot
2. Convivência e comparação lado a lado (§12, Fase 9)
3. Aprovação sua
4. `proxy_pass` de `bolao.maxmat1.com.br` passa a apontar para 5002
5. Stack antigo **continua no ar**, ocioso, por um período combinado
6. Desligamento do antigo só com ordem explícita

### 11.4 Retorno

| Falha | Retorno | Custo |
|---|---|---|
| Antes da virada | Nenhuma ação — o antigo nunca parou | zero |
| Depois da virada | Reverter o `proxy_pass` e recarregar o nginx | segundos |
| Dado novo corrompido | Antigo tem Redis e dado próprios, intocados | zero |
| Next.js quebra sob Bun | Trocar o entrypoint para Node — mesma imagem, mesmo build | um redeploy |
| Migration ruim | `drizzle-kit` para trás; o banco é exclusivo do bolão | minutos |

O risco assumido em §2 (Next.js sob Bun não é caminho oficialmente suportado) tem mitigação concreta: a imagem carrega os dois runtimes e o entrypoint é uma variável.

## 12. Execução

Cada fase termina verificável. Nenhuma depende de a seguinte existir.

| # | Fase | Entrega | Verificação |
|---|---|---|---|
| **0** | Fundação | Monorepo Bun, workspaces, `packages/config`, lint, teste, `compose.dev.yml` | `bun install && bun test` verde; postgres e redis locais no ar |
| **1** | Esquema | Schema Drizzle completo, migrations | Migration sobe e desce limpa em banco vazio |
| **2** | Regras | `packages/regras` puro, com testes | **Reproduz a captura de produção campo a campo** |
| **3** | Apostas | Extração de 2018–2026 dos JSONs e planilhas para `seeds/apostas/` | 9 temporadas, contagem por ano confere; 2024 reparado |
| **4** | Provedor base | Porta + `GeGloboProvider` reescrito + validação | Busca a tabela de hoje e valida; falha vira erro tipado |
| **5** | Partidas | Schema, ingestão de calendário e resultados, cálculo da tabela | **Tabela calculada == tabela do ge.globo hoje** |
| **6** | APIs | `ApiFootballProvider` + `FootballDataProvider`, governo de cota, reconciliação, `divergencia` | Três fontes concordam na tabela de hoje; consumo diário ≤ 10 req na API-Football |
| **7** | Histórico | `seeds/tabelas-finais/` de **2022–2025** geradas das APIs e versionadas + recálculo. **2018–2021 não tem fonte gratuita** — ficam sem resultado ou exigem curadoria manual | 2023 confere com Palmeiras campeão (70 pts) e 2024 com Botafogo (79 pts) |
| **8** | Worker | Cron, cadência por calendário, snapshots, cache | 24 h rodando; snapshots só quando muda; cota respeitada |
| **9** | Web | Next.js, porte do design, três temas, abas, histórico | Design fiel; 360 px sem scroll horizontal; página muito menor que 220 KB |
| **10** | Deploy | `/opt/bolao-do-max/`, vhost, TLS, imagem de fora | `bolao-novo.maxmat1.com.br` no ar, antigo intacto |
| **11** | Virada | Comparação lado a lado, corte, monitoramento | Números idênticos; rollback testado **antes** do corte |

**Nenhuma fase está bloqueada.** A Fase 6 exige apenas o cadastro nas duas APIs para obter as chaves — grátis e sem cartão de crédito na API-Football.

A ferramenta das fases 10 e 11 já existe e foi verificada até onde dá sem enviar nada ao servidor: `infra/` com deploy, retorno, backup, restore e acionamento do worker, tudo parametrizado em `infra/deploy.yml`. Roteiro e resultados em [`docs/_atual/deploy.e.backup.md`](../_atual/deploy.e.backup.md). Executar depende da sua aprovação.

Ordem de valor: **2 → 5** é o coração. Um motor de regras que reproduz a produção e uma tabela calculada a partir das partidas tornam todo o resto mecânico.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Next.js sob Bun quebra num upgrade | Versão fixada; entrypoint Node na mesma imagem (§11.4) |
| Free-tier estourado | Teto de 60/100 configurado, uso típico de 4/dia; polling fica no GE, que não tem cota (§6.3) |
| GE bloqueia por IP ou muda o payload | Duas APIs independentes assumem; a tabela também é calculada das partidas (§4.2) |
| Nomes de clube divergem entre fontes | `clube_apelido` por temporada e fonte; nome não resolvido é erro, não zero |
| Calendário muda | `partida_alteracao` registra tudo; reingestão é idempotente |
| Tabela final histórica errada | Gerada da API-Football, conferida contra a football-data.org, versionada como seed e revisável em PR |
| Memória do servidor | Build fora; limites de memória no compose |
| Reescrita muda resultado sem querer | Teste de ouro na Fase 2 antes de qualquer correção |

### Decisões pendentes

1. ~~**Prêmio de lanterna em caso de empate**~~ — **fechado.** Os empatados na última posição dividem os R$ 120,00, com o pódio tendo precedência quando as posições colidem. Implementado em `packages/regras/src/index.ts` e coberto por dois testes em `correcoes.test.ts`.
2. ~~**Contas nas APIs**~~ — **fechado.** Chaves em `.env`, as três fontes respondendo.

### Situação em 10/08/2026

O plano saiu inteiro na **v2.0.0**. Duas coisas ficaram para trás, e ficam registradas aqui para não se perderem:

**Tabelas finais de 2018–2021 — bloqueado por dado, não por código.** Sondadas as duas APIs neste dia, ano a ano: a API-Football recusa por plano (*"Free plans do not have access to..."*) e a football-data.org devolve `403`. As apostas dessas quatro temporadas estão em `seeds/apostas/` e as temporadas existem no banco; falta a classificação final. Preencher de memória não é opção — erro silencioso no ranking é o modo de falha que esta reescrita existe para eliminar. Sai da mesa quando houver fonte, paga ou curada com procedência registrada.

**`/t/[ano]` e `/historico` não foram construídas.** Estão na tabela de rotas da §9 e não existem em `apps/web/app/`. O dado para sustentá-las existe para 2022–2025: `bun run historico` reconstrói o hall da fama pelas regras de cada temporada, com 2022 e 2023 para Daiane 'Pipoka', 2024 para Renato e 2025 para Alan. Mas hoje isso é CLI que imprime na tela — não persiste nem alimenta a web. Construir as rotas é feature, não pendência de acabamento, e por isso ficou fora da v2.1.0.

### Decisões fechadas em 09/08/2026

| Questão | Decisão |
|---|---|
| Prêmios de 2º e 3º | R$ 650,00 e R$ 350,00, **retroativo a todas as temporadas** |
| Empates fora da 1ª posição | **Colapsados** — ranking de competição padrão em ambos os bolões |
| Nome do projeto | **Bolão do Max** · diretório `bolao-do-max` · confere com o `origin` no GitHub |
| Time do coração | **Fica no modelo**, renderizado com ❤️ ao lado do clube |

## 14. O que não será feito

- Descartar `z_legado/bolao-max-server/` — permanece no repositório e em produção até ordem explícita
- Parar ou alterar qualquer container existente no servidor
- Provisionar Postgres ou Redis novos — os compartilhados já existem
- Alterar as regras do bolão sem decisão registrada
- Quebrar o contrato de `/resultados`
- Simulador nesta entrega — o modelo de dados o viabiliza; a interface fica para depois
