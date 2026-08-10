/**
 * Provedor API-Football (API-Sports).
 *
 * Fonte autoritativa: entra como conferência e como resgate quando o GE
 * falha. Free tier de 100 req/dia e 10 req/min, com teto auto-imposto de 60
 * e 8 no `.env`. Cobre a Série A desde 2010, o que a torna também a fonte da
 * reconstrução histórica.
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

export const FONTE_APIFOOTBALL = 'apifootball'

const time = z.object({ id: z.number(), name: z.string(), logo: z.string().nullish() })

const linha = z.object({
  rank: z.number(),
  team: time,
  points: z.number(),
  goalsDiff: z.number(),
  all: z.object({
    played: z.number(),
    win: z.number(),
    draw: z.number(),
    lose: z.number(),
    goals: z.object({ for: z.number(), against: z.number() }),
  }),
})

const respostaStandings = z.object({
  errors: z.union([z.array(z.unknown()), z.record(z.string())]).optional(),
  response: z.array(
    z.object({ league: z.object({ standings: z.array(z.array(linha)).min(1) }) }),
  ),
})

const fixture = z.object({
  fixture: z.object({
    id: z.number(),
    date: z.string(),
    venue: z.object({ name: z.string().nullish() }).nullish(),
    status: z.object({ short: z.string() }),
  }),
  league: z.object({ round: z.string() }),
  teams: z.object({ home: time, away: time }),
  goals: z.object({ home: z.number().nullish(), away: z.number().nullish() }),
})

const respostaFixtures = z.object({
  errors: z.union([z.array(z.unknown()), z.record(z.string())]).optional(),
  response: z.array(fixture),
})

function validar<T>(e: z.ZodType<T>, dado: unknown, contexto: string): T {
  const r = e.safeParse(dado)
  if (!r.success)
    throw new PayloadInvalido(
      FONTE_APIFOOTBALL,
      r.error.issues.slice(0, 8).map((i) => `${contexto} → ${i.path.join('.')}: ${i.message}`),
    )
  return r.data
}

/** A API devolve erros no corpo com HTTP 200. Ignorar isso seria gravar lixo. */
function exigirSemErros(errors: unknown, contexto: string) {
  const vazio =
    errors == null ||
    (Array.isArray(errors) && errors.length === 0) ||
    (typeof errors === 'object' && Object.keys(errors as object).length === 0)
  if (!vazio) throw new PayloadInvalido(FONTE_APIFOOTBALL, [`${contexto}: ${JSON.stringify(errors)}`])
}

/** `"Regular Season - 21"` → 21 */
function extrairRodada(round: string): number {
  const m = /(\d+)\s*$/.exec(round)
  return m ? Number(m[1]) : 0
}

/** https://www.api-football.com/documentation-v3#section/Introduction/Status */
const STATUS: Record<string, StatusPartidaFonte> = {
  TBD: 'agendada',
  NS: 'agendada',
  '1H': 'em_andamento',
  HT: 'em_andamento',
  '2H': 'em_andamento',
  ET: 'em_andamento',
  BT: 'em_andamento',
  P: 'em_andamento',
  LIVE: 'em_andamento',
  FT: 'encerrada',
  AET: 'encerrada',
  PEN: 'encerrada',
  SUSP: 'adiada',
  INT: 'adiada',
  PST: 'adiada',
  CANC: 'cancelada',
  ABD: 'cancelada',
  AWD: 'encerrada',
  WO: 'encerrada',
}

export class ProvedorApiFootball implements ProvedorEsportivo {
  readonly nome = FONTE_APIFOOTBALL
  readonly capacidades = ['classificacao', 'partidas'] as const

  constructor(private readonly cfg: Configuracao) {}

  /** Uma requisição por operação: a API devolve a temporada inteira de uma vez. */
  custo(_operacao: Capacidade, _temporada: number): number {
    return 1
  }

  private get opcoes() {
    return {
      fonte: FONTE_APIFOOTBALL,
      timeoutMs: this.cfg.PROVIDER_APIFOOTBALL_TIMEOUT_MS,
      retry: 1,
      headers: { 'x-apisports-key': this.cfg.PROVIDER_APIFOOTBALL_KEY },
    }
  }

  private url(caminho: string, params: Record<string, string | number>) {
    const u = new URL(`${this.cfg.PROVIDER_APIFOOTBALL_BASE_URL}${caminho}`)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    return u.toString()
  }

  async obterClassificacao(temporada: number): Promise<LinhaClassificacaoFonte[]> {
    const bruto = await buscarJson(
      this.url('/standings', {
        league: this.cfg.PROVIDER_APIFOOTBALL_LEAGUE_ID,
        season: temporada,
      }),
      this.opcoes,
    )
    const d = validar(respostaStandings, bruto, 'standings')
    exigirSemErros(d.errors, 'standings')
    const tabela = d.response[0]?.league.standings[0]
    if (!tabela?.length)
      throw new PayloadInvalido(FONTE_APIFOOTBALL, [`standings vazio para a temporada ${temporada}`])

    return tabela.map((l) => ({
      clube: l.team.name,
      posicao: l.rank,
      pontos: l.points,
      jogos: l.all.played,
      vitorias: l.all.win,
      empates: l.all.draw,
      derrotas: l.all.lose,
      golsPro: l.all.goals.for,
      golsContra: l.all.goals.against,
      saldoGols: l.goalsDiff,
      aproveitamento: l.all.played ? Math.round((l.points / (l.all.played * 3)) * 100) : 0,
      ref: { nome: l.team.name, idExterno: String(l.team.id), escudoUrl: l.team.logo ?? undefined },
    }))
  }

  async obterPartidas(temporada: number): Promise<PartidaFonte[]> {
    const bruto = await buscarJson(
      this.url('/fixtures', {
        league: this.cfg.PROVIDER_APIFOOTBALL_LEAGUE_ID,
        season: temporada,
      }),
      this.opcoes,
    )
    const d = validar(respostaFixtures, bruto, 'fixtures')
    exigirSemErros(d.errors, 'fixtures')

    return d.response.map((f) => ({
      externoId: String(f.fixture.id),
      rodada: extrairRodada(f.league.round),
      mandante: {
        nome: f.teams.home.name,
        idExterno: String(f.teams.home.id),
        escudoUrl: f.teams.home.logo ?? undefined,
      },
      visitante: {
        nome: f.teams.away.name,
        idExterno: String(f.teams.away.id),
        escudoUrl: f.teams.away.logo ?? undefined,
      },
      inicioPrevisto: new Date(f.fixture.date),
      // A API sempre devolve horário; não distingue provisório de firme.
      inicioConfirmado: true,
      estadio: f.fixture.venue?.name ?? null,
      status: STATUS[f.fixture.status.short] ?? 'agendada',
      golsMandante: f.goals.home ?? null,
      golsVisitante: f.goals.away ?? null,
    }))
  }
}
