# Imagem única do Bolão do Max — web e worker saem do mesmo build.
#
# Construída na SUA máquina, nunca no servidor: são 2 vCPU e 2,8 GB livres com
# oito containers no ar, e `next build` ali competiria com os vizinhos
# (docs/plan §11.2). O que viaja é a imagem pronta.
#
#   docker build -f infra/Dockerfile -t bolao-do-max:<versao> .
#
# Um runtime só (Bun) para os dois processos. O risco assumido no plano — Next
# sob Bun não é caminho oficialmente suportado — tem saída pelo mesmo lugar: a
# imagem tem só Bun, e trocar para Node é trocar a base e o comando, sem mexer
# no build.

# ─────────────────────────────────────────────────────────────
# Base — Bun e fuso horário
# ─────────────────────────────────────────────────────────────
FROM oven/bun:1.3.11-alpine AS base
# Alpine não traz o banco de fusos. Sem tzdata, TZ=America/Sao_Paulo é
# silenciosamente ignorado e tudo passa a raciocinar em UTC — o que
# desalinharia a janela de "jogo em andamento" e o horário das partidas em três
# horas. Não é detalhe cosmético.
RUN apk add --no-cache tzdata
WORKDIR /app

# ─────────────────────────────────────────────────────────────
# Dependências
# ─────────────────────────────────────────────────────────────
FROM base AS deps
# Só os manifestos primeiro: enquanto o bun.lock não mudar, esta camada é
# reaproveitada e o `bun install` não roda de novo.
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/dominio/package.json packages/dominio/
COPY packages/provider/package.json packages/provider/
COPY packages/regras/package.json packages/regras/
RUN bun install --frozen-lockfile

# ─────────────────────────────────────────────────────────────
# Build do Next e poda
# ─────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.json ./
COPY packages packages
COPY apps apps
COPY seeds seeds

# Valores de fachada, válidos e obviamente falsos, só para a configuração
# passar pela validação durante o build. Não são segredo e não sobrevivem: o
# estágio final começa de uma base limpa, então nada disto vira fallback em
# produção — que é justamente o modo de falha que o projeto proíbe.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    TEMPORADA_ATUAL=2026 \
    SERIE=A \
    DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    REDIS_PREFIX=build: \
    PROVIDER_GE_URL_CLASSIFICACAO=https://build.invalid/{temporada}/ \
    PROVIDER_GE_URL_AGENDA=https://build.invalid/{temporada}/{rodada}/ \
    PROVIDER_GE_USER_AGENT=build

RUN cd apps/web && bun --bun next build

# A poda acontece AQUI, e não no estágio final, porque camada de imagem não
# devolve espaço: apagar depois de copiar deixa o peso na camada de baixo e a
# imagem fica com as duas cópias. Medido: 1,67 GB antes disto, ~0,5 GB depois.
#
# O que sai, e por que é provavelmente morto e não talvez morto:
#   swc-linux-x64-gnu / sharp-libvips-linux-x64  → binários glibc numa imagem
#       musl. Não carregam nem se alguém tentar; o Next escolhe o par -musl.
#   typescript, drizzle-kit, esbuild, @types     → ferramenta de autoria. Quem
#       executa .ts em produção é o próprio Bun, e as migrations são aplicadas
#       pelo migrator do drizzle-orm, que não depende do drizzle-kit.
#   .next/cache                                  → 57 MB de cache do webpack.
#
# `bun install --production` seria o caminho óbvio e não serve: a raiz deste
# monorepo não tem `dependencies`, então o comando devolve um node_modules só
# com o depósito `.bun` e nenhum link — árvore que não resolve import nenhum.
RUN rm -rf \
      node_modules/.bun/@next+swc-linux-x64-gnu@* \
      node_modules/.bun/@img+sharp-libvips-linux-x64@* \
      node_modules/.bun/@img+sharp-linux-x64@* \
      node_modules/.bun/typescript@* \
      node_modules/.bun/drizzle-kit@* \
      node_modules/.bun/@esbuild+* \
      node_modules/.bun/esbuild@* \
      node_modules/.bun/@types+* \
      node_modules/.bun/bun-types@* \
      node_modules/typescript node_modules/drizzle-kit node_modules/@types \
      apps/web/.next/cache \
      apps/web/tsconfig.tsbuildinfo \
 && du -sh node_modules

# ─────────────────────────────────────────────────────────────
# Runtime
# ─────────────────────────────────────────────────────────────
FROM base AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# Cópias dirigidas, na ordem em que menos mudam. Os node_modules de cada
# workspace (`apps/*/node_modules`, `packages/*/node_modules`) vão junto de
# propósito: no layout do Bun é lá que ficam os links que fazem `next` e
# `drizzle-orm` resolverem — a raiz só tem o depósito.
COPY --from=build --chown=bun:bun /app/node_modules node_modules
COPY --from=build --chown=bun:bun /app/package.json /app/bun.lock /app/tsconfig.json ./
COPY --from=build --chown=bun:bun /app/packages packages
COPY --from=build --chown=bun:bun /app/seeds seeds
COPY --from=build --chown=bun:bun /app/apps apps

USER bun
EXPOSE 3000

# A imagem não traz curl nem wget — o healthcheck usa o runtime que ela já tem.
#
# Ele lê e parseia o corpo, não só o cabeçalho, e isso não é zelo: em 11/08/2026
# o servidor passou 26 h entregando apenas o primeiro buffer de cada resposta
# dinâmica e travando — a página chegava pela metade e nunca fechava. O
# healthcheck de então olhava só `r.ok` e respondeu saudável em 130 ms durante o
# apagão inteiro, porque o cabeçalho sai antes da falha e o corpo é que morre.
#
# `r.json()` cobre os dois modos de morte: corpo truncado não parseia, e corpo
# pendurado estoura o --timeout — que o Docker conta como falha.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||3000)+'/api/resultados').then(r=>r.ok?r.json():Promise.reject()).then(j=>process.exit(j&&j.ano&&Array.isArray(j.tabela)?0:1)).catch(()=>process.exit(1))"

# O compose declara o comando de cada serviço; este é o padrão para quem rodar
# a imagem na mão.
WORKDIR /app/apps/web
CMD ["bun", "--bun", "next", "start"]
