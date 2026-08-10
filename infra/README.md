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

bun run backup
bun run backup --listar
bun run backup --instalar-cron

bun run restaurar
bun run restaurar --destino=producao --confirmar=producao

bun run worker:remoto ciclo
bun run worker:remoto completar
bun run worker:remoto logs -n 50
```

Três coisas que valem saber antes de mexer:

**Nada aqui toca o bolão atual.** Pasta, rede, porta, domínio e Redis são outros.
Antes da virada do nginx, voltar atrás é não fazer nada.

**Segredo não vem daqui.** As senhas do banco e do cache são geradas pelo próprio
servidor (`/opt/banco/scripts/novo-banco.sh`, `/opt/cache/scripts/novo-cache.sh`)
e lidas na hora do deploy. As chaves das APIs vêm do `.env` da sua máquina. O
`.env` de produção é escrito em modo 600 pela entrada padrão do ssh — não passa
pelo disco daqui.

**O nginx é manual.** Aquela máquina serve nove vhosts. Nenhum script deste
repositório mexe neles.
