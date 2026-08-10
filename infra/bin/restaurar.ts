#!/usr/bin/env bun
/**
 * Restaura um backup — no banco local de desenvolvimento ou em produção.
 *
 *   bun run restaurar                             último backup → banco local
 *   bun run restaurar --banco=bolao_teste         num banco de rascunho
 *   bun run restaurar --arquivo=infra/backups/x.dump
 *   bun run restaurar --destino=producao --confirmar=producao
 *   bun run restaurar --completar                 e aciona o worker no fim
 *
 * Um restore é a única operação daqui que apaga dado de propósito, então tem
 * três travas, em ordem de importância:
 *
 *   1. **Confere o sha256** gravado junto do dump. Restaurar arquivo corrompido
 *      é trocar um banco bom por um banco quebrado.
 *   2. **Confirmação explícita** com o nome do alvo. Não existe restore em
 *      produção por engano de digitação.
 *   3. **Dump de segurança antes**, em produção. O estado que vai ser
 *      sobrescrito fica gravado antes de desaparecer.
 *
 * Depois do restore o banco tem o dado até a hora do dump. O que falta até agora
 * é trabalho do worker: `--completar` faz isso na sequência certa.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import {
  RAIZ,
  Servidor,
  apagado,
  aviso,
  carregarParametros,
  erro,
  etapa,
  exigirConfirmacao,
  info,
  local,
  localTentar,
  negrito,
  ok,
  seco,
  tamanho,
} from './comum.ts'
import { executar as acionarWorker } from './worker.ts'

const p = carregarParametros()
const PASTA = resolve(RAIZ, p.backup.pasta_local)

const opcao = (nome: string, padrao?: string) => {
  const a = Bun.argv.find((x) => x.startsWith(`--${nome}=`))
  return a ? a.split('=').slice(1).join('=') : padrao
}

const destino = opcao('destino', 'local')!
if (!['local', 'producao'].includes(destino)) erro(`--destino aceita local ou producao`)

const arquivo = escolherArquivo()
const s = destino === 'producao' ? new Servidor(p) : null

try {
  etapa(`restore em ${destino}`)
  info(`arquivo  ${basename(arquivo)} · ${tamanho(statSync(arquivo).size)}`)
  conferirSoma(arquivo)

  if (destino === 'producao') await paraProducao(arquivo)
  else await paraLocal(arquivo)

  if (Bun.argv.includes('--completar')) {
    await acionarWorker('completar', { p, s: destino === 'producao' ? s : null })
  } else {
    console.log(`\n${negrito('restaurado')} — o dado vai até a hora do dump.`)
    console.log(
      apagado(
        `  Para trazer até agora:  bun run worker:remoto completar` +
          `${destino === 'local' ? ' --alvo=local' : ''}`,
      ),
    )
  }
} finally {
  s?.fechar()
}

// ─────────────────────────────────────────────────────────────

function escolherArquivo(): string {
  const escolhido = opcao('arquivo')
  if (escolhido) {
    const caminho = resolve(RAIZ, escolhido)
    if (!existsSync(caminho)) erro(`não achei ${caminho}`)
    return caminho
  }
  if (!existsSync(PASTA)) erro(`${PASTA} não existe — rode \`bun run backup\` primeiro`)
  const dumps = readdirSync(PASTA)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => resolve(PASTA, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  if (!dumps.length) erro(`nenhum .dump em ${PASTA} — rode \`bun run backup\` primeiro`)
  return dumps[0]!
}

function conferirSoma(caminho: string) {
  const bytes = readFileSync(caminho)
  if (bytes.subarray(0, 5).toString() !== 'PGDMP')
    erro(`${basename(caminho)} não é um dump no formato custom do pg_dump`)

  const sidecar = `${caminho}.sha256`
  if (!existsSync(sidecar))
    return aviso('sem .sha256 ao lado: integridade não verificada (dump antigo ou externo)')

  const gravada = readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0]
  const atual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
  if (gravada !== atual)
    erro(
      `sha256 não confere — o arquivo mudou desde o backup.\n` +
        `  gravado ${gravada}\n  atual   ${atual}`,
    )
  ok('sha256 confere')
}

/** Conta as linhas de uma tabela, para dizer o que havia antes e o que há depois. */
async function contarLocal(banco: string): Promise<number | null> {
  const r = await localTentar([
    'docker',
    'exec',
    'bolao-dev-postgres',
    'psql',
    '-U',
    'bolao',
    '-d',
    banco,
    '-tAc',
    'select count(*) from snapshot',
  ])
  return r.codigo === 0 ? Number(r.saida.trim()) : null
}

