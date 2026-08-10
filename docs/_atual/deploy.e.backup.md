# Deploy, backup e restore — Bolão do Max novo

Roteiro operacional dos quatro scripts de `infra/`. Todos leem os mesmos
parâmetros de [`infra/deploy.yml`](../../infra/deploy.yml) e nenhum tem endereço
ou senha embutidos.

> **No ar em <https://bolao-novo.maxmat1.com.br>** desde 10/08/2026, em
> convivência. O bolão atual continua em `bolao.maxmat1.com.br`, na porta 5001,
> com o Redis 7.2 e o dado dele — **intocado**. A virada de domínio é um passo
> separado e depende da sua autorização.

Primeiro deploy executado em 10/08/2026: 134 MB no fio, banco criado e semeado,
vhost e certificado emitidos, `GET /` 200 por HTTPS de fora.

---

## 1. Os quatro comandos

| Comando | O que faz |
|---|---|
| `bun run deploy` | Constrói a imagem aqui, envia só o que mudou, migra, semeia e sobe |
| `bun run backup` | Dump do banco de produção para `infra/backups/` (fora do servidor) |
| `bun run restaurar` | Último backup → banco local; ou produção, com confirmação |
| `bun run worker:remoto <ação>` | Aciona o worker no servidor sem esperar a cadência |

Todos aceitam `--dry-run`, que mostra o plano inteiro sem tocar em nada.

---

## 2. Primeiro deploy

```bash
bun run deploy --dry-run    # confere servidor, redes, portas, .env — sem efeito
bun run deploy              # de verdade
```

O que acontece, em ordem:

| # | Passo | Detalhe |
|---|---|---|
| 1 | Verificação prévia | ssh, docker, redes `rede-banco`/`rede-cache`, containers `banco` e `cache`, porta 5002 livre, disco |
| 2 | Banco e cache do projeto | Chama `/opt/banco/scripts/novo-banco.sh bolao` e `/opt/cache/scripts/novo-cache.sh bolao` — idempotentes — e **lê** as credenciais que o servidor gerou |
| 3 | `.env` de produção | Montado em memória, validado pelo mesmo zod do boot, escrito em modo 600 pela entrada padrão do ssh |
| 4 | Imagem | `docker build` aqui; 626 MB em disco, 134 MB no fio |
| 5 | Envio | `docker save` → rsync com delta → `docker load` |
| 6 | Banco | `migrate`, `seed`, `seed-dados`, `ciclo` — **antes** de subir os serviços |
| 7 | Subida | `docker compose up -d`, espera o healthcheck |
| 8 | nginx e TLS | Vhost de `bolao-novo.maxmat1.com.br` + certbot |
| 9 | Conferência | `GET /` e `/api/resultados` por dentro, `https://` por fora, log do worker |
| 10 | Limpeza | Guarda as 3 últimas versões para poder voltar |

Um comando, do build ao HTTPS. Nada de túnel para ver no celular.

### O passo de nginx, e o que ele não faz

Ele publica o vhost do **domínio de convivência** e nada mais. O vhost de
`bolao.maxmat1.com.br` não é lido nem escrito — a virada é um passo separado,
descrito em §9.

Três travas, na ordem em que importam:

1. **DNS conferido primeiro.** Sem o apontamento, o certbot falha com um erro de
   validação que não explica a causa.
2. **`nginx -t` antes do reload.** Reprovando, o link simbólico sai antes de
   qualquer coisa recarregar, e o teste roda de novo para provar que voltou ao
   estado anterior. Configuração inválida ativada derruba os nove vhosts da
   máquina, não só o nosso.
3. **Vhost existente é preservado.** O certbot escreve nele ao emitir o
   certificado; reescrever do modelo apagaria o bloco TLS. `--refazer-vhost`
   força, guardando uma cópia `.antes-do-deploy`.

O upstream se chama `bolao_novo` porque o vhost atual já declara
`upstream maxmat1` — nome repetido faz o nginx recusar a configuração inteira.

Para pular o passo: `bun run deploy --sem-nginx`.

