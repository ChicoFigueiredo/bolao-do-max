#!/usr/bin/env bun
/**
 * Carrega `seeds/partidas/` e `seeds/snapshots/` — o dado já apurado.
 *
 * Complementa `db:seed`, que carrega o que é *entrada* do bolão (apostas,
 * identidades, clubes). Aqui entra o que é *resultado*: as 380 partidas com
 * placar e horário, e a série de snapshots que alimenta a aba Evolução.
 *
 * Ganho concreto: um banco novo sai daqui em dia. Sem este passo o worker
 * varreria 38 rodadas no GE e replayaria a temporada inteira só para chegar
 * onde este arquivo já está.
 *
 * Idempotente. As partidas passam pelo MESMO caminho de escrita que o worker
 * usa ao ingerir do GE (`sincronizarPartidas`) — de propósito: se a resolução
 * de clube ou o registro de remarcação mudarem, muda para os dois juntos e o
 * seed não vira um segundo dialeto de escrita. Os snapshots são inseridos por
 * hash, que é único por temporada: rodar de novo não duplica.
 *
 *   bun run db:seed:dados               # tudo que houver em seeds/
 *   bun run db:seed:dados 2026          # só uma temporada
 *   bun run db:seed:dados --so-partidas
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import {
  abrirBanco,
  clube,
  competidor,
  sincronizarPartidas,
  snapshot,
  snapshotClube,
  snapshotCompetidor,
  temporada,
  type PartidaEntrada,
} from '../index.ts'

type SeedPartidas = {
  temporada: number
  serie: string
  partidas: {
    rodada: number
    mandante: string
    visitante: string
    externoId: string | null
    inicioPrevisto: string | null
    inicioConfirmado: boolean
    estadio: string | null
    status: PartidaEntrada['status']
    golsMandante: number | null
    golsVisitante: number | null
    fonte: string | null
  }[]
}

type SeedSnapshots = {
  temporada: number
  serie: string
  colunasClube: string[]
  colunasCompetidor: string[]
  snapshots: {
    hash: string
    criadoEm: string
    origem: string
    rodada: number | null
    clubes: (string | number | null)[][]
    competidores: (string | number | null)[][]
  }[]
}

/**
 * As tuplas são posicionais, então a ordem das colunas é contrato. O arquivo
 * carrega a ordem que foi usada para gravá-lo; conferir na leitura transforma
 * uma futura mudança de esquema em erro claro em vez de dado embaralhado.
 */
const COLUNAS_CLUBE = [
  'clube',
  'posicao',
  'pontos',
  'jogos',
  'vitorias',
  'empates',
  'derrotas',
  'golsPro',
  'golsContra',
  'saldoGols',
  'aproveitamento',
]
const COLUNAS_COMPETIDOR = [
  'competidor',
  'classicoPontos',
  'classicoSaldoGols',
  'classicoGolsPro',
  'classicoGolsContra',
  'classicoPosicao',
  'classicoPremioCentavos',
  'posicaoPontos',
  'posicaoAcertosFaixa',
  'posicaoAcertosG4',
  'posicaoAcertosZ4',
  'posicaoPosicao',
  'posicaoPremioCentavos',
]

const ler = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T
const anos = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => Number(f.replace('.json', '')))
        .sort()
    : []

/** postgres.js tem teto de parâmetros por statement; 400 linhas fica folgado. */
async function emLotes<T>(linhas: T[], gravar: (lote: T[]) => Promise<unknown>) {
  for (let i = 0; i < linhas.length; i += 400) await gravar(linhas.slice(i, i + 400))
}

const alvo = Bun.argv.find((a) => /^\d{4}$/.test(a))
const soPartidas = Bun.argv.includes('--so-partidas')

const { db, fechar } = abrirBanco()

