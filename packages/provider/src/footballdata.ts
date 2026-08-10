/**
 * Provedor football-data.org.
 *
 * Terceira opinião na reconciliação. O free tier limita a vazão (10 req/min)
 * mas não publica teto diário, o que a torna boa candidata a desempate — pode
 * ser consultada com mais liberdade que a API-Football.
 *
 * A Série A é a competição de código `BSA`.
 */
import { type Configuracao } from '@bolao/config'
import { z } from 'zod'
import { buscarJson } from './http.ts'
import {
  PayloadInvalido,
  type Capacidade,
  type LinhaClassificacaoFonte,
  type PartidaFonte,
  type ProvedorEsportivo,
  type StatusPartidaFonte,
} from './porta.ts'

export const FONTE_FOOTBALLDATA = 'footballdata'

const time = z.object({
  id: z.number(),
  name: z.string(),
  shortName: z.string().nullish(),
  tla: z.string().nullish(),
  crest: z.string().nullish(),
})

const linha = z.object({
  position: z.number(),
  team: time,
  playedGames: z.number(),
  won: z.number(),
  draw: z.number(),
  lost: z.number(),
  points: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  goalDifference: z.number(),
})

const respostaStandings = z.object({
  standings: z.array(z.object({ type: z.string().nullish(), table: z.array(linha) })).min(1),
})

const partidaFd = z.object({
  id: z.number(),
  utcDate: z.string(),
  status: z.string(),
  matchday: z.number().nullish(),
  homeTeam: time.partial({ name: true }).extend({ name: z.string().nullish() }),
  awayTeam: time.partial({ name: true }).extend({ name: z.string().nullish() }),
  score: z.object({
    fullTime: z.object({ home: z.number().nullish(), away: z.number().nullish() }),
  }),
})

const respostaMatches = z.object({ matches: z.array(partidaFd) })

function validar<T>(e: z.ZodType<T>, dado: unknown, contexto: string): T {
  const r = e.safeParse(dado)
  if (!r.success)
    throw new PayloadInvalido(
      FONTE_FOOTBALLDATA,
      r.error.issues.slice(0, 8).map((i) => `${contexto} → ${i.path.join('.')}: ${i.message}`),
    )
  return r.data
}

const STATUS: Record<string, StatusPartidaFonte> = {
  SCHEDULED: 'agendada',
  TIMED: 'agendada',
  IN_PLAY: 'em_andamento',
  PAUSED: 'em_andamento',
  FINISHED: 'encerrada',
  AWARDED: 'encerrada',
  POSTPONED: 'adiada',
  SUSPENDED: 'adiada',
  CANCELLED: 'cancelada',
}

export class ProvedorFootballData implements ProvedorEsportivo {
  readonly nome = FONTE_FOOTBALLDATA
  readonly capacidades = ['classificacao', 'partidas'] as const

  constructor(private readonly cfg: Configuracao) {}

  custo(_operacao: Capacidade, _temporada: number): number {
    return 1
  }

  private get opcoes() {
    return {
      fonte: FONTE_FOOTBALLDATA,
      timeoutMs: this.cfg.PROVIDER_FOOTBALLDATA_TIMEOUT_MS,
      retry: 1,
      headers: { 'X-Auth-Token': this.cfg.PROVIDER_FOOTBALLDATA_KEY },
    }
  }

  private url(caminho: string, params: Record<string, string | number> = {}) {
    const u = new URL(
      `${this.cfg.PROVIDER_FOOTBALLDATA_BASE_URL}/competitions/${this.cfg.PROVIDER_FOOTBALLDATA_COMPETITION}${caminho}`,
    )
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    return u.toString()
  }

  async obterClassificacao(temporada: number): Promise<LinhaClassificacaoFonte[]> {
    const bruto = await buscarJson(this.url('/standings', { season: temporada }), this.opcoes)
    const d = validar(respostaStandings, bruto, 'standings')
    const total = d.standings.find((s) => s.type === 'TOTAL') ?? d.standings[0]!
    if (!total.table.length)
      throw new PayloadInvalido(FONTE_FOOTBALLDATA, [`tabela vazia para ${temporada}`])

    return total.table.map((l) => ({
      clube: l.team.shortName ?? l.team.name,
      posicao: l.position,
      pontos: l.points,
      jogos: l.playedGames,
      vitorias: l.won,
      empates: l.draw,
      derrotas: l.lost,
      golsPro: l.goalsFor,
      golsContra: l.goalsAgainst,
      saldoGols: l.goalDifference,
      aproveitamento: l.playedGames ? Math.round((l.points / (l.playedGames * 3)) * 100) : 0,
      ref: {
        nome: l.team.shortName ?? l.team.name,
        idExterno: String(l.team.id),
        sigla: l.team.tla ?? undefined,
        escudoUrl: l.team.crest ?? undefined,
      },
    }))
  }

  async obterPartidas(temporada: number): Promise<PartidaFonte[]> {
    const bruto = await buscarJson(this.url('/matches', { season: temporada }), this.opcoes)
    const d = validar(respostaMatches, bruto, 'matches')

    return d.matches.map((m) => ({
      externoId: String(m.id),
      rodada: m.matchday ?? 0,
      mandante: {
        nome: m.homeTeam.shortName ?? m.homeTeam.name ?? '',
        idExterno: String(m.homeTeam.id),
        escudoUrl: m.homeTeam.crest ?? undefined,
      },
      visitante: {
        nome: m.awayTeam.shortName ?? m.awayTeam.name ?? '',
        idExterno: String(m.awayTeam.id),
        escudoUrl: m.awayTeam.crest ?? undefined,
      },
      inicioPrevisto: new Date(m.utcDate),
      inicioConfirmado: m.status === 'TIMED' || m.status === 'FINISHED' || m.status === 'IN_PLAY',
      estadio: null,
      status: STATUS[m.status] ?? 'agendada',
      golsMandante: m.score.fullTime.home ?? null,
      golsVisitante: m.score.fullTime.away ?? null,
    }))
  }
}