### Por que a imagem é construída aqui

O servidor tem 2 vCPU e 2,8 GB livres com oito containers de outros projetos.
`next build` ali competiria com os vizinhos. O que viaja é imagem pronta.

O envio é por **rsync sobre o mesmo arquivo tar**, sempre com o mesmo nome nas
duas pontas. Do segundo deploy em diante sobem só os blocos que mudaram. O preço
é um `imagem.tar` de 134 MB parado em cada ponta — 47 GB livres lá, sobra de
sobra.

Os dois números da imagem são diferentes e os dois são verdade: 626 MB é o que
ela ocupa descomprimida no depósito do Docker, 134 MB é o que o `docker save`
produz e o que viaja. O primeiro deploy real transferiu os 134 MB em 4,5 s.

### Retorno

```bash
bun run deploy --versoes     # o que está carregado e o que está no ar
bun run deploy --reverter    # volta para a anterior
```

O retorno reescreve uma linha (`BOLAO_VERSAO`) no `.env` do servidor e recria os
containers. **O banco não é tocado** — só a imagem que o lê.

| Falha | Retorno | Custo |
|---|---|---|
| Antes da virada de domínio | Nenhuma ação: o antigo nunca parou | zero |
| Depois da virada | Reverter uma linha do upstream e recarregar o nginx | segundos |
| Imagem ruim | `bun run deploy --reverter` | um minuto |
| Dado ruim | `bun run restaurar --destino=producao` | minutos |

---

## 3. Backup

### O que já existia no servidor

A máquina tem `banco-backup.timer` do systemd, **todo dia às 03:20**, rodando
`/opt/banco/scripts/backup.sh`: um `pg_dump -Fc` por database, mais os globals,
com retenção de 14 dias em `/opt/banco/backups`. Tem `Persistent=true`, então
recupera horário perdido se a máquina estiver desligada — coisa que cron não faz.

Assim que o database `bolao` existir, ele entra nesse backup **sem nenhuma
configuração nossa**: o script varre `pg_database`. Hoje aquela pasta só tem
`globals-*.sql.gz` porque o único database é o `postgres`, que o script exclui.

### O que faltava, e é o que este script faz

Aquele backup mora no **mesmo disco** do banco. Serve para erro humano; não
serve para perda do servidor. Um backup que mora junto do original é meio
backup.

```bash
bun run backup                  # dump agora → infra/backups/ (gitignored)
bun run backup --do-servidor    # puxa o dump que o timer já fez, sem carga no banco
bun run backup --listar         # o que existe aqui e lá
```

Cada cópia baixada passa por três conferências antes de contar como backup:

1. **Cabeçalho `PGDMP`** — dump truncado por conexão caída chega como arquivo
   plausível; sem isso o problema só apareceria no dia do restore
2. **`sha256` num arquivo ao lado** — conferido de novo na hora de restaurar
3. **Índice lido com `pg_restore -l`** — prova que as tabelas esperadas têm dado

Retenção: 30 dias, com piso de 7 cópias. Nunca fica sem nada guardado.

### Agendamento diário às 3h

```bash
bun run backup --instalar-cron   # já instalado em 10/08/2026
bun run backup --remover-cron
```

```
0 3 * * * cd <repo> && bun run infra/bin/backup.ts >> infra/backups/backup.log 2>&1
```

Roda **nesta máquina**, porque é aqui que `infra/backups/` existe. O bloco é
marcado no crontab e reinstalar não duplica.

As duas metades cobrem coisas diferentes, e vale saber qual é qual:

| | Onde grava | Cobre | Não cobre |
|---|---|---|---|
| Timer do servidor, 03:20 | `/opt/banco/backups` | Erro humano, migration ruim | Perda do servidor |
| Cron desta máquina, 03:00 | `infra/backups/` | Perda do servidor | Esta máquina desligada às 3h |

O cron não recupera horário perdido. Máquina desligada às 3h = um dia sem cópia
local, e o `bun run backup` na mão resolve.

