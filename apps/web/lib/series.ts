import 'server-only'
import { carregarConfig } from '@bolao/config'
import { abrirBanco, competidor, snapshot, snapshotCompetidor, temporada } from '@bolao/db'
import { and, asc, eq } from 'drizzle-orm'

/**
 * Séries temporais de posição, para a aba Evolução.
 *
 * Sai dos snapshots que o worker grava — dado que o sistema atual descarta por
 * completo. Três janelas:
 *
 *   hora      últimas 48 horas, ponto a cada hora
 *   dia       últimos 30 dias, ponto por dia
 *   semana    campeonato inteiro, ponto por semana
 *
 * Snapshot só existe quando a tabela muda, então os pontos são irregulares no
 * tempo. A reamostragem coloca cada janela numa grade fixa, repetindo o último
 * valor conhecido — é o que faz a curva ter sentido visual sem inventar dado.
 */

export type Janela = 'hora' | 'dia' | 'semana'
export type Bolao = 'classico' | 'posicao'

export const JANELAS: Record<Janela, { rotulo: string; periodo: string }> = {
  hora: { rotulo: '48 horas', periodo: 'últimas 48 horas' },
  dia: { rotulo: '30 dias', periodo: 'últimos 30 dias' },
  semana: { rotulo: 'Campeonato', periodo: 'campeonato inteiro, por semana' },
}

export type SerieTemporal = {
  rotulos: string[]
  /** nome do competidor → posição em cada ponto da grade */
  posicao: Record<string, number[]>
  /** quantos snapshots reais alimentaram a janela */
  pontosReais: number
}

export type Historico = Record<Janela, Record<Bolao, SerieTemporal>>

const VAZIA: SerieTemporal = { rotulos: [], posicao: {}, pontosReais: 0 }

const HORA_MS = 3_600_000
const DIA_MS = 86_400_000
const SEMANA_MS = 7 * DIA_MS

const fmt = (opts: Intl.DateTimeFormatOptions) => (d: Date) =>
  d.toLocaleString('pt-BR', { ...opts, timeZone: 'America/Sao_Paulo' })

const rotuloHora = fmt({ day: '2-digit', month: 'short', hour: '2-digit' })
const rotuloDia = fmt({ day: '2-digit', month: 'short' })
const rotuloSemana = fmt({ day: '2-digit', month: 'short' })

type Amostra = { classico: number | null; posicao: number | null }

export async function lerHistorico(): Promise<Historico> {
  const cfg = carregarConfig()
  const { db, fechar } = abrirBanco()

  try {
    const [t] = await db
      .select({ id: temporada.id })
      .from(temporada)
      .where(and(eq(temporada.ano, cfg.TEMPORADA_ATUAL), eq(temporada.serie, cfg.SERIE)))
    if (!t) return vazio()

    // A temporada inteira: a janela semanal precisa de tudo, e 146 snapshots
    // × 30 competidores é leitura barata.
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
      .where(eq(snapshot.temporadaId, t.id))
      .orderBy(asc(snapshot.criadoEm))

    if (!linhas.length) return vazio()

    const porInstante = new Map<number, Map<string, Amostra>>()
    for (const l of linhas) {
      const k = l.em.getTime()
      if (!porInstante.has(k)) porInstante.set(k, new Map())
      porInstante.get(k)!.set(l.nome, { classico: l.classico, posicao: l.posicao })
    }
    const instantes = [...porInstante.keys()].sort((a, b) => a - b)

    const grades = {
      hora: gradeRecente(instantes, 48, HORA_MS),
      dia: gradeRecente(instantes, 30, DIA_MS),
      semana: gradeDaTemporada(instantes, SEMANA_MS),
    }
    const rotulos = { hora: rotuloHora, dia: rotuloDia, semana: rotuloSemana }

    const montar = (j: Janela, b: Bolao) =>
      reamostrar(instantes, porInstante, b, grades[j], rotulos[j])

    return {
      hora: { classico: montar('hora', 'classico'), posicao: montar('hora', 'posicao') },
      dia: { classico: montar('dia', 'classico'), posicao: montar('dia', 'posicao') },
      semana: { classico: montar('semana', 'classico'), posicao: montar('semana', 'posicao') },
    }
  } finally {
    await fechar()
  }
}

function vazio(): Historico {
  return {
    hora: { classico: VAZIA, posicao: VAZIA },
    dia: { classico: VAZIA, posicao: VAZIA },
    semana: { classico: VAZIA, posicao: VAZIA },
  }
}

/**
 * Grade das últimas `passos` unidades até agora.
 *
 * A célula só entra se já existir snapshot para preenchê-la: admitir célula
 * anterior ao primeiro snapshot deixaria toda série mais curta que a grade e a
 * checagem de completude rejeitaria todas elas.
 */
function gradeRecente(instantes: number[], passos: number, intervaloMs: number): number[] {
  const agora = Date.now()
  const primeiro = instantes[0]!
  const grade: number[] = []
  for (let i = 0; i < passos; i++) {
    const t = agora - (passos - 1 - i) * intervaloMs
    if (t >= primeiro) grade.push(t)
  }
  return grade
}

/** Grade semanal do primeiro snapshot até agora — o campeonato inteiro. */
function gradeDaTemporada(instantes: number[], intervaloMs: number): number[] {
  const primeiro = instantes[0]!
  const agora = Date.now()
  const grade: number[] = []
  for (let t = primeiro; t <= agora; t += intervaloMs) grade.push(t)
  // Garante que a última semana parcial apareça, para o gráfico terminar no hoje.
  if (grade.length && grade.at(-1)! < agora - intervaloMs / 4) grade.push(agora)
  return grade
}

function reamostrar(
  instantes: number[],
  dados: Map<number, Map<string, Amostra>>,
  campo: Bolao,
  grade: number[],
  rotular: (d: Date) => string,
): SerieTemporal {
  if (grade.length < 2) return VAZIA

  const nomes = new Set<string>()
  for (const m of dados.values()) for (const n of m.keys()) nomes.add(n)

  const posicao: Record<string, number[]> = {}

  for (const nome of nomes) {
    const serie: number[] = []
    let ultimo: number | null = null
    let i = 0
    // Ponteiro único sobre `instantes`, que já está ordenado.
    for (const alvo of grade) {
      while (i < instantes.length && instantes[i]! <= alvo) {
        const v = dados.get(instantes[i]!)!.get(nome)?.[campo]
        if (v != null) ultimo = v
        i++
      }
      if (ultimo != null) serie.push(ultimo)
    }
    // Só entra quem tem a série completa na grade — curva truncada engana.
    if (serie.length === grade.length && serie.length >= 2) posicao[nome] = serie
  }

  if (!Object.keys(posicao).length) return VAZIA

  // Snapshots DENTRO da janela.
  //
  // Contar todos os que o ponteiro varreu incluía os anteriores à janela — o
  // primeiro ponto da grade precisa do último valor conhecido, que pode ser de
  // meses atrás. A janela de 48 horas reportava 146 snapshots quando tinha 9.
  const inicio = grade[0]!
  const fim = grade.at(-1)!
  const pontosReais = instantes.filter((t) => t >= inicio && t <= fim).length

  return { rotulos: grade.map((t) => rotular(new Date(t))), posicao, pontosReais }
}
