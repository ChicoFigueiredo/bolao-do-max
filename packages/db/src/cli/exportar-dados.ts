#!/usr/bin/env bun
/**
 * Exporta o dado já apurado para `seeds/` — partidas e série de snapshots.
 *
 * Por que isto existe: sem ele, um banco novo nasce vazio e o worker precisa
 * varrer 38 rodadas no GE e replayar a temporada inteira para reconstruir a
 * série. São minutos de trabalho e centenas de requisições numa fonte gratuita
 * que não nos deve nada. Com o seed, o banco novo nasce em dia e o primeiro
 * ciclo só precisa olhar a rodada corrente.
 *
 * O seed é derivado — o banco continua sendo a verdade. Mas é derivado e
 * *versionado*, então também serve de cópia de segurança legível: se o dump
 * binário se perder, o histórico do bolão continua no git.
 *
 * Chaves naturais, nunca ids. Um id serial não significa nada em outro banco;
 * `(temporada, rodada, mandante, visitante)` e `(temporada, hash)` significam
 * a mesma coisa em qualquer lugar.
 *
 *   bun run seeds:exportar            # todas as temporadas com dado
 *   bun run seeds:exportar 2026       # só uma
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  abrirBanco,
  clube,
  competidor,
  partida,
  snapshot,
  snapshotClube,
  snapshotCompetidor,
  temporada,
} from '../index.ts'

/** Ordem das tuplas dos snapshots. Vai gravada no arquivo: o formato se explica. */
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
] as const

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
] as const

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/**
 * Envelope legível, uma linha por registro.
 *
 * `JSON.stringify(x, null, 2)` quebraria cada tupla em onze linhas e um
 * snapshot novo apareceria no diff como quinhentas linhas. Uma linha por
 * snapshot mantém o diff proporcional à mudança — que é o que faz valer a pena
 * versionar dado gerado.
 */
function envelope(cabecalho: Record<string, unknown>, campo: string, linhas: string[]): string {
  const topo = Object.entries(cabecalho)
    .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n')
  const corpo = linhas.length ? `\n${linhas.map((l) => `    ${l}`).join(',\n')}\n  ` : ''
  return `{\n${topo},\n  ${JSON.stringify(campo)}: [${corpo}]\n}\n`
}

const alvo = Bun.argv[2] ? Number(Bun.argv[2]) : null
const { db, fechar } = abrirBanco()

try {
  const nomeClube = new Map((await db.select().from(clube)).map((c) => [c.id, c.nome]))
  const nomeCompetidor = new Map((await db.select().from(competidor)).map((c) => [c.id, c.nome]))

  const temporadas = (await db.select().from(temporada).orderBy(asc(temporada.ano))).filter(
    (t) => !alvo || t.ano === alvo,
  )
  if (!temporadas.length) throw new Error(`nenhuma temporada${alvo ? ` ${alvo}` : ''} no banco`)

  mkdirSync('seeds/partidas', { recursive: true })
  mkdirSync('seeds/snapshots', { recursive: true })

  const geradoEm = new Date().toISOString()

  for (const t of temporadas) {
    // ── Partidas ────────────────────────────────────────────
    const jogos = await db
      .select()
      .from(partida)
      .where(eq(partida.temporadaId, t.id))
      .orderBy(asc(partida.rodada), asc(partida.id))

    if (jogos.length) {
      const linhas = jogos.map((p) =>
        JSON.stringify({
          rodada: p.rodada,
          mandante: nomeClube.get(p.mandanteId),
          visitante: nomeClube.get(p.visitanteId),
          externoId: p.externoId,
          inicioPrevisto: iso(p.inicioPrevisto),
          inicioConfirmado: p.inicioConfirmado,
          estadio: p.estadio,
          status: p.status,
          golsMandante: p.golsMandante,
          golsVisitante: p.golsVisitante,
          fonte: p.fonte,
        }),
      )
      const arquivo = `seeds/partidas/${t.ano}.json`
      writeFileSync(
        arquivo,
        envelope(
          { temporada: t.ano, serie: t.serie, geradoEm, partidas_total: jogos.length },
          'partidas',
          linhas,
        ),
      )
      console.log(`✓ ${arquivo} — ${jogos.length} partidas`)
    }

    // ── Snapshots ───────────────────────────────────────────
    const snaps = await db
      .select()
      .from(snapshot)
      .where(eq(snapshot.temporadaId, t.id))
      .orderBy(asc(snapshot.criadoEm), asc(snapshot.id))

    if (!snaps.length) continue

    const ids = snaps.map((s) => s.id)
    const clubes = await db.select().from(snapshotClube).where(inArray(snapshotClube.snapshotId, ids))
    const comps = await db
      .select()
      .from(snapshotCompetidor)
      .where(inArray(snapshotCompetidor.snapshotId, ids))

    const porSnapClube = new Map<number, typeof clubes>()
    for (const c of clubes) {
      const l = porSnapClube.get(c.snapshotId) ?? []
      l.push(c)
      porSnapClube.set(c.snapshotId, l)
    }
    const porSnapComp = new Map<number, typeof comps>()
    for (const c of comps) {
      const l = porSnapComp.get(c.snapshotId) ?? []
      l.push(c)
      porSnapComp.set(c.snapshotId, l)
    }

    const linhas = snaps.map((s) => {
      const cl = (porSnapClube.get(s.id) ?? [])
        .sort((a, b) => a.posicao - b.posicao)
        .map((c) => [
          nomeClube.get(c.clubeId),
          c.posicao,
          c.pontos,
          c.jogos,
          c.vitorias,
          c.empates,
          c.derrotas,
          c.golsPro,
          c.golsContra,
          c.saldoGols,
          c.aproveitamento,
        ])
      const co = (porSnapComp.get(s.id) ?? [])
        .map((c) => [
          nomeCompetidor.get(c.competidorId)!,
          c.classicoPontos,
          c.classicoSaldoGols,
          c.classicoGolsPro,
          c.classicoGolsContra,
          c.classicoPosicao,
          c.classicoPremioCentavos,
          c.posicaoPontos,
          c.posicaoAcertosFaixa,
          c.posicaoAcertosG4,
          c.posicaoAcertosZ4,
          c.posicaoPosicao,
          c.posicaoPremioCentavos,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR'))

      return JSON.stringify({
        hash: s.hash,
        criadoEm: iso(s.criadoEm),
        origem: s.origem,
        rodada: s.rodada,
        clubes: cl,
        competidores: co,
      })
    })

    const arquivo = `seeds/snapshots/${t.ano}.json`
    writeFileSync(
      arquivo,
      envelope(
        {
          temporada: t.ano,
          serie: t.serie,
          geradoEm,
          snapshots_total: snaps.length,
          colunasClube: COLUNAS_CLUBE,
          colunasCompetidor: COLUNAS_COMPETIDOR,
        },
        'snapshots',
        linhas,
      ),
    )
    console.log(
      `✓ ${arquivo} — ${snaps.length} snapshots · ${clubes.length} linhas de clube · ` +
        `${comps.length} de competidor`,
    )
  }
} catch (e) {
  console.error('✗ exportação falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
