/**
 * O ciclo do worker.
 *
 *   cadência devida? → ingerir partidas → calcular tabela e rankings
 *   → reconciliar com as fontes → snapshot se mudou → publicar no cache
 *
 * Idempotente: rodar duas vezes seguidas não produz efeito diferente de rodar
 * uma. Falha em qualquer fonte não interrompe o ciclo — o resultado sai do que
 * está no banco, e a falha fica registrada.
 */
import type { Configuracao } from '@bolao/config'
import {
  abrirBanco,
  clube,
  clubeAlias,
  divergencia,
  fonteChamada,
  partida,
  temporada,
  type Banco,
} from '@bolao/db'
import {
  ProvedorGE,
  montarProvedores,
  reconciliar,
  type LinhaClassificacaoFonte,
  type ResultadoReconciliacao,
} from '@bolao/provider'
import { and, eq } from 'drizzle-orm'
import { Cache } from '../cache.ts'
import { decidirCadencia, type Cadencia } from './cadencia.ts'
import { calcularRankings } from './calcular.ts'
import { prerenderizar } from './prerender.ts'
import { gravarSnapshot } from './snapshot.ts'
import { sincronizarCalendario } from './sincronizar-partidas.ts'

export type ResultadoCiclo = {
  cadencia: Cadencia
  partidas: { inseridas: number; atualizadas: number; inalteradas: number; alteracoes: number }
  snapshot: { gravou: boolean; id: number }
  reconciliacao: ResultadoReconciliacao | null
  publicouCache: boolean
  prerender: { detalhes: number; series: number }
  duracaoMs: number
}

async function dicionarioDeClubes(db: Banco) {
  const canonicos = await db.select({ id: clube.id, nome: clube.nome }).from(clube)
  const aliases = await db
    .select({ chave: clubeAlias.chave, clubeId: clubeAlias.clubeId })
    .from(clubeAlias)
  const mapa = new Map<string, string>()
  for (const c of canonicos) mapa.set(c.nome, String(c.id))
  for (const a of aliases) mapa.set(a.chave, String(a.clubeId))
  return (nome: string) => mapa.get(nome) ?? null
}

/**
 * Rodadas que valem consultar agora: a de qualquer jogo não encerrado nas
 * próximas 48 h ou nas últimas 24 h, mais a rodada corrente. Tipicamente
 * duas ou três — contra as 38 de uma varredura completa.
 */
async function rodadasDeInteresse(db: Banco, temporadaId: number): Promise<number[] | undefined> {
  const agora = new Date()
  const linhas = await db
    .select({ rodada: partida.rodada, inicio: partida.inicioPrevisto, status: partida.status })
    .from(partida)
    .where(eq(partida.temporadaId, temporadaId))

  // Banco vazio: não há como saber quais rodadas interessam sem antes ter o
  // calendário. `undefined` pede a varredura completa — é o único momento em
  // que ela é justificada fora do sincronismo diário.
  if (linhas.length === 0) return undefined

  const interessa = new Set<number>()
  for (const l of linhas) {
    if (l.status === 'adiada') interessa.add(l.rodada)
    if (!l.inicio) continue
    const horas = (l.inicio.getTime() - agora.getTime()) / 3_600_000
    if (horas < 48 && horas > -24) interessa.add(l.rodada)
    if (l.status !== 'encerrada' && horas < 0) interessa.add(l.rodada)
  }

  // Fallback: nada na janela (entre rodadas) — pega a primeira não encerrada.
  if (!interessa.size) {
    const pendentes = linhas.filter((l) => l.status !== 'encerrada').map((l) => l.rodada)
    if (pendentes.length) interessa.add(Math.min(...pendentes))
  }

  return [...interessa].sort((a, b) => a - b)
}

