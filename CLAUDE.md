# CLAUDE.md

## Contexto do projeto

Este é um projeto pequeno e antigo de bolão do Brasileirão baseado em:

- Node.js com Express 4
- Views em Pug
- CSS e JS estáticos sem build step
- Redis como cache obrigatório
- Scraping da tabela atual do Brasileirão

O código principal fica em `bolao-max-server/`.

## Primeiro lugar para olhar

- `README.md`
- `bolao-max-server/app.js`
- `bolao-max-server/routes/index.js`
- `bolao-max-server/helper/regras.bolao.js`
- `bolao-max-server/atualiza-redis.js`
- `docker-compose.yaml`

## Como pensar mudanças aqui

- Faça o mínimo necessário para resolver o problema.
- Preserve o estilo atual em CommonJS.
- Evite modernizações amplas sem solicitação explícita.
- Assuma que a simplicidade do projeto é intencional.

## Fluxo funcional

1. O app sobe e conecta no Redis.
2. `atualiza-redis.js` carrega a classificação externa do Brasileirão.
3. `regras.bolao.js` combina a classificação com `json/bolao.json`.
4. O resultado vai para a chave `bolao_mem`.
5. A rota `/` renderiza a tela usando esse cache.

Sem Redis, o sistema fica incompleto.

## Arquivos que merecem cuidado extra

### `bolao-max-server/json/bolao.json`

É a base de dados ativa do bolão. Mudanças aqui afetam a produção.

### `bolao-max-server/helper/regras.bolao.js`

Contém desempates, cálculo de pontos e prêmios. Pequenas alterações mudam o ranking final.

### `bolao-max-server/helper/campeonato-brasileiro-modificado-chico.js`

Depende da estrutura HTML/JS de um site externo. Falhas podem não ser culpa do código local.

### `rebuild-docker.sh`

É destrutivo e faz `git reset --hard`. Não use sem autorização explícita.

## Comandos recomendados

### App local

```bash
cd bolao-max-server
npm install
PORT=3000 CACHE_URL=localhost CACHE_PORT=6399 CACHE_PW=eYVX7EwVmmxKPC-DmwMtyKVge8oLd2t82 npm start
```

### Redis local

```bash
docker compose -f bolao-max-server/localhost/docker-compose.yaml up -d
```

### Stack principal

```bash
docker compose up --build -d
```

## Inconsistências que não devem ser "corrigidas" automaticamente

Há diferença entre configurações de Redis:

- `app.js`: porta `6399`, senha final `82`
- `docker-compose.yaml`: porta `6379`, senha final `81`
- `bolao-max-server/localhost/docker-compose.yaml`: porta `6399`, senha final `82`

Se a tarefa tocar em ambiente, deploy ou cache, confirme primeiro qual arquivo é a fonte de verdade.

## Preferências de implementação

- Mantenha funções e módulos no estilo já usado.
- Não introduza dependências novas sem necessidade real.
- Se editar Pug, preserve a estrutura atual simples e server-rendered.
- Se editar CSS, mantenha compatibilidade desktop/mobile já separada em dois arquivos.

## Validação mínima esperada

- Rodar `node --check` nos arquivos JS alterados.
- Se houver mudança funcional, testar `/` e `/resultados` com Redis ativo.
- Se houver mudança em regra, validar ranking e critérios de desempate.
- Se houver mudança em scraping, validar manualmente a resposta consumida.

## Notas de segurança e operação

- Existem credenciais versionadas no repositório; não replique esse padrão em novos arquivos.
- Não remova logs ou mudanças operacionais sem motivo forte.
- Não assuma cobertura de testes automatizados; ela não existe hoje.
