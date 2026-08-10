#!/usr/bin/env bun
/**
 * Backup do banco de produção para uma pasta local, fora do servidor.
 *
 *   bun run backup                     dump agora → infra/backups/
 *   bun run backup --do-servidor       puxa o dump que o servidor já gerou
 *   bun run backup --listar            o que existe aqui e lá
 *   bun run backup --instalar-cron     agenda diário às 3h nesta máquina
 *   bun run backup --remover-cron
 *
 * Por que a cópia local importa, sabendo que o servidor já tem backup próprio:
 * o `banco-backup.timer` da máquina grava em /opt/banco/backups, no MESMO disco
 * do banco. Serve para erro humano — apagar tabela, migration ruim — e não
 * serve para perda do servidor. Um backup que mora junto do original é meio
 * backup. Este script faz a outra metade.
 *
 * Dois modos, e a diferença é quem paga o dump:
 *
 *   fresco   `pg_dump` na hora. Independe do agendamento do servidor e traz o
 *            estado exato do momento. Custa um dump de ~10 MB.
 *   servidor Puxa o arquivo que o timer das 03:20 já produziu. Zero carga no
 *            banco, mas a cópia tem a idade do último ciclo.
 *
 * O formato é o custom do pg_dump (-Fc): já vem comprimido, permite restaurar
 * tabela por tabela e é o mesmo que o script do servidor usa — um dump daqui
 * pode ser restaurado lá e vice-versa.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RAIZ,
  Servidor,
  agora,
  apagado,
  aviso,
  carregarParametros,
  erro,
  etapa,
  info,
  local,
  localTentar,
  negrito,
  ok,
  seco,
  tamanho,
} from './comum.ts'

const p = carregarParametros()
const PASTA = resolve(RAIZ, p.backup.pasta_local)
const tem = (f: string) => Bun.argv.includes(`--${f}`)
const s = new Servidor(p)

// ─────────────────────────────────────────────────────────────

type Arquivo = { nome: string; caminho: string; bytes: number; data: Date }

function locais(): Arquivo[] {
  mkdirSync(PASTA, { recursive: true })
  return readdirSync(PASTA)
    .filter((f) => f.endsWith('.dump'))
    .map((nome) => {
      const caminho = resolve(PASTA, nome)
      const st = statSync(caminho)
      return { nome, caminho, bytes: st.size, data: st.mtime }
    })
    .sort((a, b) => b.data.getTime() - a.data.getTime())
}

async function fazerBackup() {
  etapa(`backup de ${p.banco.nome} em ${p.servidor.host}`)

  const existe = await s.tentar(
    `docker exec ${p.banco.container} psql -U postgres -tAc ` +
      `"select 1 from pg_database where datname='${p.banco.nome}'"`,
  )
  if (existe.saida.trim() !== '1')
    erro(
      `o database '${p.banco.nome}' ainda não existe no servidor.\n` +
        `  Ele é criado no primeiro deploy — ou à mão:\n` +
        `      ssh ${s.endereco} /opt/banco/scripts/novo-banco.sh ${p.banco.nome}`,
    )

  mkdirSync(PASTA, { recursive: true })
  const modo = tem('do-servidor') ? 'servidor' : p.backup.modo
  let nome: string
  let bytes: Buffer

  if (modo === 'servidor') {
    const ultimo = await s.ler(
      `ls -1t ${p.backup.pasta_servidor}/${p.banco.nome}-*.dump 2>/dev/null | head -1 || true`,
    )
    if (!ultimo)
      erro(
        `nenhum dump de '${p.banco.nome}' em ${p.backup.pasta_servidor}.\n` +
          `  O timer do servidor só inclui o banco depois que ele existe.\n` +
          `  Use o modo fresco: bun run backup (com backup.modo: fresco)`,
      )
    info(`puxando ${ultimo}`)
    bytes = await s.baixarBytes(ultimo)
    nome = `${ultimo.split('/').pop()!.replace('.dump', '')}-doservidor.dump`
  } else {
    info(`pg_dump -Fc no container ${p.banco.container}`)
    if (seco) {
      info('[seco] o dump não seria baixado')
      return
    }
    bytes = await s.capturarBytes(
      `docker exec ${p.banco.container} pg_dump -U postgres -Fc ${p.banco.nome}`,
    )
    nome = `${p.banco.nome}-${agora()}.dump`
  }

  if (seco) return info(`[seco] gravaria ${nome}`)

  // Cabeçalho do formato custom. Um dump truncado por conexão caída chega aqui
  // como arquivo plausível; sem esta checagem, o problema só apareceria no dia
  // do restore.
  if (bytes.subarray(0, 5).toString() !== 'PGDMP')
    erro(`o que chegou não é um dump do pg_dump (${tamanho(bytes.length)}) — nada foi gravado`)

  const caminho = resolve(PASTA, nome)
  writeFileSync(caminho, bytes)
  const soma = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  writeFileSync(`${caminho}.sha256`, `${soma}  ${nome}\n`)
  ok(`${nome} · ${tamanho(bytes.length)}`)
  info(`sha256 ${soma.slice(0, 16)}…`)

  await conferirConteudo(caminho)
  aposentar()
  await olharServidor()

  console.log(`\n${negrito('pronto')} — ${PASTA}`)
  console.log(apagado(`  restaurar no banco local:  bun run restaurar`))
}

/**
 * Lê o índice do dump com `pg_restore -l`.
 *
 * Prova que o arquivo é legível e traz as tabelas esperadas, em vez de confiar
 * no tamanho. Usa o container de desenvolvimento porque é onde há cliente
 * PostgreSQL 17 — se ele estiver parado, o teste é pulado com aviso, não
 * silenciosamente.
 */
