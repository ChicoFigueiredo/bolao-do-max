/**
 * Cadência guiada pelo calendário.
 *
 * A tabela `partida` sabe quando há jogo, então o worker consulta forte só
 * quando a tabela pode mudar. É o oposto do comportamento atual, que faz até
 * 80 requisições por hora ao ge.globo, 24 h por dia, o ano inteiro — inclusive
 * fora de temporada e sem ninguém acessando.
 */
import { partida, type Banco } from '@bolao/db'
import { and, eq, gte, lte, sql } from 'drizzle-orm'

export type Janela = 'jogo_em_andamento' | 'dia_de_jogo' | 'ocioso' | 'fora_de_temporada'

export type Cadencia = {
  janela: Janela
  intervaloS: number
  /** Consultar as APIs com cota nesta passada? */
  conferirComApis: boolean
  motivo: string
}

export async function decidirCadencia(
  db: Banco,
  temporadaId: number,
  cfg: {
    PROVIDER_GE_INTERVALO_JOGO_S: number
    PROVIDER_GE_INTERVALO_DIA_JOGO_S: number
    PROVIDER_GE_INTERVALO_OCIOSO_S: number
    WORKER_JANELA_JOGO_ANTES_MIN: number
    WORKER_JANELA_JOGO_DEPOIS_MIN: number
  },
  agora = new Date(),
): Promise<Cadencia> {
  const inicioJanela = new Date(agora.getTime() + cfg.WORKER_JANELA_JOGO_ANTES_MIN * 60_000)
  const fimJanela = new Date(agora.getTime() - cfg.WORKER_JANELA_JOGO_DEPOIS_MIN * 60_000)

  const [emAndamento] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partida)
    .where(
      and(
        eq(partida.temporadaId, temporadaId),
        lte(partida.inicioPrevisto, inicioJanela),
        gte(partida.inicioPrevisto, fimJanela),
      ),
    )

  if ((emAndamento?.n ?? 0) > 0)
    return {
      janela: 'jogo_em_andamento',
      intervaloS: cfg.PROVIDER_GE_INTERVALO_JOGO_S,
      conferirComApis: false,
      motivo: `${emAndamento!.n} partida(s) na janela de jogo`,
    }

  const inicioDia = new Date(agora)
  inicioDia.setHours(0, 0, 0, 0)
  const fimDia = new Date(inicioDia.getTime() + 86_400_000)

  const [hoje] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partida)
    .where(
      and(
        eq(partida.temporadaId, temporadaId),
        gte(partida.inicioPrevisto, inicioDia),
        lte(partida.inicioPrevisto, fimDia),
      ),
    )

  if ((hoje?.n ?? 0) > 0)
    return {
      janela: 'dia_de_jogo',
      intervaloS: cfg.PROVIDER_GE_INTERVALO_DIA_JOGO_S,
      conferirComApis: true,
      motivo: `${hoje!.n} partida(s) hoje, fora da janela`,
    }

  const [futuras] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(partida)
    .where(and(eq(partida.temporadaId, temporadaId), gte(partida.inicioPrevisto, agora)))

  if ((futuras?.n ?? 0) === 0)
    return {
      janela: 'fora_de_temporada',
      intervaloS: cfg.PROVIDER_GE_INTERVALO_OCIOSO_S,
      conferirComApis: false,
      motivo: 'nenhuma partida futura — temporada encerrada',
    }

  return {
    janela: 'ocioso',
    intervaloS: cfg.PROVIDER_GE_INTERVALO_OCIOSO_S,
    conferirComApis: false,
    motivo: 'sem jogos hoje',
  }
}
