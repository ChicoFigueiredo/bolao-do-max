#!/usr/bin/env bun
/**
 * Aciona o worker — no servidor ou aqui — sem esperar a cadência dele.
 *
 *   bun run worker:remoto ciclo          um ciclo agora
 *   bun run worker:remoto completar      preenche tudo que estiver faltando
 *   bun run worker:remoto logs -n 50
 *   bun run worker:remoto reiniciar
 *   bun run worker:remoto ciclo --alvo=local
 *
 * `completar` é o par do restore. Um backup restaurado tem o dado até a hora do
 * dump; a diferença entre aquilo e agora é justamente o que o worker sabe
 * buscar. A ordem importa e não é óbvia:
 *
 *   1. **para o worker residente** — dois processos apurando a mesma temporada
 *      ao mesmo tempo funcionam, mas embaralham o log e disputam as cotas
 *   2. **calendário completo** — 38 rodadas, para pegar remarcação e placar novo
 *   3. **replay dos snapshots** — reconstrói a série a partir das partidas, o
 *      que preenche o buraco entre o dump e agora sem inventar ponto nenhum
 *   4. **um ciclo** — apura, snapshota, publica cache e pré-renderiza
 *   5. **religa o residente**
 */
import {
  Servidor,
  apagado,
  carregarParametros,
  erro,
  etapa,
  info,
  local,
  negrito,
  ok,
  seco,
} from './comum.ts'

const CLI = {
  ciclo: 'apps/worker/src/cli/ciclo.ts',
  sincronizar: 'apps/worker/src/cli/sincronizar.ts',
  snapshots: 'apps/worker/src/cli/reconstruir-snapshots.ts',
  historico: 'apps/worker/src/cli/reconstruir-historico.ts',
  migrate: 'packages/db/src/cli/migrate.ts',
  seed: 'packages/db/src/cli/seed.ts',
  'seed-dados': 'packages/db/src/cli/seed-dados.ts',
} as const

const ACOES = [
  'ciclo',
  'completar',
  'sincronizar',
  'historico',
  'logs',
  'reiniciar',
  'parar',
  'iniciar',
  'estado',
] as const
type Acao = (typeof ACOES)[number]

if (import.meta.main) {
  const acao = Bun.argv.slice(2).find((a) => !a.startsWith('-')) as Acao | undefined
  if (!acao || !ACOES.includes(acao))
    erro(`uso: bun run worker:remoto <${ACOES.join('|')}> [--alvo=local|producao]`)

  const p = carregarParametros()
  const remoto = !Bun.argv.includes('--alvo=local')
  const s = remoto ? new Servidor(p) : null
  try {
    if (s) {
      const existe = await s.tentar(`test -f ${p.servidor.pasta}/compose.yml && echo sim`)
      if (existe.saida.trim() !== 'sim')
        erro(
          `${p.servidor.pasta}/compose.yml não existe em ${p.servidor.host} — ` +
            `o projeto ainda não foi para lá.\n` +
            `  Primeiro deploy:  bun run deploy --dry-run  (e depois sem --dry-run)\n` +
            `  Ou aponte para cá: bun run worker:remoto ${acao} --alvo=local`,
        )
    }
    await executar(acao, { p, s })
  } finally {
    s?.fechar()
  }
}

// ─────────────────────────────────────────────────────────────

type Contexto = {
  p: ReturnType<typeof carregarParametros>
  s: Servidor | null
}

/** Roda um CLI do projeto no alvo escolhido, devolvendo a saída. */
async function rodarCli({ p, s }: Contexto, caminho: string, args: string[] = []): Promise<string> {
  const linha = `bun run ${caminho}${args.length ? ` ${args.join(' ')}` : ''}`
  if (!s) return local(['sh', '-c', linha], { silencioso: true })
  return s.rodar(
    `cd ${p.servidor.pasta} && docker compose run --rm --no-deps -T worker ${linha}`,
    linha,
  )
}

