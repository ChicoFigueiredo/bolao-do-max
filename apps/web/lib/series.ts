import 'server-only'
import { carregarConfig } from '@bolao/config'
import { abrirBanco, competidor, snapshot, snapshotCompetidor, temporada } from '@bolao/db'
import { and, asc, eq, gte } from 'drizzle-orm'

/**
 * Séries temporais de posição, para a aba Evolução.
 *
 * Sai dos snapshots que o worker grava — dado que o sistema atual descarta por
 * completo. O protótipo prevê duas janelas: 48 horas e 21 dias.
 *
 * Snapshot só existe quando a tabela muda, então os pontos são irregulares no
 * tempo. A reamostragem abaixo coloca cada janela numa grade fixa, repetindo o
 * último valor conhecido — é o que faz a curva ter sentido visual sem inventar
 * dado que não existe.
 */

export type Janela = 'hora' | 'dia'
export type Bolao = 'classico' | 'posicao'

export type SerieTemporal = {
  rotulos: string[]
  /** nome do competidor → posição em cada ponto da grade */
  posicao: Record<string, number[]>
  /** quantos snapshots reais alimentaram a janela */
  pontosReais: number
}

export type Historico = Record<Janela, Record<Bolao, SerieTemporal>>

const VAZIA: SerieTemporal = { rotulos: [], posicao: {}, pontosReais: 0 }

const rotuloHora = (d: Date) =>
  d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })

const rotuloDia = (d: Date) =>
  d.toLocaleString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Sao_Paulo' })

export async function lerHistorico(): Promise<Historico> {
  const cfg = carregarConfig()
  const { db, fechar } = abrirBanco()

  try {
    const [t] = await db
      .select({ id: temporada.id })
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) return vazio()

    const desde = new Date(Date.now() - 22 * 86_400_000)
    const linhas = await db
      .select({
        em: snapshot.criadoEm,
        nome: competidor.nome,
        classico: snapshotCompetidor.classicoPosicao,
        posicao: snapshotCompetidor.posicaoPosicao,
      })
      .from(snapshotCompetidor)
      .innerJoin(snapshot, eq(snapshot.id, snapshotCompetidor.snapshotId))
      .innerJoin(competidor, eq(competidor.id, snapshotCompetidor.competidorId))
      .where(and(eq(snapshot.temporadaId, t.id), gte(snapshot.criadoEm, desde)))
      .orderBy(asc(snapshot.criadoEm))

    if (!linhas.length) return vazio()

    // Agrupa por instante de snapshot
    const porInstante = new Map<number, Map<string, { classico: number | null; posicao: number | null }>>()
    for (const l of linhas) {
      const k = l.em.getTime()
      if (!porInstante.has(k)) porInstante.set(k, new Map())
      porInstante.get(k)!.set(l.nome, { classico: l.classico, posicao: l.posicao })
    }
    const instantes = [...porInstante.keys()].sort((a, b) => a - b)

    return {
      hora: {
        classico: reamostrar(instantes, porInstante, 'classico', 48, 3_600_000, rotuloHora),
        posicao: reamostrar(instantes, porInstante, 'posicao', 48, 3_600_000, rotuloHora),
      },
      dia: {
        classico: reamostrar(instantes, porInstante, 'classico', 21, 86_400_000, rotuloDia),
        posicao: reamostrar(instantes, porInstante, 'posicao', 21, 86_400_000, rotuloDia),
      },
    }
  } finally {
    await fechar()
  }
}

function vazio(): Historico {
  return {
    hora: { classico: VAZIA, posicao: VAZIA },
    dia: { classico: VAZIA, posicao: VAZIA },
  }
}

/**
 * Coloca os snapshots numa grade de `passos` intervalos regulares.
 *
 * Cada célula recebe o último valor conhecido até ali. Células antes do
 * primeiro snapshot ficam de fora — nunca se inventa o passado.
 */
function reamostrar(
  instantes: number[],
  dados: Map<number, Map<string, { classico: number | null; posicao: number | null }>>,
  campo: Bolao,
  passos: number,
  intervaloMs: number,
  rotular: (d: Date) => string,
): SerieTemporal {
  const agora = Date.now()
  const inicioGrade = agora - (passos - 1) * intervaloMs
  const primeiro = instantes[0]!

  const grade: number[] = []
  for (let i = 0; i < passos; i++) {
    const t = inicioGrade + i * intervaloMs
    if (t >= primeiro - intervaloMs) grade.push(t)
  }
  if (grade.length < 2) return VAZIA

  const nomes = new Set<string>()
  for (const m of dados.values()) for (const n of m.keys()) nomes.add(n)

  const posicao: Record<string, number[]> = {}
  let usados = new Set<number>()

  for (const nome of nomes) {
    const serie: number[] = []
    let ultimo: number | null = null
    for (const alvo of grade) {
      for (const inst of instantes) {
        if (inst > alvo) break
        const v = dados.get(inst)!.get(nome)?.[campo]
        if (v != null) {
          ultimo = v
          usados.add(inst)
        }
      }
      if (ultimo != null) serie.push(ultimo)
    }
    // Só entra quem tem a série completa na grade — curva truncada engana.
    if (serie.length === grade.length && serie.length >= 2) posicao[nome] = serie
  }

  const comSerie = Object.keys(posicao).length
  if (!comSerie) return VAZIA

  return {
    rotulos: grade.map((t) => rotular(new Date(t))),
    posicao,
    pontosReais: usados.size,
  }
}