export async function executarCiclo(
  cfg: Configuracao,
  opcoes: { forcar?: boolean; calendarioCompleto?: boolean; db?: Banco; cache?: Cache } = {},
): Promise<ResultadoCiclo> {
  const t0 = performance.now()
  const proprio = !opcoes.db
  const conexao = opcoes.db ? null : abrirBanco()
  const db = opcoes.db ?? conexao!.db
  const cache = opcoes.cache ?? new Cache(cfg)

  try {
    const [t] = await db
      .select()
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) throw new Error(`temporada ${cfg.TEMPORADA_ATUAL} não existe — rode \`bun run db:seed\``)

    // 1. Ingerir partidas — só as rodadas que podem ter mudado.
    //    O calendário completo custa 38 requisições e é sincronismo diário
    //    (§calendarioCompleto). Varrê-lo a cada ciclo repetiria o desperdício
    //    do sistema atual, que bate 80 vezes por hora no ge.globo o ano todo.
    const ge = new ProvedorGE(cfg)
    const rodadas = opcoes.calendarioCompleto ? undefined : await rodadasDeInteresse(db, t.id)
    const sync = await sincronizarCalendario(db, cfg, ge, cfg.TEMPORADA_ATUAL, rodadas)

    // 2. Decidir a cadência DEPOIS de ingerir: é o sincronismo que atualiza o
    //    calendário, e no primeiro ciclo de um banco vazio decidir antes leria
    //    uma tabela sem partidas e concluiria "fora de temporada".
    const cadencia = await decidirCadencia(db, t.id, cfg)

    // 3. Calcular a partir do banco
    const { tabela, classico, posicao } = await calcularRankings(db, t.id)

    // 4. Conferir com as fontes, quando a cadência mandar
    let reconciliacao: ResultadoReconciliacao | null = null
    if (cadencia.conferirComApis || opcoes.forcar) {
      const resolver = await dicionarioDeClubes(db)
      const fontes: Record<string, LinhaClassificacaoFonte[]> = {}
      for (const p of montarProvedores(cfg)) {
        if (!p.obterClassificacao) continue
        const inicio = performance.now()
        try {
          fontes[p.nome] = await p.obterClassificacao(cfg.TEMPORADA_ATUAL, cfg.SERIE)
          await db.insert(fonteChamada).values({
            fonte: p.nome,
            operacao: 'classificacao',
            sucesso: true,
            duracaoMs: Math.round(performance.now() - inicio),
          })
        } catch (e) {
          await db.insert(fonteChamada).values({
            fonte: p.nome,
            operacao: 'classificacao',
            sucesso: false,
            duracaoMs: Math.round(performance.now() - inicio),
            erro: e instanceof Error ? e.message.slice(0, 500) : String(e),
          })
        }
      }

      if (Object.keys(fontes).length) {
        reconciliacao = reconciliar(tabela, fontes, resolver)
        const reais = reconciliacao.divergencias.filter((d) => d.severidade === 'estatistica')
        if (reais.length && cfg.RECONCILIACAO_ALARMA_DIVERGENCIA)
          await db.insert(divergencia).values({
            temporadaId: t.id,
            tipo: 'tabela_calculada_vs_fonte',
            detalhe: { divergencias: reais, fontes: reconciliacao.fontesConsultadas },
          })
        if (reconciliacao.naoResolvidos.length)
          await db.insert(divergencia).values({
            temporadaId: t.id,
            tipo: 'clube_nao_resolvido',
            detalhe: { clubes: reconciliacao.naoResolvidos },
          })
      }
    }

    // 5. Snapshot. `gravarSnapshot` já compara o hash e não duplica; a flag
    //    de configuração existe só para depuração, quando se quer registrar
    //    todo ciclo mesmo sem mudança.
    const rodadaAtual = Math.max(0, ...tabela.map((l) => l.jogos))
    const snap = await gravarSnapshot(db, t.id, 'ge', tabela, classico, posicao, rodadaAtual, {
      sempre: !cfg.WORKER_SNAPSHOT_SOMENTE_MUDANCA,
    })

    // 6. Publicar o cache derivado
    await cache.publicarResultado({
      temporada: t.ano,
      serie: t.serie,
      atualizadoEm: new Date().toISOString(),
      rodada: rodadaAtual || null,
      tabela,
      classico,
      posicao,
      fontes: reconciliacao?.fontesConsultadas ?? ['ge'],
      origem: 'worker',
    })

    // 7. Pré-renderizar detalhe e séries: toque na tela vira leitura de chave.
    const pre = await prerenderizar(db, cache, t.ano, t.id, classico, posicao)

    return {
      cadencia,
      partidas: {
        inseridas: sync.inseridas,
        atualizadas: sync.atualizadas,
        inalteradas: sync.inalteradas,
        alteracoes: sync.alteracoes.length,
      },
      snapshot: { gravou: snap.gravou, id: snap.snapshotId },
      reconciliacao,
      publicouCache: true,
      prerender: pre,
      duracaoMs: Math.round(performance.now() - t0),
    }
  } finally {
    if (!opcoes.cache) cache.close()
    if (proprio) await conexao!.fechar()
  }
}
