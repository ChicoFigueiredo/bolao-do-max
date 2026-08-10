# Configuração dos fornecedores de dados

O que precisa ser feito, manualmente, em cada fonte — e como isso vira variável de ambiente.

Referência de arquitetura: [`docs/plan/plan-refactor-bolao.md`](../plan/plan-refactor-bolao.md) §6.
Template pronto: [`.env.example`](../../.env.example) na raiz do repositório.

| Fonte | Papel | Cadastro | Cartão de crédito | Custo |
|---|---|---|---|---|
| **GE** `api.globoesporte.globo.com` | Primária, alta frequência | não tem | não | zero |
| **API-Football** (API-Sports) | Conferência e fallback | necessário | **não** | zero no free tier |
| **football-data.org** | Desempate e calendário | necessário | não | zero no free tier |

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

| Endpoint | Quando | Custo |
|---|---|---|
| `/fixtures?league=X&season=Y` | 1× no início da temporada — traz os 380 jogos com data, hora, estádio, rodada | 1 req |
| `/fixtures?league=X&season=Y&from=&to=` | 1×/dia às 03:00 — captura remarcação da CBF | 1 req |
| `/standings?league=X&season=Y` | ao fim de cada bloco de jogos — conferência | 1 req |

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

Nada de cadastro. Mas **é preciso mapear a rota JSON** antes de escrever o adaptador — a estrutura não é documentada e pode mudar sem aviso.

1. Abrir https://ge.globo.com/futebol/brasileirao-serie-a/ no navegador
2. DevTools → Network → filtrar por `api.globoesporte`
3. Registrar a rota de classificação e a de agenda/rodadas, com o formato exato do payload
4. Anotar as duas em `PROVIDER_GE_URL_*`

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

- [ ] Conta criada na API-Football e chave copiada
- [ ] `league id` da Série A descoberto e anotado
- [ ] Chave da football-data.org recebida por e-mail
- [ ] Acesso ao `BSA` confirmado no plano gratuito
- [ ] Rotas JSON do GE mapeadas no DevTools
- [ ] `.env` preenchido a partir do `.env.example`
- [ ] `bun run provider:doctor` com as três fontes concordando
- [ ] `.env` de produção em `/opt/bolao-do-max/.env`, fora do git

> Nenhuma chave entra no repositório. O projeto atual versiona credenciais de Redis em `app.js`, `docker-compose.yaml` e nos arquivos de instrução — esse padrão não se repete aqui.