async function conferirConteudo(caminho: string) {
  const ping = await localTentar(['docker', 'exec', 'bolao-dev-postgres', 'pg_restore', '--version'])
  if (ping.codigo !== 0)
    return aviso('container bolao-dev-postgres parado: índice do dump não conferido')

  const r = await localTentar([
    'sh',
    '-c',
    `docker exec -i bolao-dev-postgres pg_restore -l < '${caminho}'`,
  ])
  if (r.codigo !== 0) erro(`pg_restore não conseguiu ler o índice do dump:\n${r.erroSaida.trim()}`)

  const tabelas = [...r.saida.matchAll(/TABLE DATA public (\w+)/g)].map((m) => m[1]!)
  const esperadas = ['partida', 'snapshot', 'snapshot_competidor', 'aposta_classico', 'temporada']
  const faltando = esperadas.filter((t) => !tabelas.includes(t))
  ok(`índice legível · ${tabelas.length} tabelas com dado`)
  if (faltando.length) aviso(`sem dado: ${faltando.join(', ')} — banco recém-criado?`)
}

/** Apaga o que venceu, preservando um piso. Retenção nunca deixa zero cópias. */
function aposentar() {
  const todos = locais()
  const limite = Date.now() - p.backup.retencao_dias * 86_400_000
  const candidatos = todos.slice(p.backup.minimo_guardado).filter((a) => a.data.getTime() < limite)
  for (const a of candidatos) {
    unlinkSync(a.caminho)
    try {
      unlinkSync(`${a.caminho}.sha256`)
    } catch {
      /* sidecar pode não existir em backup antigo */
    }
  }
  const restantes = locais()
  info(
    `${restantes.length} cópias locais · ${tamanho(restantes.reduce((t, a) => t + a.bytes, 0))}` +
      (candidatos.length ? ` · ${candidatos.length} vencidas removidas` : ''),
  )
}

/** O agendamento do servidor é a primeira linha de defesa; vale saber se vive. */
async function olharServidor() {
  const r = await s.tentar(
    `systemctl list-timers banco-backup.timer --no-pager 2>/dev/null | sed -n 2p`,
  )
  if (!r.saida.trim()) return aviso('o servidor não tem banco-backup.timer ativo')
  const ultimo = await s.tentar(
    `ls -1t ${p.backup.pasta_servidor}/${p.banco.nome}-*.dump 2>/dev/null | head -1 || true`,
  )
  info(`servidor: timer ativo${ultimo.saida ? `, último ${ultimo.saida.split('/').pop()}` : ''}`)
}

