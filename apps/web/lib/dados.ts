import 'server-only'
import { carregarConfig } from '@bolao/config'
import { abrirBanco, snapshot, snapshotCompetidor, competidor, temporada } from '@bolao/db'
import type { LinhaClassico, LinhaPosicao, Tabela } from '@bolao/dominio'
import { Cache, type PayloadCache } from '@bolao/worker/cache'
import { calcularRankings } from '@bolao/worker/calcular'
import { and, asc, desc, eq, gte } from 'drizzle-orm'

export type Resultado = PayloadCache & { origemLeitura: 'cache' | 'banco' }

/**
 * Um cliente Redis por processo, não por requisição.
 *
 * Abrir e fechar a cada render derruba a conexão com operações em voo e
 * produz rejeições não tratadas — foi exatamente o que aconteceu na primeira
 * versão. O client é barato de manter aberto e reconecta sozinho.
 */
let clienteCache: Cache | undefined
function cacheCompartilhado(cfg: ReturnType<typeof carregarConfig>): Cache {
  if (!clienteCache) clienteCache = new Cache(cfg)
  return clienteCache
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

  const { db, fechar } = abrirBanco()
  try {
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
  } finally {
    await fechar()
  }
}

export type Movimento = Record<string, { classico: number | null; posicao: number | null }>

/**
 * Variação de posição nas últimas 24 h, dos snapshots.
 *
 * É o que alimenta as setinhas do design. Sai da série temporal, que só
 * existe porque o worker snapshota — dado que o sistema atual joga fora.
 */
export async function lerMovimento24h(): Promise<Movimento> {
  const cfg = carregarConfig()
  const { db, fechar } = abrirBanco()
  try {
    const [t] = await db
      .select({ id: temporada.id })
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) return {}

    const ontem = new Date(Date.now() - 86_400_000)
    const [antigo] = await db
      .select({ id: snapshot.id })
      .from(snapshot)
      .where(and(eq(snapshot.temporadaId, t.id), gte(snapshot.criadoEm, ontem)))
      .orderBy(asc(snapshot.criadoEm))
      .limit(1)
    const [recente] = await db
      .select({ id: snapshot.id })
      .from(snapshot)
      .where(eq(snapshot.temporadaId, t.id))
      .orderBy(desc(snapshot.criadoEm))
      .limit(1)

    if (!antigo || !recente || antigo.id === recente.id) return {}

    const linhas = async (id: number) =>
      db
        .select({
          nome: competidor.nome,
          classico: snapshotCompetidor.classicoPosicao,
          posicao: snapshotCompetidor.posicaoPosicao,
        })
        .from(snapshotCompetidor)
        .innerJoin(competidor, eq(competidor.id, snapshotCompetidor.competidorId))
        .where(eq(snapshotCompetidor.snapshotId, id))

    const [antes, agora] = await Promise.all([linhas(antigo.id), linhas(recente.id)])
    const mapaAntes = new Map(antes.map((l) => [l.nome, l]))

    const mov: Movimento = {}
    for (const a of agora) {
      const b = mapaAntes.get(a.nome)
      if (!b) continue
      mov[a.nome] = {
        classico: b.classico != null && a.classico != null ? b.classico - a.classico : null,
        posicao: b.posicao != null && a.posicao != null ? b.posicao - a.posicao : null,
      }
    }
    return mov
  } finally {
    await fechar()
  }
}

export type { LinhaClassico, LinhaPosicao, Tabela }
