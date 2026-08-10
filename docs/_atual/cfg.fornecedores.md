# Configuração dos fornecedores de dados

O que precisa ser feito, manualmente, em cada fonte — e como isso vira variável de ambiente.

Referência de arquitetura: [`docs/plan/plan-refactor-bolao.md`](../plan/plan-refactor-bolao.md) §6.
Template pronto: [`.env.example`](../../.env.example) na raiz do repositório.

| Fonte | Papel | Cadastro | Cartão de crédito | Custo |
|---|---|---|---|---|
| **GE** `api.globoesporte.globo.com` | Primária, alta frequência | não tem | não | zero |
| **football-data.org** | **Conferência da temporada corrente** | necessário | não | zero no free tier |
| **API-Football** (API-Sports) | Histórico de 2022–2024 apenas | necessário | **não** | zero no free tier |

## 0. Cobertura real do free tier

> Medido chamando cada API em 09/08/2026. **Difere do que a pesquisa indicava** —
> a documentação promete mais do que o plano gratuito entrega.

| Temporada | GE | API-Football | football-data |
|---|---|---|---|
| 2018–2021 | ✗ | ✗ | ✗ |
| 2022 | ✗ | ✓ | ✗ |
| 2023 | ✗ | ✓ | ✓ |
| 2024 | ✗ | ✓ | ✓ |
| 2025 | ✗ | ✗ | ✓ |
| **2026 (corrente)** | **✓** | **✗** | **✓** |

Três consequências:

1. **A API-Football não serve de conferência ao vivo.** O plano gratuito responde
   literalmente *"Free plans do not have access to this season, try from 2022 to
   2024"* para 2025 e 2026. O papel de conferência da temporada corrente é da
   **football-data.org**.
2. **O GE só serve a temporada corrente.** O UUID `d1a37fa4-…` devolve 404 para
   qualquer ano anterior, tanto em `/classificacao/` quanto em `/jogos/`.
3. **2018–2021 não tem nenhuma fonte gratuita.** A reconstrução histórica
   automática alcança 2022–2025; as quatro temporadas anteriores exigem curadoria
   manual ou plano pago.

### Ordenação: football-data usa critério europeu

Ela desempata por **saldo de gols** antes de vitórias; o Brasileirão desempata por
**vitórias** primeiro. Times empatados em pontos saem em ordem diferente sem que
ninguém erre os números.

Verificado em 09/08/2026 — Cruzeiro e Bahia com 33 pontos (9 × 8 vitórias) e
Mirassol e Internacional com 23 (6 × 5). Por isso a reconciliação separa
divergência de **estatística** (problema real) de divergência de **ordenação**
(convenção). As estatísticas da football-data conferem; a ordenação dela não deve
ser adotada.

---

## 1. API-Football (API-Sports)

Fonte autoritativa. É dela que sai a conferência de tabela e o resgate quando o GE falha.

### O que fazer

1. Criar conta em **https://dashboard.api-football.com/register**
   Não pede cartão de crédito. A conta gratuita já libera **todos os endpoints** — os planos pagos diferem apenas em volume.
2. Copiar a chave em **Dashboard → API Key** (string hexadecimal longa).
3. Descobrir o `league id` do Brasileirão Série A e o `season` corrente:
   ```bash
   curl -s 'https://v3.football.api-sports.io/leagues?country=Brazil&type=League' \
     -H 'x-apisports-key: SUA_CHAVE' | jq '.response[] | {id: .league.id, nome: .league.name}'
   ```
   Anotar o `id` da Série A em `PROVIDER_APIFOOTBALL_LEAGUE_ID`.
4. Conferir o saldo de requisições — o cabeçalho de resposta traz o consumo do dia:
   ```bash
   curl -sI 'https://v3.football.api-sports.io/status' -H 'x-apisports-key: SUA_CHAVE' \
     | grep -i 'x-ratelimit'
   ```

### Endpoints que o projeto usa

`league=71` é a Série A — confirmado em 09/08/2026, com temporadas de **2010 a 2026**.

| Endpoint | Quando | Custo |
|---|---|---|
| `/fixtures?league=71&season=2026` | 1× no início da temporada — traz os 380 jogos com data, hora, estádio, rodada | 1 req |
| `/fixtures?league=71&season=2026&from=&to=` | 1×/dia às 03:00 — captura remarcação da CBF | 1 req |
| `/standings?league=71&season=2026` | ao fim de cada bloco de jogos — conferência | 1 req |
| `/standings?league=71&season=<2018…2025>` | **uma única vez**, na reconstrução histórica | 8 req |

A cobertura desde 2010 é o que dispensa curadoria manual das tabelas finais: as oito temporadas do histórico saem de oito requisições, e o resultado é versionado em `seeds/tabelas-finais/` para ser revisável e reproduzível. Conferido: 2023 devolve Palmeiras campeão com 70 pontos e América-MG lanterna com 24.

