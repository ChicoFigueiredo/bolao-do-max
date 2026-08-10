/**
 * Calcula a tabela e os dois rankings a partir do banco.
 *
 * A classificação sai das partidas encerradas — não é buscada de ninguém.
 * A tabela da fonte, quando disponível, entra apenas como conferência.
 */
import {
  carregarApostadores,
  clube,
  partida,
  temporada,
  type Banco,
} from '@bolao/db'
import type { RegrasTemporada, ResultadoBolao, Tabela } from '@bolao/dominio'
import { calcularClassico, calcularPosicao, calcularTabela } from '@bolao/regras'
import { and, eq } from 'drizzle-orm'

export type Divergencia = { clube: string; campo: string; calculado: unknown; fonte: unknown }

export async function tabelaDoBanco(db: Banco, temporadaId: number): Promise<Tabela> {
  const encerradas = await db
    .select({
      mandante: partida.mandanteId,
      visitante: partida.visitanteId,
      golsMandante: partida.golsMandante,
      golsVisitante: partida.golsVisitante,
    })
    .from(partida)
    .where(and(eq(partida.temporadaId, temporadaId), eq(partida.status, 'encerrada')))

  const nomes = new Map(
    (await db.select({ id: clube.id, nome: clube.nome }).from(clube)).map((c) => [c.id, c.nome]),
  )

  const elenco = new Set<string>()
  const todas = await db
    .select({ mandante: partida.mandanteId, visitante: partida.visitanteId })
    .from(partida)
    .where(eq(partida.temporadaId, temporadaId))
  for (const p of todas) {
    elenco.add(nomes.get(p.mandante)!)
    elenco.add(nomes.get(p.visitante)!)
  }

  return calcularTabela(
    encerradas
      .filter((p) => p.golsMandante != null && p.golsVisitante != null)
      .map((p) => ({
        mandante: nomes.get(p.mandante)!,
        visitante: nomes.get(p.visitante)!,
        golsMandante: p.golsMandante!,
        golsVisitante: p.golsVisitante!,
      })),
    [...elenco],
  )
}

export async function calcularRankings(
  db: Banco,
  temporadaId: number,
): Promise<ResultadoBolao & { tabela: Tabela }> {
  const [t] = await db.select().from(temporada).where(eq(temporada.id, temporadaId))
  if (!t) throw new Error(`temporada ${temporadaId} não existe`)

  const regras = t.regras as RegrasTemporada
  const tabela = await tabelaDoBanco(db, temporadaId)
  const apostadores = await carregarApostadores(db, temporadaId)

  return {
    tabela,
    classico: t.temClassico ? calcularClassico(tabela, apostadores, regras) : [],
    posicao: t.temPosicao ? calcularPosicao(tabela, apostadores, regras) : [],
  }
}

/** Conferência: tabela calculada × tabela informada pela fonte. */
export function conferir(calculada: Tabela, fonte: Tabela): Divergencia[] {
  const idx = new Map(fonte.map((l) => [l.clube, l]))
  const d: Divergencia[] = []
  for (const c of calculada) {
    const f = idx.get(c.clube)
    if (!f) {
      d.push({ clube: c.clube, campo: 'ausente na fonte', calculado: c.posicao, fonte: null })
      continue
    }
    for (const campo of ['posicao', 'pontos', 'jogos', 'vitorias', 'saldoGols', 'golsPro'] as const)
      if (c[campo] !== f[campo])
        d.push({ clube: c.clube, campo, calculado: c[campo], fonte: f[campo] })
  }
  return d
}