try {
  const anosPartidas = anos('seeds/partidas')
  const anosSnapshots = soPartidas ? [] : anos('seeds/snapshots')
  const todos = [...new Set([...anosPartidas, ...anosSnapshots])]
    .filter((a) => !alvo || a === Number(alvo))
    .sort()

  if (!todos.length) {
    console.log('nada para carregar — rode `bun run seeds:exportar` num banco com dado')
    process.exit(0)
  }

  const pessoas = new Map((await db.select().from(competidor)).map((c) => [c.nome, c.id]))

  for (const ano of todos) {
    // ── Partidas ────────────────────────────────────────────
    if (anosPartidas.includes(ano)) {
      const seed = ler<SeedPartidas>(join('seeds/partidas', `${ano}.json`))
      const [t] = await db
        .select()
        .from(temporada)
        .where(and(eq(temporada.ano, seed.temporada), eq(temporada.serie, seed.serie)))
      if (!t)
        throw new Error(
          `temporada ${seed.temporada}/${seed.serie} não existe — rode \`bun run db:seed\` antes`,
        )

      // Uma fonte por vez: os apelidos de clube são gravados por fonte, e
      // misturar tudo em 'seed' apagaria a origem real de cada partida.
      const porFonte = new Map<string, PartidaEntrada[]>()
      for (const p of seed.partidas) {
        const fonte = p.fonte ?? 'seed'
        const lista = porFonte.get(fonte) ?? []
        lista.push({
          externoId: p.externoId,
          rodada: p.rodada,
          mandante: { nome: p.mandante },
          visitante: { nome: p.visitante },
          inicioPrevisto: p.inicioPrevisto ? new Date(p.inicioPrevisto) : null,
          inicioConfirmado: p.inicioConfirmado,
          estadio: p.estadio,
          status: p.status,
          golsMandante: p.golsMandante,
          golsVisitante: p.golsVisitante,
        })
        porFonte.set(fonte, lista)
      }

      let inseridas = 0
      let atualizadas = 0
      let inalteradas = 0
      const clubesCriados: string[] = []
      for (const [fonte, entradas] of porFonte) {
        const r = await sincronizarPartidas(db, t.id, seed.temporada, fonte, entradas)
        inseridas += r.inseridas
        atualizadas += r.atualizadas
        inalteradas += r.inalteradas
        clubesCriados.push(...r.clubesCriados)
      }
      console.log(
        `✓ partidas ${ano} — ${inseridas} novas · ${atualizadas} atualizadas · ` +
          `${inalteradas} inalteradas` +
          (clubesCriados.length ? ` · clubes criados: ${clubesCriados.join(', ')}` : ''),
      )
    }

    // ── Snapshots ───────────────────────────────────────────
    if (!anosSnapshots.includes(ano)) continue

    const seed = ler<SeedSnapshots>(join('seeds/snapshots', `${ano}.json`))
    const confereColunas = (esperado: string[], achado: string[], qual: string) => {
      if (esperado.join(',') !== achado.join(','))
        throw new Error(
          `seeds/snapshots/${ano}.json tem outra ordem de colunas de ${qual} — ` +
            `regere com \`bun run seeds:exportar\``,
        )
    }
    confereColunas(COLUNAS_CLUBE, seed.colunasClube, 'clube')
    confereColunas(COLUNAS_COMPETIDOR, seed.colunasCompetidor, 'competidor')

    const [t] = await db
      .select()
      .from(temporada)
      .where(and(eq(temporada.ano, seed.temporada), eq(temporada.serie, seed.serie)))
    if (!t) throw new Error(`temporada ${seed.temporada}/${seed.serie} não existe`)

    const clubesDoBanco = new Map((await db.select().from(clube)).map((c) => [c.nome, c.id]))
    const existentes = new Set(
      (
        await db.select({ hash: snapshot.hash }).from(snapshot).where(eq(snapshot.temporadaId, t.id))
      ).map((s) => s.hash),
    )

    let gravados = 0
    let repetidos = 0
    const semPessoa = new Set<string>()

    for (const s of seed.snapshots) {
      if (existentes.has(s.hash)) {
        repetidos++
        continue
      }

      const linhasClube = s.clubes.map((c) => {
        const nome = String(c[0])
        const id = clubesDoBanco.get(nome)
        if (!id) throw new Error(`clube "${nome}" do snapshot ${s.hash} não existe no banco`)
        return {
          clubeId: id,
          posicao: Number(c[1]),
          pontos: Number(c[2]),
          jogos: Number(c[3]),
          vitorias: Number(c[4]),
          empates: Number(c[5]),
          derrotas: Number(c[6]),
          golsPro: Number(c[7]),
          golsContra: Number(c[8]),
          saldoGols: Number(c[9]),
          aproveitamento: c[10] == null ? null : Number(c[10]),
        }
      })

      const linhasComp = s.competidores.flatMap((c) => {
        const nome = String(c[0])
        const id = pessoas.get(nome)
        // Competidor ausente é dado do seed de apostas que não foi carregado.
        // Pular a linha e avisar é melhor que abortar a série inteira.
        if (!id) {
          semPessoa.add(nome)
          return []
        }
        const n = (v: string | number | null | undefined) => (v == null ? null : Number(v))
        return [
          {
            competidorId: id,
            classicoPontos: n(c[1]),
            classicoSaldoGols: n(c[2]),
            classicoGolsPro: n(c[3]),
            classicoGolsContra: n(c[4]),
            classicoPosicao: n(c[5]),
            classicoPremioCentavos: n(c[6]) ?? 0,
            posicaoPontos: n(c[7]),
            posicaoAcertosFaixa: n(c[8]),
            posicaoAcertosG4: n(c[9]),
            posicaoAcertosZ4: n(c[10]),
            posicaoPosicao: n(c[11]),
            posicaoPremioCentavos: n(c[12]) ?? 0,
          },
        ]
      })

      // Cabeçalho e filhos numa transação só. Meio-snapshot é pior que nenhum:
      // vira o ponto mais recente da série e contradiz o dado ao vivo — foi
      // exatamente o que aconteceu na primeira versão do replay.
      await db.transaction(async (tx) => {
        const [novo] = await tx
          .insert(snapshot)
          .values({
            temporadaId: t.id,
            hash: s.hash,
            origem: s.origem,
            rodada: s.rodada,
            criadoEm: new Date(s.criadoEm),
          })
          .returning({ id: snapshot.id })
        const id = novo!.id
        await emLotes(linhasClube, (lote) =>
          tx.insert(snapshotClube).values(lote.map((l) => ({ ...l, snapshotId: id }))),
        )
        await emLotes(linhasComp, (lote) =>
          tx.insert(snapshotCompetidor).values(lote.map((l) => ({ ...l, snapshotId: id }))),
        )
      })

      existentes.add(s.hash)
      gravados++
    }

    console.log(`✓ snapshots ${ano} — ${gravados} gravados · ${repetidos} já existiam`)
    if (semPessoa.size)
      console.warn(
        `  ⚠ ${semPessoa.size} competidores do seed não existem no banco (linhas puladas): ` +
          [...semPessoa].join(', '),
      )
  }
} catch (e) {
  console.error('✗ seed de dados falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
