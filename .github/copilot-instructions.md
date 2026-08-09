# GitHub Copilot Instructions

## Project summary

This repository contains a small Node.js/Express application for the "Bolao do Max" Brasileirao pool.

- Main app directory: `bolao-max-server/`
- Runtime: Node 14, CommonJS
- Views: Pug
- Frontend: static CSS and vanilla JS
- Cache: Redis is required for normal app behavior

## Key files

- `bolao-max-server/app.js`: Express bootstrap and Redis connection
- `bolao-max-server/routes/index.js`: `/` and `/resultados`
- `bolao-max-server/atualiza-redis.js`: cron-based cache refresh
- `bolao-max-server/helper/regras.bolao.js`: scoring, ranking, tiebreakers, prizes
- `bolao-max-server/helper/campeonato-brasileiro-modificado-chico.js`: external scraping
- `bolao-max-server/json/bolao.json`: active pool data

## Coding expectations

- Keep changes small and targeted.
- Preserve CommonJS module style.
- Do not introduce TypeScript, build tools, or framework migrations unless explicitly requested.
- Avoid broad reformatting in legacy files.
- Treat `bolao-max-server/json/bolao.json` as production data.

## Redis and environment caveat

There is a real configuration mismatch across the repo:

- `app.js` fallback uses port `6399` and password ending in `82`
- root `docker-compose.yaml` uses port `6379` and password ending in `81`
- `bolao-max-server/localhost/docker-compose.yaml` uses port `6399` and password ending in `82`

Do not auto-normalize these values without confirming the target environment.

## Validation guidance

- Prefer `node --check` for changed JavaScript files.
- If behavior changes, test with Redis running.
- If you modify scoring rules, verify ranking and tiebreakers.
- If scraping changes, verify the external source format before changing business logic.

## Safety constraints

- Never use or suggest `rebuild-docker.sh` casually; it runs `git reset --hard` and prunes Docker data.
- Do not add new secrets to the repository.
- Do not rename or replace `bolao-max-server/json/bolao.json` without updating the full data flow.