Primeira cópia real tirada em 10/08/2026, depois do deploy: **107 KB**, 14
tabelas com dado no índice. O banco inteiro do bolão cabe num anexo de e-mail —
o backup não é despesa, é hábito.

---

## 4. Restore

```bash
bun run restaurar                                   # último backup → banco local
bun run restaurar --banco=rascunho                  # num database separado
bun run restaurar --arquivo=infra/backups/x.dump
bun run restaurar --destino=producao --confirmar=producao
bun run restaurar --completar                       # e aciona o worker no fim
```

Três travas, em ordem de importância:

1. **`sha256`** conferido antes de qualquer coisa
2. **Confirmação com o nome do alvo** — não existe restore em produção por erro
   de digitação, e sobrescrever banco local com dado também pede `--confirmar=local`
3. **Dump de segurança antes**, em produção, pelo mesmo caminho verificado do
   backup normal

Em produção o dump entra pela entrada padrão do `docker exec`: não fica cópia no
disco do servidor. `web` e `worker` param antes e sobem depois, no `finally` —
falhar no meio não deixa o site fora do ar.

---

## 5. Acionar o worker

```bash
bun run worker:remoto ciclo         # um ciclo agora
bun run worker:remoto completar     # traz o dado do dump até agora
bun run worker:remoto logs -n 50
bun run worker:remoto estado
bun run worker:remoto reiniciar
bun run worker:remoto ciclo --alvo=local
```

`completar` é o par do restore, e a ordem não é óbvia:

| # | Passo | Por quê |
|---|---|---|
| 1 | Para o worker residente | Dois processos apurando a mesma temporada embaralham log e disputam cota |
| 2 | `seed-dados` | Partidas e série versionadas, de graça |
| 3 | Calendário completo | 38 rodadas: pega remarcação e placar novo |
| 4 | Replay dos snapshots | Preenche o buraco entre o dump e agora **a partir das partidas** — sem inventar ponto |
| 5 | Um ciclo | Apura, snapshota, publica cache, pré-renderiza |
| 6 | Religa o residente | No `finally`: falha no meio não deixa o worker parado |

Cada passo é idempotente por conta própria — partidas por chave natural,
snapshots por hash. Rodar de novo em caso de dúvida é seguro.

---

## 6. Seed de dados — o banco novo nasce em dia

```bash
bun run seeds:exportar      # banco → seeds/partidas/ e seeds/snapshots/
bun run db:seed:dados       # seeds/ → qualquer banco
```

`db:seed` carrega o que é **entrada** do bolão: apostas, identidades, clubes.
`db:seed:dados` carrega o que é **resultado**: as 380 partidas com placar e
horário, e os 146 snapshots da série.

| Arquivo | Conteúdo | Tamanho |
|---|---|---|
| `seeds/partidas/2026.json` | 380 partidas | 93 KB |
| `seeds/snapshots/2026.json` | 146 snapshots · 2.920 linhas de clube · 4.380 de competidor | 309 KB |

Sem isso, um banco novo faria o worker varrer 38 rodadas no GE e replayar a
temporada inteira só para chegar onde estes dois arquivos já estão. Com isso, o
primeiro ciclo em produção só precisa olhar a rodada corrente.

Chaves naturais, nunca ids: `(temporada, rodada, mandante, visitante)` e
`(temporada, hash)` significam a mesma coisa em qualquer banco. Uma linha por
registro no arquivo, para o diff do git ser proporcional à mudança.

**Ida e volta conferida**: banco de desenvolvimento → JSON → banco vazio → JSON
devolve arquivo **byte a byte idêntico**. E o import é idempotente: a segunda
passada grava zero e não cria nenhuma linha em `partida_alteracao`.

### Uma diferença esperada entre os dois bancos

Um banco recém-semeado tem **menos linhas de alias** que o de desenvolvimento:

| Tabela | Desenvolvimento | Recém-semeado | Por quê |
|---|---|---|---|
| `clube_alias` | 223 | 81 | O resolvedor aprende apelido de fonte em tempo de execução e grava |
| `competidor_alias` | 26 | 21 | Cinco auto-apelidos sobraram de uma versão anterior de `identidades.json` |
| `fonte_chamada` | 6 | 0 | Registro operacional de chamada de API — não é dado do bolão |