async function paraLocal(caminho: string) {
  const banco = opcao('banco', 'bolao')!
  const container = 'bolao-dev-postgres'

  const vivo = await localTentar(['docker', 'inspect', '-f', '{{.State.Running}}', container])
  if (vivo.saida.trim() !== 'true')
    erro(`o container ${container} não está rodando — \`bun run infra:up\``)

  // Cria o database se não existir: restaurar num rascunho é o uso mais comum,
  // e exigir criar à mão antes só transforma uma etapa em duas.
  const existe = await localTentar([
    'docker',
    'exec',
    container,
    'psql',
    '-U',
    'bolao',
    '-d',
    'postgres',
    '-tAc',
    `select 1 from pg_database where datname='${banco}'`,
  ])
  if (existe.saida.trim() !== '1') {
    if (seco) return info(`[seco] criaria o database ${banco} e restauraria`)
    await local(['docker', 'exec', container, 'createdb', '-U', 'bolao', banco])
    ok(`database ${banco} criado`)
  } else {
    const antes = await contarLocal(banco)
    if (antes) {
      info(`${banco} já tem dado (${antes} snapshots) e será sobrescrito`)
      exigirConfirmacao('local', `restore sobre o banco local '${banco}', que tem dado.`)
    }
  }

  if (seco) return info(`[seco] pg_restore em ${container}/${banco}`)

  // --clean --if-exists derruba o que existe antes de recriar; --no-owner
  // porque o dono em produção é o role 'bolao' do servidor, que não existe aqui.
  const r = await localTentar([
    'sh',
    '-c',
    `docker exec -i ${container} pg_restore --clean --if-exists --no-owner --no-privileges ` +
      `-U bolao -d ${banco} < '${caminho}'`,
  ])
  // pg_restore devolve código 1 com "warning: errors ignored on restore" para
  // coisas inofensivas — extensão que não pode ser recriada, DROP de objeto que
  // não existia. Distinguir isso de falha real é o que evita alarme falso.
  const erros = [...r.erroSaida.matchAll(/^pg_restore: error: (.+)$/gm)].map((m) => m[1]!)
  const graves = erros.filter((e) => !/does not exist|must be owner|already exists/i.test(e))
  if (graves.length) erro(`pg_restore falhou:\n  ${graves.slice(0, 5).join('\n  ')}`)
  if (erros.length) info(`${erros.length} avisos ignoráveis do pg_restore`)

  const depois = await contarLocal(banco)
  ok(
    `${banco} restaurado · ` +
      (depois === null ? 'sem tabela snapshot (dump de outro banco?)' : `${depois} snapshots`),
  )
  if (banco !== 'bolao')
    info(`para usar: DATABASE_URL=postgres://bolao:bolao_local@localhost:55432/${banco}`)
}

async function paraProducao(caminho: string) {
  if (!s) return
  exigirConfirmacao(
    'producao',
    `restore sobre o banco '${p.banco.nome}' em ${p.servidor.host}, que está no ar.`,
  )

  // Dump de segurança pelo mesmo caminho verificado do backup normal — inclusive
  // a checagem de índice. O estado que vai ser sobrescrito não some.
  etapa('dump de segurança do estado atual')
  if (seco) info('[seco] rodaria `bun run backup` antes de sobrescrever')
  else await local(['bun', 'run', 'infra/bin/backup.ts'])

  etapa('parando os serviços que escrevem')
  const compose = (a: string) => `cd ${p.servidor.pasta} && docker compose ${a}`
  await s.rodar(compose('stop worker web'), 'web e worker parados')

  try {
    etapa('restaurando')
    const bytes = readFileSync(caminho)
    info(`${tamanho(bytes.length)} pela entrada padrão do pg_restore — sem cópia no disco de lá`)

    const r = await s.tentarComEntrada(
      `docker exec -i ${p.banco.container} pg_restore --clean --if-exists --no-owner ` +
        `--no-privileges -U postgres -d ${p.banco.nome}`,
      bytes,
    )
    // Código 1 do pg_restore cobre desde falha real até DROP de objeto que não
    // existia. Separar os dois é o que evita abortar por aviso inofensivo.
    const erros = [...r.erroSaida.matchAll(/^pg_restore: error: (.+)$/gm)].map((m) => m[1]!)
    const graves = erros.filter((e) => !/does not exist|must be owner|already exists/i.test(e))
    if (graves.length) erro(`pg_restore falhou:\n  ${graves.slice(0, 5).join('\n  ')}`)
    if (erros.length) info(`${erros.length} avisos ignoráveis do pg_restore`)
    if (!seco) ok('pg_restore concluído')
  } finally {
    etapa('subindo de volta')
    await s.rodar(compose('up -d'), 'web e worker no ar')
  }

  if (!seco) {
    const n = await s.ler(
      `docker exec ${p.banco.container} psql -U postgres -d ${p.banco.nome} -tAc ` +
        `'select count(*) from snapshot'`,
    )
    ok(`${p.banco.nome} restaurado · ${n.trim()} snapshots`)
  }
}
