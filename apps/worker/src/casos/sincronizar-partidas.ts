/**
 * Ingere o calendário e os resultados da temporada.
 *
 * Barato de rodar: uma passada traz as 38 rodadas. Idempotente — só grava o
 * que mudou, e o que mudou fica registrado em `partida_alteracao`.
 */
import type { Configuracao } from '@bolao/config'
import {
  sincronizarPartidas,
  temporada,
  type Banco,
  type ResultadoSincronismo,
} from '@bolao/db'
import type { ProvedorEsportivo } from '@bolao/provider'
import { and, eq } from 'drizzle-orm'

export async function garantirTemporada(db: Banco, ano: number, serie: string): Promise<number> {
  const [achada] = await db
    .select({ id: temporada.id })
    .from(temporada)
    .where(and(eq(temporada.ano, ano), eq(temporada.serie, serie)))
  if (achada) return achada.id
  throw new Error(
    `temporada ${ano}/${serie} não existe no banco — rode \`bun run db:seed\` antes`,
  )
}

export async function sincronizarCalendario(
  db: Banco,
  cfg: Configuracao,
  provedor: ProvedorEsportivo,
  ano = cfg.TEMPORADA_ATUAL,
): Promise<ResultadoSincronismo & { total: number }> {
  if (!provedor.obterPartidas)
    throw new Error(`provedor ${provedor.nome} não sabe buscar partidas`)

  const temporadaId = await garantirTemporada(db, ano, cfg.SERIE)
  const partidas = await provedor.obterPartidas(ano, cfg.SERIE)
  const r = await sincronizarPartidas(db, temporadaId, ano, provedor.nome, partidas)
  return { ...r, total: partidas.length }
}
