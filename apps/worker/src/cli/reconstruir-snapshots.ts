#!/usr/bin/env bun
/**
 * Reconstrói a série histórica de snapshots replayando as partidas.
 *
 * O worker só passou a existir agora, então não há série gravada da temporada
 * que já vai na 22ª rodada. Mas as 380 partidas estão em banco **com data e
 * placar**, e a tabela é uma função dos resultados — então a história pode ser
 * recalculada em vez de inventada.
 *
 * O procedimento: ordena as partidas encerradas por horário de término
 * (início + 2 h), e a cada término recalcula a tabela com tudo que já havia
 * acontecido até ali, gravando um snapshot datado daquele instante. É a mesma
 * função que apura o presente, aplicada ao passado.
 *
 * Idempotente pela unicidade de (temporada, hash): rodar de novo não duplica.
 */
import { carregarConfig } from '@bolao/config'
import {
  abrirBanco,
  carregarApostadores,
  clube,
  partida,
  snapshot,
  temporada,
} from '@bolao/db'
import type { RegrasTemporada } from '@bolao/dominio'
import { calcularClassico, calcularPosicao, calcularTabela } from '@bolao/regras'
import { and, eq, sql } from 'drizzle-orm'
import { gravarSnapshot, hashTabela } from '../casos/snapshot.ts'

/** Uma partida termina cerca de duas horas depois de começar. */
const DURACAO_MS = 2 * 3_600_000

const cfg = carregarConfig()
const ano = Number(Bun.argv[2] ?? cfg.TEMPORADA_ATUAL)
const { db, fechar } = abrirBanco()

try {
  const [t] = await db
    .select()
    .from(temporada)
    .where(and(eq(temporada.ano, ano), eq(temporada.serie, cfg.SERIE)))
  if (!t) throw new Error(`temporada ${ano} não existe — rode \`bun run db:seed\``)

  const regras = t.regras as RegrasTemporada
  const nomes = new Map((await db.select().from(clube)).map((c) => [c.id, c.nome]))
  const apostadores = await carregarApostadores(db, t.id)

  const todas = await db.select().from(partida).where(eq(partida.temporadaId, t.id))
  const elenco = [...new Set(todas.flatMap((p) => [nomes.get(p.mandanteId)!, nomes.get(p.visitanteId)!]))]

  const encerradas = todas
    .filter((p) => p.status === 'encerrada' && p.golsMandante != null && p.inicioPrevisto)
    .map((p) => ({
      fim: new Date(p.inicioPrevisto!.getTime() + DURACAO_MS),
      mandante: nomes.get(p.mandanteId)!,
      visitante: nomes.get(p.visitanteId)!,
      golsMandante: p.golsMandante!,
      golsVisitante: p.golsVisitante!,
      rodada: p.rodada,
    }))
    .sort((a, b) => a.fim.getTime() - b.fim.getTime())

  if (!encerradas.length) throw new Error('nenhuma partida encerrada com data — rode `bun run sync:partidas`')

  console.log(
    `temporada ${ano} · ${encerradas.length} partidas encerradas · ` +
      `de ${encerradas[0]!.fim.toLocaleDateString('pt-BR')} a ${encerradas.at(-1)!.fim.toLocaleDateString('pt-BR')}`,
  )

  const jaExistem = new Set(
    (await db.select({ hash: snapshot.hash }).from(snapshot).where(eq(snapshot.temporadaId, t.id))).map(
      (s) => s.hash,
    ),
  )

  let gravados = 0
  let repetidos = 0
  const acumulado: typeof encerradas = []

  for (let i = 0; i < encerradas.length; i++) {
    acumulado.push(encerradas[i]!)

    // Agrupa partidas que terminam no mesmo instante: uma rodada tem jogos
    // simultâneos, e gravar um snapshot por jogo criaria estados intermediários
    // que nunca existiram publicamente.
    const proximo = encerradas[i + 1]
    if (proximo && proximo.fim.getTime() === encerradas[i]!.fim.getTime()) continue

    const tabela = calcularTabela(acumulado, elenco)
    const hash = hashTabela(tabela)
    if (jaExistem.has(hash)) {
      repetidos++
      continue
    }

    const classico = t.temClassico ? calcularClassico(tabela, apostadores, regras) : []
    const posicao = t.temPosicao ? calcularPosicao(tabela, apostadores, regras) : []

    // Gravar e datar numa transação só.
    //
    // Sem isso, uma falha entre as duas operações deixa um snapshot datado de
    // "agora" no meio da série histórica — foi exatamente o que aconteceu na
    // primeira execução deste script, e o órfão passou a ser o ponto mais
    // recente da série, contradizendo o dado ao vivo.
    const r = await db.transaction(async (tx) => {
      const res = await gravarSnapshot(
        tx as unknown as typeof db,
        t.id,
        'replay',
        tabela,
        classico,
        posicao,
        encerradas[i]!.rodada,
      )
      if (res.gravou)
        await tx
          .update(snapshot)
          .set({ criadoEm: encerradas[i]!.fim })
          .where(eq(snapshot.id, res.snapshotId))
      return res
    })

    if (r.gravou) {
      jaExistem.add(hash)
      gravados++
    } else repetidos++
  }

  const [total] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(snapshot)
    .where(eq(snapshot.temporadaId, t.id))

  console.log(`✓ ${gravados} snapshots gravados · ${repetidos} já existiam`)
  console.log(`  total na temporada: ${total?.n ?? 0}`)
} catch (e) {
  console.error('✗ falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
