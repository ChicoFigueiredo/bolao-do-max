/**
 * Provedor GE — `api.globoesporte.globo.com`.
 *
 * Substitui o scraping por regex sobre HTML do sistema atual. As rotas não
 * são documentadas, mas devolvem JSON estruturado e estão em uso público
 * desde 2020 (pacote R `williamorim/brasileirao`). Sem cadastro, sem chave e
 * sem cota — é a fonte que carrega a alta frequência.
 *
 * Sem SLA: o payload pode mudar sem aviso. Por isso tudo passa por validação
 * de schema, e por isso existem outras duas fontes.
 */
import { montarUrl, type Configuracao } from '@bolao/config'
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

export const FONTE_GE = 'ge'

/** O GE às vezes manda número como string. `coerce` normaliza os dois casos. */
const numero = z.coerce.number()

const linhaClassificacao = z.object({
  ordem: numero,
  nome_popular: z.string().min(1),
  sigla: z.string().nullish(),
  escudo: z.string().nullish(),
  equipe_id: numero,
  pontos: numero,
  jogos: numero,
  vitorias: numero,
  empates: numero,
  derrotas: numero,
  gols_pro: numero,
  gols_contra: numero,
  saldo_gols: numero,
  aproveitamento: numero.nullish(),
  variacao: numero.nullish(),
})

const respostaClassificacao = z.object({
  classificacao: z.array(linhaClassificacao).min(1),
})

const equipe = z.object({
  id: numero,
  nome_popular: z.string().min(1),
  sigla: z.string().nullish(),
  escudo: z.string().nullish(),
})

const jogo = z.object({
  id: numero.nullish(),
  data_realizacao: z.string().nullish(),
  hora_realizacao: z.string().nullish(),
  placar_oficial_mandante: numero.nullish(),
  placar_oficial_visitante: numero.nullish(),
  equipes: z.object({ mandante: equipe, visitante: equipe }),
  sede: z.object({ nome_popular: z.string().nullish() }).nullish(),
  jogo_ja_comecou: z.boolean().nullish(),
})

const respostaJogos = z.array(jogo)

function validar<T>(e: z.ZodType<T>, dado: unknown, contexto: string): T {
  const r = e.safeParse(dado)
  if (!r.success)
    throw new PayloadInvalido(
      FONTE_GE,
      r.error.issues.slice(0, 8).map((i) => `${contexto} → ${i.path.join('.')}: ${i.message}`),
    )
  return r.data
}

/**
 * O GE devolve `data_realizacao` sem fuso. É horário de Brasília.
 * Jogos distantes vêm com um `T12:00` de fachada e sem `hora_realizacao` —
 * é esse campo que distingue horário confirmado de provisório.
 */
function interpretarInicio(data?: string | null): Date | null {
  if (!data) return null
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(data) ? data : `${data}:00-03:00`
  const d = new Date(iso.length === 16 ? `${data}:00-03:00` : iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function deduzirStatus(j: z.infer<typeof jogo>): StatusPartidaFonte {
  if (!j.data_realizacao) return 'adiada'
  if (j.placar_oficial_mandante != null && j.placar_oficial_visitante != null) return 'encerrada'
  if (j.jogo_ja_comecou) return 'em_andamento'
  return 'agendada'
}

export class ProvedorGE implements ProvedorEsportivo {
  readonly nome = FONTE_GE
  readonly capacidades = ['classificacao', 'partidas'] as const

  constructor(private readonly cfg: Configuracao) {}

  /** Fonte gratuita e sem cota. */
  custo(_operacao: Capacidade, _temporada: number): number {
    return 0
  }

  private get opcoes() {
    return {
      fonte: FONTE_GE,
      timeoutMs: this.cfg.PROVIDER_GE_TIMEOUT_MS,
      retry: this.cfg.PROVIDER_GE_RETRY,
      headers: { 'User-Agent': this.cfg.PROVIDER_GE_USER_AGENT },
    }
  }

  async obterClassificacao(temporada: number): Promise<LinhaClassificacaoFonte[]> {
    const url = montarUrl(this.cfg.PROVIDER_GE_URL_CLASSIFICACAO, { temporada })
    const bruto = await buscarJson(url, this.opcoes)
    const { classificacao } = validar(respostaClassificacao, bruto, 'classificacao')

    return classificacao.map((l) => ({
      clube: l.nome_popular,
      posicao: l.ordem,
      pontos: l.pontos,
      jogos: l.jogos,
      vitorias: l.vitorias,
      empates: l.empates,
      derrotas: l.derrotas,
      golsPro: l.gols_pro,
      golsContra: l.gols_contra,
      saldoGols: l.saldo_gols,
      aproveitamento: l.aproveitamento ?? undefined,
      ref: {
        nome: l.nome_popular,
        idExterno: String(l.equipe_id),
        sigla: l.sigla ?? undefined,
        escudoUrl: l.escudo ?? undefined,
      },
    }))
  }

  /**
   * Percorre as rodadas até uma vir vazia — que é como o GE sinaliza o fim
   * do campeonato (a rodada 39 devolve `[]`). O teto evita laço infinito se
   * a fonte passar a responder outra coisa.
   */
  async obterPartidas(temporada: number, _serie?: string, tetoRodadas = 60): Promise<PartidaFonte[]> {
    const todas: PartidaFonte[] = []

    for (let rodada = 1; rodada <= tetoRodadas; rodada++) {
      const url = montarUrl(this.cfg.PROVIDER_GE_URL_AGENDA, { temporada, rodada })
      const bruto = await buscarJson(url, this.opcoes)
      const jogos = validar(respostaJogos, bruto, `rodada ${rodada}`)
      if (jogos.length === 0) break

      for (const j of jogos) {
        todas.push({
          externoId: j.id != null ? String(j.id) : null,
          rodada,
          mandante: {
            nome: j.equipes.mandante.nome_popular,
            idExterno: String(j.equipes.mandante.id),
            sigla: j.equipes.mandante.sigla ?? undefined,
            escudoUrl: j.equipes.mandante.escudo ?? undefined,
          },
          visitante: {
            nome: j.equipes.visitante.nome_popular,
            idExterno: String(j.equipes.visitante.id),
            sigla: j.equipes.visitante.sigla ?? undefined,
            escudoUrl: j.equipes.visitante.escudo ?? undefined,
          },
          inicioPrevisto: interpretarInicio(j.data_realizacao),
          inicioConfirmado: Boolean(j.hora_realizacao),
          estadio: j.sede?.nome_popular ?? null,
          status: deduzirStatus(j),
          golsMandante: j.placar_oficial_mandante ?? null,
          golsVisitante: j.placar_oficial_visitante ?? null,
        })
      }
    }

    return todas
  }
}
