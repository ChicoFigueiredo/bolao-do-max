import 'server-only'
import { carregarConfig } from '@bolao/config'
import { abrirBanco, temporada } from '@bolao/db'
import type { LinhaClassico, LinhaPosicao, Tabela } from '@bolao/dominio'
import { Cache, type PayloadCache } from '@bolao/worker/cache'
import { calcularRankings } from '@bolao/worker/calcular'
import { calcularMovimento24h, type Movimento } from '@bolao/worker/series'
import { and, eq } from 'drizzle-orm'
import { umDeCadaVez } from './um-de-cada-vez'

/**
 * Janelas do modo degradado.
 *
 * Curtas o bastante para não esconder a recuperação do Redis, longas o
 * bastante para absorver uma rajada. Só valem no caminho de exceção.
 */
const TTL_RESULTADO_MS = 15_000
const TTL_MOVIMENTO_MS = 60_000

export type Resultado = PayloadCache & { origemLeitura: 'cache' | 'banco' }

/**
 * Conexões por processo, não por requisição.
 *
 * Abrir e fechar o Redis a cada render derruba a conexão com operações em voo
 * e produz rejeições não tratadas — foi exatamente o que aconteceu na primeira
 * versão. O client é barato de manter aberto e reconecta sozinho.
 *
 * O mesmo vale para o Postgres, e por um motivo mais duro: `abrirBanco()` cria
 * um *pool* de até DATABASE_POOL_MAX conexões. Uma por requisição significa que
 * N requisições simultâneas custam N × max conexões, e o Postgres esgota
 * `max_connections` — levando junto o worker e os outros inquilinos da
 * instância — muito antes de a CPU sentir. Era o dente do achado de
 * CWE-400 de 10/08/2026.
 *
 * `globalThis` porque o hot-reload do `next dev` reavalia o módulo e um
 * singleton de módulo acumularia uma conexão por recompilação.
 */
type Conexoes = { cache?: Cache; banco?: ReturnType<typeof abrirBanco> }
const conexoes: Conexoes = ((globalThis as { __bolao?: Conexoes }).__bolao ??= {})

export function cacheCompartilhado(cfg: ReturnType<typeof carregarConfig>): Cache {
  if (!conexoes.cache) conexoes.cache = new Cache(cfg)
  return conexoes.cache
}

/**
 * O pool do processo. Não se fecha: fechar por requisição é o bug.
 */
export function bancoCompartilhado() {
  if (!conexoes.banco) conexoes.banco = abrirBanco()
  return conexoes.banco.db
}

/**
 * Lê o resultado do cache; faltando, cai no Postgres.
 *
 * É a inversão que sustenta a arquitetura: o Redis é conveniência, não
 * dependência. Perder o cache tira desempenho, não funcionalidade.
 */
export async function lerResultado(): Promise<Resultado | null> {
  const cfg = carregarConfig()

  try {
    const c = cacheCompartilhado(cfg)
    const doCache = await c.lerResultado()
    if (doCache) {
      await c.registrarAcesso()
      return { ...doCache, origemLeitura: 'cache' }
    }
  } catch {
    /* Redis fora do ar — segue para o banco, que é a fonte da verdade */
  }

  // Daqui para baixo é o modo degradado, e ele é compartilhado: mil
  // requisições simultâneas custam um cálculo, não mil.
  return umDeCadaVez('resultado', TTL_RESULTADO_MS, async () => {
    const db = bancoCompartilhado()
    const [t] = await db
      .select()
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) return null
    const r = await calcularRankings(db, t.id)
    return {
      temporada: t.ano,
      serie: t.serie,
      atualizadoEm: new Date().toISOString(),
      rodada: Math.max(0, ...r.tabela.map((l) => l.jogos)) || null,
      tabela: r.tabela,
      classico: r.classico,
      posicao: r.posicao,
      fontes: ['banco'],
      origem: 'leitura direta',
      origemLeitura: 'banco',
    }
  })
}

export type { Movimento }

/**
 * Variação de posição nas últimas 24 h.
 *
 * Caminho comum: leitura de uma chave que o worker montou no fim do ciclo.
 * Antes esta função ia direto ao Postgres em toda visita à home — três
 * consultas e um pool de conexões por pessoa, com o cache saudável ou não.
 *
 * Caminho de exceção: a chave não está lá (worker ainda não rodou, cache
 * limpo). Aí calcula, coalescido, para a tela não perder as setinhas.
 */
export async function lerMovimento24h(): Promise<Movimento> {
  const cfg = carregarConfig()

  try {
    const pronto = await cacheCompartilhado(cfg).lerMovimento<Movimento>(cfg.TEMPORADA_ATUAL)
    if (pronto) return pronto
  } catch {
    /* Redis fora do ar — calcula */
  }

  return umDeCadaVez("movimento", TTL_MOVIMENTO_MS, async () => {
    const db = bancoCompartilhado()
    const [t] = await db
      .select({ id: temporada.id })
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) return {}
    return calcularMovimento24h(db, t.id)
  })
}

export type { LinhaClassico, LinhaPosicao, Tabela }
