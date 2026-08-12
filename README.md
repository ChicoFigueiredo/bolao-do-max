# Bolão do Max

### 🏆 <https://bolao.maxmat1.com.br>

Bolão do Brasileirão Série A entre trinta amigos, desde 2018. Duas competições
paralelas na mesma aposta de R$ 155,00: o **Clássico**, que soma os pontos de
quatro clubes sorteados, e o **Por Posição**, que aposta nos quatro primeiros e
nos quatro últimos da tabela final.

Em **10 de agosto de 2026** o site foi reescrito por inteiro. O sistema anterior
— Node 14, Express, Pug, Redis como banco de dados — está arquivado em
[`z_legado/`](z_legado/) e desligado, não apagado.

---

## O que mudou, e por que

O sistema antigo guardava o resultado **só no Redis**. Não havia banco, não havia
histórico, e nenhuma das oito temporadas anteriores tinha sido preservada. A
classificação vinha de raspar uma página do ge.globo: mudança no HTML derrubava o
cálculo em silêncio.

A inversão central da reescrita é essa:

```
              antes                                   agora
   ge.globo ──► Redis ──► tela          fontes ──► worker ──► PostgreSQL ──► Redis ──► tela
                  ▲                                            (verdade)   (descartável)
            é o banco de dados
```

O Postgres é a verdade; o Redis é conveniência. Perder o cache passou a custar
desempenho, não dado.

E a classificação deixou de ser **buscada** para ser **calculada** a partir das
380 partidas com placar e horário. Isso resolveu quatro coisas de uma vez:
independência de fonte única, conferência cruzada entre três provedores,
economia de cota — e o simulador, que é recalcular a tabela com resultados
hipotéticos usando a mesma função.

### O que a reescrita entregou

| | |
|---|---|
| **Histórico** | 146 snapshots reais da temporada, reconstruídos das partidas. Quatro campeões de 2022 a 2025 recuperados, que não existiam em lugar nenhum |
| **Aba Evolução** | Trajetória de posição de cada um em três janelas: 48 horas, 30 dias e o campeonato por semana |
| **Três temas** | Ocre (o padrão, sempre), claro e escuro, sem piscada ao recarregar |
| **Página** | 165 KB, contra 220 KB do sistema antigo — que mandava 3,3 KB de JSON por linha dentro de um atributo `onclick` |
| **Latência** | Detalhe de competidor em 14–33 ms: o worker pré-renderiza tudo no Redis, então tocar um nome é ler uma chave |
| **Conferência** | Três fontes independentes, divergência vira registro em tabela em vez de silêncio |
| **Testes** | 39 testes, 539 asserções, incluindo a reprodução campo a campo da saída da produção antiga — **com os defeitos dela** — antes de qualquer correção entrar |

---

## Comandos

### Desenvolvimento

```bash
bun install
bun run infra:up          # Postgres 17 + Redis 8 locais (portas 55432 e 56379)
bun run db:migrate        # 14 tabelas
bun run db:seed           # 9 temporadas de aposta
bun run db:seed:dados     # 380 partidas + 146 snapshots já apurados
bun run worker:ciclo      # um ciclo: ingere, apura, publica cache, pré-renderiza
bun run web               # http://localhost:3000
```

```bash
bun run worker            # worker em primeiro plano, cadência pelo calendário
bun test                  # 39 testes
bun run typecheck         # os dois projetos
bun run provider:doctor   # as três fontes estão respondendo?
```

### Produção

```bash
bun run deploy --dry-run  # o plano inteiro, sem tocar em nada
bun run deploy            # build aqui, envia o delta, migra, semeia, sobe, TLS
bun run deploy --versoes
bun run deploy --reverter # volta para a versão anterior

bun run backup            # dump de produção para infra/backups/ (fora do servidor)
bun run restaurar         # último backup → banco local
bun run tunel             # 127.0.0.1:35132 → o Postgres de produção
bun run tunel --verificar # prova que o banco não tem porta na internet

bun run worker:remoto ciclo
bun run worker:remoto completar    # traz o dado do dump até agora
bun run worker:remoto logs -n 50
```
 
### Dados

```bash
bun run seeds:exportar    # banco → seeds/partidas/ e seeds/snapshots/
bun run seeds:apostas     # z_legado/bolao-max-server/json/ → seeds/apostas/
bun run seeds:tabelas     # tabelas finais das temporadas encerradas, das APIs
bun run historico         # recalcula as temporadas encerradas
bun run snapshots:replay  # reconstrói a série a partir das partidas
```

---

## Documentação