function mostrar(saida: string, quantas = 8) {
  for (const l of saida.split('\n').filter(Boolean).slice(-quantas)) info(l)
}

export async function executar(acao: Acao, ctx: Contexto) {
  const { p, s } = ctx
  const onde = s ? p.servidor.host : 'localhost'
  const compose = (args: string) => `cd ${p.servidor.pasta} && docker compose ${args}`

  switch (acao) {
    case 'ciclo': {
      etapa(`ciclo do worker em ${onde}`)
      const forcar = Bun.argv.includes('--forcar') ? ['--forcar'] : []
      mostrar(await rodarCli(ctx, CLI.ciclo, forcar), 12)
      break
    }

    case 'sincronizar': {
      etapa(`sincronismo de calendário em ${onde}`)
      mostrar(await rodarCli(ctx, CLI.sincronizar))
      break
    }

    case 'historico': {
      etapa(`reconstrução das temporadas encerradas em ${onde}`)
      mostrar(await rodarCli(ctx, CLI.historico), 20)
      break
    }

    case 'completar':
      await completar(ctx)
      break

    case 'logs': {
      const i = Bun.argv.indexOf('-n')
      const n = i > 0 ? Bun.argv[i + 1] : '30'
      etapa(`log do worker em ${onde}`)
      if (!s) return info('sem container local: o worker de desenvolvimento roda em primeiro plano')
      console.log(await s.ler(compose(`logs --tail ${n} worker`)))
      break
    }

    case 'estado': {
      etapa(`estado em ${onde}`)
      if (!s) return info('alvo local: use `docker ps` e o log do processo')
      console.log(await s.ler(compose('ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"')))
      break
    }

    case 'parar':
    case 'iniciar':
    case 'reiniciar': {
      etapa(`${acao} worker em ${onde}`)
      if (!s) erro('só faz sentido no alvo remoto — o worker local roda em primeiro plano')
      const cmd = { parar: 'stop worker', iniciar: 'start worker', reiniciar: 'restart worker' }[acao]
      await s.rodar(compose(cmd), `worker: ${acao}`)
      break
    }
  }
}

/**
 * Traz o banco de "o que havia no dump" para "o que há agora".
 *
 * Cada passo é idempotente por conta própria: partidas por chave natural,
 * snapshots por hash. Rodar duas vezes não duplica nada, então em caso de
 * dúvida rodar de novo é seguro.
 */
async function completar(ctx: Contexto) {
  const { p, s } = ctx
  const compose = (args: string) => `cd ${p.servidor.pasta} && docker compose ${args}`
  const onde = s ? p.servidor.host : 'localhost'

  etapa(`completando o dado em ${onde}`)

  let residenteEstava = false
  if (s) {
    const estado = await s.tentar(`docker inspect -f '{{.State.Running}}' bolao-do-max-worker`)
    residenteEstava = estado.saida === 'true'
    if (residenteEstava) await s.rodar(compose('stop worker'), 'worker residente parado')
    else info('worker residente já estava parado')
  }

  try {
    info('1/4 seed de dados — partidas e série versionadas')
    mostrar(await rodarCli(ctx, CLI['seed-dados']), 4)

    info('2/4 calendário completo na fonte — 38 rodadas')
    mostrar(await rodarCli(ctx, CLI.sincronizar), 6)

    info('3/4 replay dos snapshots a partir das partidas')
    mostrar(await rodarCli(ctx, CLI.snapshots), 5)

    info('4/4 ciclo: apura, snapshota, publica cache e pré-renderiza')
    mostrar(await rodarCli(ctx, CLI.ciclo), 12)
  } finally {
    if (s && residenteEstava) await s.rodar(compose('start worker'), 'worker residente religado')
  }

  if (seco) return
  console.log(`\n${negrito('dado completo')}`)
  console.log(apagado('  A partir daqui o worker segue sozinho, na cadência do calendário.'))
  if (s)
    console.log(
      apagado(`  Conferir:  bun run worker:remoto logs -n 20\n` + `             bun run backup`),
    )
  ok('nada mais a fazer')
}