### Limites

| | Free | Pro ($19/mês) |
|---|---|---|
| Requisições por dia | **100** | 7.500 |
| Requisições por minuto | **10** | 300 |
| Latência ao vivo | 15 s | 15 s |

Chamadas de mídia e escudos **não contam** na cota diária.

Uso projetado: **4 requisições em dia de rodada cheia, 1 em dia sem jogos**. O teto configurado é 60, deixando 40 de folga sobre o limite.

### Variáveis

```
PROVIDER_APIFOOTBALL_ENABLED=true
PROVIDER_APIFOOTBALL_KEY=<chave do dashboard>
PROVIDER_APIFOOTBALL_BASE_URL=https://v3.football.api-sports.io
PROVIDER_APIFOOTBALL_LEAGUE_ID=<id da Série A>
PROVIDER_APIFOOTBALL_QUOTA_DAY=60
PROVIDER_APIFOOTBALL_QUOTA_MINUTE=8
```

`QUOTA_DAY=60` e `QUOTA_MINUTE=8` são tetos auto-impostos, deliberadamente abaixo dos 100/10 reais. A margem existe para que um bug de laço não queime a cota do dia.

---

## 2. football-data.org

Terceira opinião na reconciliação e reforço no sincronismo de calendário. Entra quando GE e API-Football discordam.

### O que fazer

1. Pedir a chave em **https://www.football-data.org/client/register**
   Formulário curto, chave chega por e-mail. Sem cartão.
2. Confirmar que o plano gratuito cobre o Brasileirão — o código da competição é **`BSA`**:
   ```bash
   curl -s 'https://api.football-data.org/v4/competitions/BSA' \
     -H 'X-Auth-Token: SUA_CHAVE' | jq '{nome: .name, area: .area.name, temporada: .currentSeason.startDate}'
   ```
3. Testar a tabela:
   ```bash
   curl -s 'https://api.football-data.org/v4/competitions/BSA/standings' \
     -H 'X-Auth-Token: SUA_CHAVE' | jq '.standings[0].table[:3]'
   ```

### Limites

| | Free | Pago (a partir de €12/mês) |
|---|---|---|
| Requisições por minuto | **10** | até 120 |
| Competições | 12, incluindo `BSA` | até 100 |
| Placar ao vivo | leve atraso | tempo real |

Não há teto diário publicado no plano gratuito — só a vazão de 10/min. Por isso ela é boa candidata a desempate: pode ser consultada com mais liberdade que a API-Football.

### Variáveis

```
PROVIDER_FOOTBALLDATA_ENABLED=true
PROVIDER_FOOTBALLDATA_KEY=<chave recebida por e-mail>
PROVIDER_FOOTBALLDATA_BASE_URL=https://api.football-data.org/v4
PROVIDER_FOOTBALLDATA_COMPETITION=BSA
PROVIDER_FOOTBALLDATA_QUOTA_MINUTE=8
```

---

## 3. GE — `api.globoesporte.globo.com`

Fonte primária de alta frequência. Sem cadastro, sem chave, sem custo.

### O que fazer

**Nada.** As rotas já foram descobertas e validadas ao vivo em 09/08/2026 — as duas respondem HTTP 200 para a temporada 2026 e já estão preenchidas no `.env.example`.

```
BASE = https://api.globoesporte.globo.com
UUID = d1a37fa4-e948-43a6-ba53-ab24ab3a45b1     ← Série A, estável desde 2020
FASE = fase-unica-campeonato-brasileiro-{temporada}

classificação   GET {BASE}/tabela/{UUID}/fase/{FASE}/classificacao/
jogos da rodada GET {BASE}/tabela/{UUID}/fase/{FASE}/rodada/{1..38}/jogos/
```

Conferir a qualquer momento:

```bash
curl -s -H 'User-Agent: BolaoDoMax/1.0 (+https://bolao.maxmat1.com.br)' \
  'https://api.globoesporte.globo.com/tabela/d1a37fa4-e948-43a6-ba53-ab24ab3a45b1/fase/fase-unica-campeonato-brasileiro-2026/classificacao/' \
  | jq '.classificacao[0] | {ordem, nome_popular, pontos, equipe_id}'
```

> **Exceção de slug:** em 2020 a fase era `fase-unica-seriea-2020`; de 2021 em diante, `fase-unica-campeonato-brasileiro-<ano>`. Relevante só para a reconstrução histórica.