| Documento | O que responde |
|---|---|
| [**Deploy, backup e restore**](docs/_atual/deploy.e.backup.md) | Como subir, como voltar, como o backup funciona, como chegar no banco. O runbook operacional |
| [**Homologação**](docs/_atual/homologacao.imediata.md) | Como subir tudo em localhost e o que conferir na tela e nos números |
| [**Configuração das fontes**](docs/_atual/cfg.fornecedores.md) | As três APIs de futebol: cadastro, limites do plano gratuito, o que cada uma cobre |
| [**Plano da reescrita**](docs/plan/plan-refactor-bolao.md) | Arquitetura, decisões e as doze fases de execução, com o porquê de cada escolha |
| [**Especificação do sistema antigo**](docs/spec/bolao-do-max.md) | O que o sistema anterior fazia, linha por linha, com os dez defeitos verificados |
| [**Brief do design**](docs/prompts/claude-design.md) | O que foi pedido à remodelagem da interface |
| [**infra/**](infra/README.md) | Os cinco scripts de operação e o que cada um garante |
| [**Diário**](CHANGELOG.md) | O que quebrou, o que consertou e o que ficou aberto — com as causas que **não** foram encontradas |
| [**z_legado/**](z_legado/README.md) | O que foi arquivado e por quê |

O design da interface vive em
[Claude Design](https://claude.ai/design/p/85d1781d-0cdb-41c0-b4ba-a7eb2d445ac9)
e foi portado à risca — as diferenças que permaneceram são deliberadas e estão
anotadas nos comentários dos componentes.

---

## Estrutura

```
apps/
  web/           Next.js 15 App Router, sob Bun. Componentes de servidor
  worker/        Bun: ingestão, apuração, snapshots, cache, pré-renderização
packages/
  regras/        pontuação, desempate, prêmios, tabela — função pura, sem I/O
  db/            Drizzle: schema, migrations, seeds, CLIs
  provider/      porta + três adaptadores + governo de cota + reconciliação
  dominio/       tipos compartilhados
  config/        env validado com zod, falha no boot se faltar algo
seeds/
  apostas/       2018 a 2026, extraídas do sistema antigo
  tabelas-finais/ 2022 a 2025, das APIs
  partidas/      380 partidas com placar e horário
  snapshots/     146 snapshots da série temporal
infra/           deploy, backup, restore, túnel, Dockerfile, compose de produção
docs/            especificação, plano, runbooks
z_legado/        o sistema anterior, arquivado e desligado
```

`packages/regras` é a peça central: recebe partidas e apostas, devolve rankings.
Sem banco, sem rede, sem relógio. É o que permite testar exaustivamente,
recalcular o passado e simular o futuro com o mesmo código.

### A pilha

Bun 1.3 · Next.js 15.1 · React 19 · PostgreSQL 17 · Redis 8 · Drizzle ORM ·
zod. Um runtime só para a web e para o worker, uma imagem para os dois.

---

## Produção

```
ssh.chico-figueiredo.com.br
  /opt/bolao-do-max/        compose.yml + .env (modo 600)
  bolao-do-max-web          127.0.0.1:5002 ← nginx com TLS
  bolao-do-max-worker       cadência decidida pelo calendário
  banco / cache             PostgreSQL e Redis compartilhados com outros projetos
```

A imagem é construída na máquina do desenvolvedor — o servidor tem 2 vCPU e não
comporta `next build` junto de oito containers vizinhos — e viaja por rsync sobre
o mesmo tar, então do segundo deploy em diante sobem só os blocos que mudaram:
134 MB no primeiro envio, quase nada nos seguintes.

Nenhum segredo mora no git. As senhas de banco e cache são geradas pelos scripts
do próprio servidor e lidas no momento do deploy; as chaves das APIs ficam no
`.env`, que é ignorado. O banco **não tem porta na internet**: o único caminho é
`bun run tunel`, que audita a exposição antes de abrir.

Dois backups cobrem coisas diferentes: o timer do servidor às 03:20 protege de
erro humano, e o cron desta máquina às 03:00 traz a cópia para fora — porque
backup que mora no mesmo disco do original é meio backup.

---

## Arquitetura de build e de deploy

### Onde o Bun roda — e por que a web não é um site estático

Vale desfazer uma confusão fácil, porque ela muda o que se espera quando algo
quebra: **o Bun não é só a ferramenta de build. Ele é o runtime da web em
produção.** E a web **não** é um site compilado e servido como arquivo.

`next build` não produz um site estático. Produz um **servidor**. E aqui ele é
deliberadamente dinâmico: a home e as três rotas de API declaram
`export const dynamic = 'force-dynamic'`, ou seja, o HTML é renderizado **a cada
requisição**, lendo o Redis e caindo no Postgres quando a chave falta. Não existe
`output: 'export'`, e nunca houve.

Também não existe serviço de API separado — `apps/api` não existe. As três rotas
(`/api/resultados`, `/api/competidor`, `/api/evolucao`) moram dentro de
`apps/web`. **O container da web É a API.**

```
        navegador
            │ TLS
            ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ nginx (host)   bolao.maxmat1.com.br                              │
   │                upstream maxmat1 → 127.0.0.1:5002                 │
   └────────┬─────────────────────────────────────────────────────────┘
            ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │ bolao-do-max-web       bun --bun next start        ← Bun         │
   │   /                    HTML por requisição (SSR)                 │
   │   /api/*               três route handlers, mesmo processo       │
   │   /_next/static/*      assets do build, servidos como arquivo    │
   └────────────────┬──────────────────────────────┬──────────────────┘
                    │ caminho comum                │ exceção: cache
                    ▼ lê o cache                   ▼ vazio, calcula
               ┌──────────┐                   ┌──────────┐
               │  Redis   │                   │ Postgres │
               └──────────┘                   └──────────┘
                    ▲ publica cache                ▲ ingere, apura
                    │ e pré-render                 │ e faz snapshot
   ┌────────────────┴──────────────────────────────┴──────────────────┐
   │ bolao-do-max-worker    bun run apps/worker/src/index.ts  ← Bun   │
   └──────────────────────────────────────────────────────────────────┘
```

Uma imagem, um runtime, dois processos:

| processo | comando | runtime | o que faz |
| --- | --- | --- | --- |
| build (sua máquina) | `bun --bun next build` | Bun | gera `.next` — servidor + assets |
| `bolao-do-max-web` | `bun --bun next start` | **Bun** | SSR da home **e** as rotas de API |
| `bolao-do-max-worker` | `bun run apps/worker/src/index.ts` | Bun | ingestão, apuração, snapshots, cache |
| CLIs do deploy | `migrate`, `seed`, `ciclo` | Bun | rodam no servidor, dentro da imagem |

O `--bun` é o que força o runtime: sem ele, o `next` seria executado pelo Node do
shebang. Como a imagem **não tem Node**, o Bun instala um shim
(`/tmp/bun-node-*/node → bun`) para que qualquer processo filho que peça `node`
caia nele também. É por isso que o processo do servidor se anuncia como
`node …` mas seu executável real é `/usr/local/bin/bun`.

> **O risco é conhecido e está assumido.** Next sob Bun não é caminho
> oficialmente suportado — o cabeçalho do `infra/Dockerfile` registra isso desde
> o início, junto da saída: como a imagem tem só Bun, **trocar para Node é trocar
> a base e o comando, sem mexer no build.**
>
> Em 11/08/2026 esse risco cobrou: o servidor passou 26 h entregando apenas o
> primeiro buffer de cada resposta dinâmica e travando. Os assets estáticos
> continuaram intactos — eles saem por outro caminho de envio — que é exatamente
> a assimetria esperada de um problema de runtime, e não de build. A causa dentro
> do Bun **segue não diagnosticada**. Ver o [diário](CHANGELOG.md).

### O build — quatro estágios, uma imagem

Construída **na sua máquina, nunca no servidor**: são 2 vCPU e ~2,8 GB livres com
oito containers no ar, e `next build` ali competiria com os vizinhos.

```
base      oven/bun:1.3.11-alpine + tzdata
          └─ sem tzdata, TZ=America/Sao_Paulo é ignorado em silêncio e tudo
             raciocina em UTC — três horas de erro na janela de "jogo agora"

deps      só os manifestos → bun install --frozen-lockfile
          └─ enquanto bun.lock não muda, a camada é reaproveitada

build     código + `bun --bun next build` + poda
          ├─ variáveis de fachada, válidas e obviamente falsas, só para a
          │  validação zod passar. Não sobrevivem: o runtime parte de base limpa
          └─ poda AQUI, não no runtime: camada não devolve espaço, e apagar
             depois de copiar deixa as duas cópias. 1,67 GB → ~0,5 GB

runtime   base limpa + cópias dirigidas + USER bun + HEALTHCHECK
          └─ 134 MB no fim
```

Três decisões que parecem estranhas e não são:

- **Sem `output: 'standalone'`.** O empacotamento standalone monta um
  `node_modules` próprio rastreando arquivos — mas o do Bun é feito de links para
  o depósito `.bun`, e o que sai são links quebrados. Daí copiar o
  `node_modules` podado à mão.
- **Os `node_modules` de cada workspace viajam junto.** No layout do Bun é lá que
  ficam os links que fazem `next` e `drizzle-orm` resolverem; a raiz só tem o
  depósito.
- **A poda é a dedo, não `bun install --production`.** A raiz do monorepo não tem
  `dependencies`, então esse comando devolveria uma árvore que não resolve import
  nenhum. O que sai é provavelmente morto, não talvez morto: binários glibc numa
  imagem musl, ferramenta de autoria (`typescript`, `drizzle-kit`, `esbuild`,
  `@types`) e 57 MB de cache do webpack.

### O deploy — o que `bun run deploy` faz, em ordem

Um script (`infra/bin/deploy.ts`), doze etapas, tudo por SSH. Parâmetros em
`infra/deploy.yml`; para sobrescrever sem sujar o git, crie
`infra/deploy.local.yml`.

| # | etapa | o que acontece |
| --- | --- | --- |
| 1 | verificação prévia | docker local e remoto, redes externas, `banco` e `cache` de pé, porta 5002, espaço em disco |
| 2 | banco e cache | garante database, role e usuário ACL — os scripts do servidor são idempotentes |
| 3 | configuração | monta o `.env` (modo 600) e o `compose.yml`, validados pelo **mesmo zod que roda no boot** |
| 4 | construção | `docker build` local, tag `<sha-curto>` + `mais-recente` |
| 5 | envio | rsync sobre o mesmo tar: do segundo deploy em diante sobem só os blocos que mudaram |
| 6 | banco e dado | `migrate`, `seed`, `seed-dados`, `ciclo` — a lista vem de `deploy.passos` |
| 7 | subindo | `compose up -d` e espera o healthcheck ficar `healthy` |
| 8 | nginx e TLS | publica o vhost do domínio de convivência e roda o certbot. **Nunca escreve no vhost de produção** |
| 9 | limites | teto de requisições, só com `--limites` |
| 10 | conferência | interno, API, domínio de convivência e **domínio de produção** — exigindo `</html>`, não só `200` |
| 11 | limpeza | mantém `versoes_guardadas` (3) imagens no servidor, para poder voltar |
| 12 | resumo | lê o vhost e diz se este deploy serve produção |

**A versão é o SHA curto do git** — e `-sujo` se a árvore de trabalho não estiver
limpa. Imagem marcada `-sujo` não é reproduzível a partir de nenhum commit:
confira `git status --porcelain` antes.

**Desde a virada de 10/08/2026, todo deploy toca produção.** O
`upstream maxmat1` de `bolao.maxmat1.com.br` aponta para a mesma porta 5002 que
este stack publica, então recriar o container é um piscar de indisponibilidade no
domínio real — não um deploy isolado. O resumo final avisa, e descobre isso lendo
o vhost em vez de afirmar por escrito.

#### Flags

| flag | efeito |
| --- | --- |
| `--dry-run` | simula: mostra o que faria sem escrever nada |
| `--versao=<tag>` | usa uma tag em vez do SHA calculado |
| `--versoes` | lista as imagens carregadas no servidor |
| `--reverter[=<tag>]` | volta para a versão anterior (ou a indicada) e recria os containers |
| `--so-limites` | aplica só o teto de requisições, sem recriar container |
| `--limites` | inclui o teto de requisições nesta passada |
| `--sem-imagem` | pula build e envio; usa a imagem já carregada |
| `--sem-nginx` | não mexe em vhost nem certificado |
| `--refazer-vhost` | reescreve o vhost de convivência, que por padrão é preservado |

> ⚠️ **O script ignora flag desconhecida em silêncio.** A simulação é
> `--dry-run`; a variável interna se chama `seco`, e escrever `--seco` **executa
> um deploy real**. Aconteceu em 11/08/2026, publicando em produção uma imagem
> construída de árvore não commitada.

**Voltar atrás** é `bun run deploy --reverter`: reescreve `BOLAO_VERSAO` no
`.env` do servidor, recria os containers e espera a saúde. O dado no banco não é
tocado — só a imagem que o lê. Por isso valem as três versões guardadas.

---

## O que ainda não existe

Registrado para não parecer esquecimento:

- **Simulador.** O modelo de dados o viabiliza — as 380 partidas com horário
  estão em banco e `calcularTabela` aceita placares hipotéticos —, mas não há
  interface.
- **Páginas de temporada encerrada e hall da fama.** O cálculo existe e roda por
  CLI; as rotas `/t/[ano]` e `/historico` não foram criadas.
- **2018 a 2021 sem resultado.** As apostas foram importadas, mas não há fonte
  gratuita para as tabelas finais desses anos.
- **Uma aposta de 2024 sob suspeita.** Os oito palpites do Chico reproduzem a
  tabela final exata daquele ano, o que não acontece como previsão. O
  recálculo avisa em vez de coroar campeão.
