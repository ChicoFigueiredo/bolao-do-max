# AGENTS.md

## Visão geral

Este repositório hospeda o **Bolão do Max**, um app Node.js/Express com views em Pug que mostra a classificação de um bolão do Brasileirão.

- App principal: `bolao-max-server/`
- Infra principal: `Dockerfile`, `docker-compose.yaml`, `apache/`
- Dados do bolão em uso: `bolao-max-server/json/bolao.json`
- Dados históricos: `bolao-max-server/json/bolao.<ano>.json` e planilhas `Bolao.<ano>.xlsx`

O sistema depende de:

1. Um servidor Redis para cache.
2. Um scraping da tabela do Brasileirão em `helper/campeonato-brasileiro-modificado-chico.js`.
3. Atualização recorrente do cache em `atualiza-redis.js`.

## Estrutura importante

- `bolao-max-server/app.js`: bootstrap do Express, conexão Redis e registro do job de atualização.
- `bolao-max-server/routes/index.js`: rota `/` e endpoint `/resultados`.
- `bolao-max-server/helper/regras.bolao.js`: cálculo de pontuação, ranking e prêmios.
- `bolao-max-server/helper/campeonato-brasileiro-modificado-chico.js`: scraping da classificação atual.
- `bolao-max-server/views/index.pug`: interface principal.
- `bolao-max-server/public/`: CSS e JS simples, sem bundler.

## Como trabalhar neste projeto

- Leia primeiro `README.md` e este arquivo antes de editar.
- Trate `bolao-max-server/` como a aplicação real. O `package.json` da raiz não define scripts úteis.
- Prefira mudanças pequenas e localizadas. O projeto é simples e acoplado.
- Preserve compatibilidade com CommonJS e Node 14, que é a base do `Dockerfile`.
- Não introduza TypeScript, bundlers ou refactors grandes sem pedido explícito.

## Comandos úteis

### Instalar dependências do app

```bash
cd bolao-max-server
npm install
```

### Subir Redis local isolado

```bash
docker compose -f bolao-max-server/localhost/docker-compose.yaml up -d
```

### Subir stack principal

```bash
docker compose up --build -d
```

### Rodar o app localmente

Defina as variáveis explicitamente. Não confie nos defaults sem checar o alvo:

```bash
cd bolao-max-server
PORT=3000 \
CACHE_URL=localhost \
CACHE_PORT=6399 \
CACHE_PW=eYVX7EwVmmxKPC-DmwMtyKVge8oLd2t82 \
npm start
```

## Armadilhas reais do repositório

### Redis com configurações divergentes

Há divergências entre os defaults e os arquivos de compose:

- `app.js` usa fallback `CACHE_PORT=6399` e senha terminando em `82`.
- `docker-compose.yaml` principal usa porta `6379` e senha terminando em `81`.
- `bolao-max-server/localhost/docker-compose.yaml` expõe `6399` e senha terminando em `82`.

Antes de corrigir ou padronizar isso, confirme com o usuário qual ambiente é a referência.

### Script destrutivo

`rebuild-docker.sh` executa:

- `git reset --hard origin/master`
- `docker system prune -f`

Nunca rode esse script nem replique esse comportamento sem autorização explícita.

### Cache é parte do fluxo

As rotas assumem Redis disponível. Sem cache populado, a UI não funciona corretamente.

- A chave principal é `bolao_mem`.
- O cache é atualizado no boot e por cron em `atualiza-redis.js`.

### Dependência externa frágil

O cálculo depende do HTML atual do Globo Esporte. Mudanças na página podem quebrar o scraping.

- Evite alterar o parser sem testar.
- Se algo falhar, valide primeiro se a origem externa mudou.

### Dados anuais

O código em produção lê `bolao-max-server/json/bolao.json`.

- Arquivos `bolao.<ano>.json` funcionam como histórico ou apoio.
- Ao atualizar o bolão de um ano novo, confirme com o usuário se `bolao.json` também deve ser sincronizado.

## Convenções de mudança

- Mantenha o estilo atual em JavaScript CommonJS.
- Evite reformatar arquivos inteiros sem necessidade.
- Não remova logs operacionais sem motivo.
- Em mudanças de regra, explique no PR ou no commit qual critério de pontuação foi alterado.
- Em mudanças de dados, preserve a estrutura já usada em `bolao.json`.

## Validação mínima

Este repositório não tem suíte de testes automatizada. Sempre que possível:

1. Faça checagem sintática dos arquivos JS alterados com `node --check`.
2. Se mexer em views ou rotas, suba Redis e teste `/` e `/resultados`.
3. Se mexer em `regras.bolao.js`, valide ranking, desempate e prêmios com um exemplo real.
4. Se mexer no scraping, valide o formato retornado por `cb.tabela('a')`.

## O que evitar por padrão

- Não versione novos segredos.
- Não troque portas, hostnames ou senhas do Redis sem alinhar o ambiente alvo.
- Não renomeie `bolao.json` sem atualizar o fluxo inteiro.
- Não assuma que os arquivos Azure/Apache estão obsoletos; eles ainda documentam deploy legado.

## Checklist antes de concluir

1. A mudança respeita Node 14 e CommonJS.
2. Redis continua atendendo o fluxo esperado.
3. `bolao-max-server/json/bolao.json` continua íntegro.
4. Nenhum script destrutivo foi usado.
5. O usuário recebeu aviso claro se houver risco em deploy, dados anuais ou credenciais.