Origem: o pacote R [`williamorim/brasileirao`](https://github.com/williamorim/brasileirao/blob/master/data-raw/scraping_matches.R) usa essas rotas desde 2020, o que é boa evidência de estabilidade — mas não é garantia, e é por isso que existem duas outras fontes.

### O que o payload entrega

Bem mais do que o scraping de HTML atual:

**Classificação** — `ordem` (posição pronta, sem inferir da ordem do array), `variacao` (variação de posição), **`equipe_id`** (inteiro estável — resolve o casamento por nome), `pontos`, `vitorias`, `empates`, `derrotas`, `gols_pro`, `gols_contra`, `saldo_gols`, `jogos`, `aproveitamento`, `escudo` (SVG), `ultimos_jogos` (`["v","v","d","v","e"]`) e `faixa_classificacao` com as zonas nomeadas (Libertadores, Pré-Libertadores, Sul-Americana, Rebaixados).

**Jogos** — `id` da partida, `data_realizacao` em ISO, `hora_realizacao`, `placar_oficial_mandante`/`_visitante`, `equipes.{mandante,visitante}` com `id`/`nome_popular`/`sigla`/`escudo`, `sede.nome_popular`, `transmissao.broadcast.id` (estado) e `jogo_ja_comecou`.

### Peculiaridades confirmadas nos testes

| Observação | Consequência |
|---|---|
| Rodada 39 devolve array vazio | Forma limpa de detectar o fim do campeonato |
| Jogos distantes vêm com `T12:00` | Horário **provisório**, não o real. O campo `inicio_confirmado` só é preenchido quando firma |
| Jogo adiado pode ter `data_realizacao: null` **com** `sede` preenchida | Rodada 21, Botafogo × Grêmio. O schema precisa aceitar data nula |
| `sede` vem `null` em jogos futuros | Estádio só é definido perto da data |

As três últimas são exatamente o caso "sempre pode mudar" que motivou a tabela `partida_alteracao`.

### Riscos aceitos

Sem SLA, sem suporte, sem garantia de estabilidade do payload. Acesso frequente do mesmo IP pode ser tratado como raspagem e bloqueado.

Mitigações no projeto: cadência auto-limitada, validação de schema em toda resposta, e duas APIs independentes prontas para assumir. E a tabela também é calculada a partir das partidas, o que torna nenhuma fonte de classificação indispensável.

### Variáveis

```
PROVIDER_GE_ENABLED=true
PROVIDER_GE_URL_CLASSIFICACAO=<rota JSON mapeada no passo 3>
PROVIDER_GE_URL_AGENDA=<rota JSON mapeada no passo 3>
PROVIDER_GE_USER_AGENT=BolaoDoMax/1.0 (+https://bolao.maxmat1.com.br)
PROVIDER_GE_INTERVALO_JOGO_S=180
PROVIDER_GE_INTERVALO_OCIOSO_S=1800
```

O `USER_AGENT` é identificação honesta, não disfarce. O código atual se apresenta como um Chrome 41 de 2015; um agente que diz quem é e como contatar é a diferença entre um consumidor educado e um raspador anônimo.

---

## 4. Ordem de precedência

Configurável, para permitir teste e degradação sem alterar código.

```
RECONCILIACAO_ORDEM=ge,apifootball,footballdata
RECONCILIACAO_MINIMO_FONTES=2
RECONCILIACAO_ALARMA_DIVERGENCIA=true
```

Com `MINIMO_FONTES=2`, uma divergência entre as duas primeiras aciona a terceira e adota a maioria. Toda discordância é gravada na tabela `divergencia` — nenhuma é resolvida em silêncio.

---

## 5. Como validar a configuração

Depois de preencher o `.env`, o comando de diagnóstico consulta cada fonte habilitada uma vez e relata cobertura, latência e saldo de cota:

```bash
bun run provider:doctor
```

Saída esperada:

```
✓ ge            classificação 20 clubes · agenda 380 jogos · 412 ms
✓ apifootball   classificação 20 clubes · agenda 380 jogos · 288 ms · cota 3/60 hoje
✓ footballdata  classificação 20 clubes · agenda 380 jogos · 501 ms
✓ reconciliação  3 fontes concordam
```

Esse comando faz parte da entrega da Fase 6 e é o critério de verificação dela.

---

## 6. Checklist

- [x] Rotas JSON do GE descobertas e validadas ao vivo — 09/08/2026
- [x] Conta criada na API-Football e chave copiada
- [x] Chave da football-data.org recebida
- [x] `league id` da Série A = **71**, anotado em `PROVIDER_APIFOOTBALL_LEAGUE_ID`
- [x] Acesso ao `BSA` confirmado no plano gratuito da football-data.org
- [x] `.env` completo a partir do `.env.example`
- [ ] `bun run provider:doctor` com as três fontes concordando
- [ ] `.env` de produção em `/opt/bolao-do-max/.env`, fora do git

> Nenhuma chave entra no repositório. O projeto atual versiona credenciais de Redis em `app.js`, `docker-compose.yaml` e nos arquivos de instrução — esse padrão não se repete aqui.