async function listar() {
  etapa('cópias nesta máquina')
  const todos = locais()
  if (!todos.length) info('nenhuma ainda')
  for (const a of todos)
    console.log(
      `  ${a.data.toLocaleString('pt-BR')}  ${tamanho(a.bytes).padStart(9)}  ${a.nome}`,
    )
  if (todos.length)
    info(`${todos.length} cópias · ${tamanho(todos.reduce((t, x) => t + x.bytes, 0))} · ${PASTA}`)

  etapa(`cópias em ${p.servidor.host}`)
  const remoto = await s.tentar(
    `ls -lht ${p.backup.pasta_servidor}/${p.banco.nome}-*.dump 2>/dev/null | head -10 || true`,
  )
  if (!remoto.saida.trim()) info('nenhuma — o database ainda não existe ou o timer não rodou')
  else for (const l of remoto.saida.split('\n')) console.log(`  ${l}`)
  await olharServidor()
}

// ─────────────────────────────────────────────────────────────
// Agendamento
// ─────────────────────────────────────────────────────────────

const MARCA_INICIO = '# >>> bolao-do-max: backup do banco de produção'
const MARCA_FIM = '# <<< bolao-do-max'

function crontabAtual(): string {
  const r = Bun.spawnSync(['crontab', '-l'], { stdout: 'pipe', stderr: 'pipe' })
  return r.exitCode === 0 ? r.stdout.toString() : ''
}

function semNosso(texto: string): string[] {
  const linhas = texto.split('\n')
  const saida: string[] = []
  let dentro = false
  for (const l of linhas) {
    if (l.startsWith(MARCA_INICIO)) dentro = true
    else if (dentro && l.startsWith(MARCA_FIM)) dentro = false
    else if (!dentro) saida.push(l)
  }
  return saida
}

async function instalarCron() {
  etapa('agendamento nesta máquina')

  const bun = await local(['sh', '-c', 'command -v bun'], { silencioso: true })
  if (!bun) erro('não achei o bun no PATH — o cron precisa do caminho absoluto')

  const log = resolve(PASTA, 'backup.log')
  mkdirSync(PASTA, { recursive: true })

  const linha =
    `${p.backup.cron} cd ${RAIZ} && ${bun} run infra/bin/backup.ts >> ${log} 2>&1`

  const novo = [
    ...semNosso(crontabAtual()).filter((l, i, a) => !(l === '' && a[i + 1] === undefined)),
    MARCA_INICIO,
    `# Instalado por infra/bin/backup.ts --instalar-cron. Remova com --remover-cron.`,
    linha,
    MARCA_FIM,
    '',
  ].join('\n')

  if (seco) {
    info('[seco] instalaria:')
    console.log(apagado(`    ${linha}`))
    return
  }

  await local(['crontab', '-'], { entrada: novo })
  ok(`cron instalado: ${p.backup.cron}`)
  info(`comando  ${linha}`)
  info(`log      ${log}`)

  const servico = await localTentar(['systemctl', 'is-active', 'cron'])
  if (servico.saida.trim() !== 'active')
    aviso('o serviço cron não está ativo nesta máquina — o agendamento não vai disparar')
  else ok('serviço cron ativo')

  console.log(
    apagado(
      `\nEsta máquina desligada às 3h significa um dia sem cópia local — o cron não\n` +
        `recupera horário perdido. A rede de segurança para isso é o servidor, que\n` +
        `roda o próprio backup às 03:20 com Persistent=true e recupera. As duas\n` +
        `juntas cobrem tanto máquina desligada quanto servidor perdido.`,
    ),
  )
}

function removerCron(): void {
  etapa('removendo agendamento')
  const atual = crontabAtual()
  if (!atual.includes(MARCA_INICIO)) return info('não havia agendamento nosso')
  if (seco) return info('[seco] removeria o bloco do crontab')
  const r = Bun.spawnSync(['crontab', '-'], {
    stdin: Buffer.from(semNosso(atual).join('\n')),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  if (r.exitCode !== 0) erro(`crontab falhou: ${r.stderr.toString()}`)
  ok('agendamento removido')
}

// ─────────────────────────────────────────────────────────────
// Despacho
// ─────────────────────────────────────────────────────────────
//
// No fim do arquivo de propósito: as marcas do crontab são `const`, e chamar
// `instalarCron()` antes delas serem inicializadas dá erro de zona morta —
// declaração de função sobe, `const` não.
try {
  if (tem('listar')) await listar()
  else if (tem('instalar-cron')) await instalarCron()
  else if (tem('remover-cron')) removerCron()
  else await fazerBackup()
} finally {
  s.fechar()
}
