/**
 * Persistência das partidas, com histórico de remarcação.
 *
 * "Sempre pode mudar" é requisito: adiamento é rotina no Brasileirão e o
 * simulador precisa saber o que era esperado versus o que aconteceu. Toda
 * alteração de horário, estádio, status ou placar vira uma linha em
 * `partida_alteracao`.
 */
import { and, eq } from 'drizzle-orm'
import type { Banco } from '../index.ts'
import { partida, partidaAlteracao } from '../schema.ts'
import { ResolvedorDeClubes, type RefClubeFonte } from './clubes.ts'

export type PartidaEntrada = {
  externoId: string | null
  rodada: number
  mandante: RefClubeFonte
  visitante: RefClubeFonte
  inicioPrevisto: Date | null
  inicioConfirmado: boolean
  estadio: string | null
  status: 'agendada' | 'em_andamento' | 'encerrada' | 'adiada' | 'cancelada'
  golsMandante: number | null
  golsVisitante: number | null
}

export type Alteracao = { campo: string; de: string | null; para: string | null }

export type ResultadoSincronismo = {
  inseridas: number
  atualizadas: number
  inalteradas: number
  alteracoes: (Alteracao & { partida: string })[]
  clubesCriados: string[]
}

const texto = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v)

/** Campos cuja mudança merece registro histórico. */
const RASTREADOS = [
  'inicioPrevisto',
  'inicioConfirmado',
  'estadio',
  'status',
  'golsMandante',
  'golsVisitante',
] as const

export async function sincronizarPartidas(
  db: Banco,
  temporadaId: number,
  temporadaAno: number,
  fonte: string,
  entradas: PartidaEntrada[],
): Promise<ResultadoSincronismo> {
  const resolvedor = new ResolvedorDeClubes(db, fonte)
  const r: ResultadoSincronismo = {
    inseridas: 0,
    atualizadas: 0,
    inalteradas: 0,
    alteracoes: [],
    clubesCriados: [],
  }

  const existentes = await db.select().from(partida).where(eq(partida.temporadaId, temporadaId))
  const chave = (rodada: number, casa: number, fora: number) => `${rodada}|${casa}|${fora}`
  const indice = new Map(
    existentes.map((p) => [chave(p.rodada, p.mandanteId, p.visitanteId), p]),
  )

  for (const e of entradas) {
    const mandanteId = await resolvedor.resolver(e.mandante, temporadaAno)
    const visitanteId = await resolvedor.resolver(e.visitante, temporadaAno)
    const atual = indice.get(chave(e.rodada, mandanteId, visitanteId))

    const valores = {
      temporadaId,
      rodada: e.rodada,
      externoId: e.externoId,
      mandanteId,
      visitanteId,
      inicioPrevisto: e.inicioPrevisto,
      inicioConfirmado: e.inicioConfirmado,
      estadio: e.estadio,
      status: e.status,
      golsMandante: e.golsMandante,
      golsVisitante: e.golsVisitante,
      fonte,
      atualizadoEm: new Date(),
    }

    if (!atual) {
      await db.insert(partida).values(valores)
      r.inseridas++
      continue
    }

    const mudancas: Alteracao[] = []
    for (const campo of RASTREADOS) {
      const de = texto(atual[campo])
      const para = texto(valores[campo])
      if (de !== para) mudancas.push({ campo, de, para })
    }

    if (!mudancas.length) {
      r.inalteradas++
      continue
    }

    await db.update(partida).set(valores).where(eq(partida.id, atual.id))
    await db.insert(partidaAlteracao).values(
      mudancas.map((m) => ({ partidaId: atual.id, campo: m.campo, de: m.de, para: m.para, fonte })),
    )

    const rotulo = `${e.mandante.nome} × ${e.visitante.nome} (r${e.rodada})`
    for (const m of mudancas) r.alteracoes.push({ partida: rotulo, ...m })
    r.atualizadas++
  }

  r.clubesCriados = resolvedor.criados
  return r
}

/** Partidas encerradas, no formato que o motor de regras consome. */
export async function partidasEncerradas(db: Banco, temporadaId: number) {
  const rows = await db
    .select()
    .from(partida)
    .where(and(eq(partida.temporadaId, temporadaId), eq(partida.status, 'encerrada')))
  return rows
}