Nada disso é perda. Os apelidos aprendidos são derivados: no primeiro ciclo de
reconciliação o resolvedor os aprende de novo, sem uma requisição extra. Está
aqui documentado para a comparação lado a lado da virada não parecer defeito.

---

## 7. Parâmetros

Tudo em [`infra/deploy.yml`](../../infra/deploy.yml), versionado e **sem segredo
nenhum**. As senhas vêm de dois lugares, nenhum deles o git:

| Segredo | De onde vem |
|---|---|
| `DATABASE_URL` | `/opt/banco/credenciais/bolao.env`, gerado pelo servidor |
| `REDIS_URL` | `/opt/cache/credenciais/bolao.env`, gerado pelo servidor |
| Chaves das APIs | `.env` desta máquina (gitignored) |

Para mudar qualquer parâmetro sem sujar o git: `infra/deploy.local.yml` com só as
chaves que quiser sobrescrever — também gitignored.

A ACL do Redis compartilhado só libera chaves com o prefixo `bolao:`, e o deploy
recusa subir se `cache.prefixo` não começar com `cache.nome:` — senão toda
escrita daria erro de permissão, e só em produção.

---

## 8. O que já foi verificado

| Verificação | Resultado |
|---|---|
| Imagem construída e rodando com Postgres e Redis reais | `/` 200 · 169 KB · `/api/resultados` com Alan 1º e 146 pontos |
| Fuso dentro do container | `-03`, tzdata instalado — sem isso tudo raciocinaria em UTC |
| Healthcheck do compose | `healthy` |
| `migrate`, `seed-dados` e um ciclo completo **de dentro da imagem** | ciclo em 934 ms · cache publicado · 60 detalhes + 6 séries |
| Peso da imagem | 1,67 GB → **626 MB** (poda de binários de outra libc e de ferramenta de autoria) |
| `deploy --dry-run` contra o servidor | Verificação prévia inteira passa; `.env` de produção validado pelo zod |
| **Primeiro deploy real** | 134 MB enviados em 4,5 s · 380 partidas e 146 snapshots semeados · healthcheck `healthy` |
| **HTTPS de fora** | `https://bolao-novo.maxmat1.com.br/` 200, certificado válido, `http` redireciona |
| **O atual depois do deploy** | `https://bolao.maxmat1.com.br/` 200, 220 KB — a mesma página de antes |
| Backup completo contra um database real | dump → download → `PGDMP` → sha256 → índice → retenção |
| Restore com dado real | 146 snapshots chegaram no banco de destino |
| Trava de dump corrompido | recusado com as duas somas na tela |
| Trava de sobrescrita sem confirmar | recusada |
| `worker completar` na sequência inteira | 4 passos, todos idempotentes na segunda passada |
| Testes e tipos | 39 testes · 539 asserções · typecheck limpo nos dois projetos |

---

## 9. A virada, quando você autorizar

O novo está no ar em <https://bolao-novo.maxmat1.com.br> e o atual segue em
`bolao.maxmat1.com.br`. Os dois lado a lado, pelo tempo que você quiser.

A virada é **uma linha** em `/etc/nginx/sites-available/bolao.maxmat1.com.br`:

```nginx
upstream maxmat1 {
	server localhost:5001 weight=1;   # ← passa para 5002
}
```

E depois `nginx -t && systemctl reload nginx`. Voltar é a mesma linha ao
contrário, com o mesmo reload: segundos, e o stack antigo nunca parou.

Nenhum script deste repositório faz isso sozinho. Me peça quando quiser.

Depois da virada, ainda em aberto e sem pressa nenhuma:

1. **Desligar o stack antigo** (`/opt/bolao-maxmat1`, porta 5001, Redis 7.2
   próprio) — só com ordem explícita. Enquanto ele estiver de pé, o retorno é
   uma linha.
2. **Apagar o domínio de convivência**, se você não quiser manter os dois.
