# infra/

Deploy, backup e restore do Bolão do Max novo. Roteiro completo, com o que já foi
verificado: [`docs/_atual/deploy.e.backup.md`](../docs/_atual/deploy.e.backup.md).

```
deploy.yml               parâmetros — versionado, sem segredo nenhum
deploy.local.yml         sobrescritas suas (gitignored)
Dockerfile               imagem única: web e worker
Dockerfile.dockerignore  contexto próprio, para não quebrar o build do bolão atual
compose.prod.yml         vira /opt/bolao-do-max/compose.yml no servidor
bin/comum.ts             YAML, ssh, rsync, saída
bin/deploy.ts            constrói aqui, envia o delta, sobe lá
bin/backup.ts            dump de produção → backups/  (+ cron diário às 3h)
bin/restaurar.ts         backup → banco local ou produção
bin/worker.ts            aciona o worker sem esperar a cadência
backups/                 cópias do banco (gitignored)
.cache/                  tar da imagem para envio por delta (gitignored)
```

```bash
bun run deploy --dry-run   # o plano inteiro, sem tocar em nada
bun run deploy
bun run deploy --versoes
bun run deploy --reverter

# Só os Sites do Caddy (infra/caddy/*.caddy), sem recriar container.
bun run deploy --so-sites
# Reinstala e recarrega mesmo quando o servidor já está igual ao git.
bun run deploy --refazer-site

bun run backup
bun run backup --listar
bun run backup --instalar-cron

bun run restaurar
bun run restaurar --destino=producao --confirmar=producao

bun run worker:remoto ciclo
bun run worker:remoto completar
bun run worker:remoto logs -n 50

bun run tunel              # 127.0.0.1:35132 → o Postgres de produção
bun run tunel --verificar  # só a auditoria de exposição
```

Três coisas que valem saber antes de mexer:

**O bolão antigo foi desligado em 10/08/2026, não apagado.** Código, imagens e
`dump.rdb` continuam no servidor, e o retorno está no §9 do runbook.

**Segredo não vem daqui.** As senhas do banco e do cache são geradas pelo próprio
servidor (`/opt/banco/scripts/novo-banco.sh`, `/opt/cache/scripts/novo-cache.sh`)
e lidas na hora do deploy. As chaves das APIs vêm do `.env` da sua máquina. O
`.env` de produção é escrito em modo 600 pela entrada padrão do ssh — não passa
pelo disco daqui.

**Os Sites do Caddy moram aqui, em `infra/caddy/`.** O deploy copia
`bolao-novo.maxmat1.com.br.caddy` (domínio de convivência) e
`bolao.maxmat1.com.br.caddy` (produção) para `/etc/caddy/sites/`, roda
`caddy validate` e `systemctl reload caddy`; se o validate reprovar, o arquivo
anterior volta ao lugar antes do reload. O certificado é do próprio Caddy
(HTTP-01), sem passo de certbot. Os snippets que os Sites importam (`log`,
`limite`, `senha`) ficam no Caddyfile base, no repositório de infraestrutura da
VPS. Não há mais teto de requisições por script (`--limites`): se for preciso,
é `import limite` no Site.

**O banco não tem porta na internet.** `bun run tunel --verificar` prova isso
tentando conectar de fora antes de abrir qualquer coisa.
