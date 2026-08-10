/** Lê as apostas do banco no formato que o motor de regras consome. */
import type { Apostador, Grupo } from '@bolao/dominio'
import { asc, eq } from 'drizzle-orm'
import type { Banco } from '../index.ts'
import { apostaClassico, apostaPosicao, clube, competidor } from '../schema.ts'

export async function carregarApostadores(db: Banco, temporadaId: number): Promise<Apostador[]> {
  const classico = await db
    .select({
      competidor: competidor.nome,
      grupo: apostaClassico.grupo,
      clube: clube.nome,
      coracao: apostaClassico.coracao,
    })
    .from(apostaClassico)
    .innerJoin(competidor, eq(competidor.id, apostaClassico.competidorId))
    .innerJoin(clube, eq(clube.id, apostaClassico.clubeId))
    .where(eq(apostaClassico.temporadaId, temporadaId))
    .orderBy(asc(competidor.nome), asc(apostaClassico.grupo))

  const posicao = await db
    .select({
      competidor: competidor.nome,
      posicao: apostaPosicao.posicao,
      clube: clube.nome,
    })
    .from(apostaPosicao)
    .innerJoin(competidor, eq(competidor.id, apostaPosicao.competidorId))
    .innerJoin(clube, eq(clube.id, apostaPosicao.clubeId))
    .where(eq(apostaPosicao.temporadaId, temporadaId))
    .orderBy(asc(competidor.nome), asc(apostaPosicao.posicao))

  const porNome = new Map<string, Apostador>()
  const obter = (nome: string) => {
    let a = porNome.get(nome)
    if (!a) porNome.set(nome, (a = { nome, clubes: [], palpites: [] }))
    return a
  }

  for (const r of classico)
    obter(r.competidor).clubes.push({
      grupo: r.grupo as Grupo,
      clube: r.clube,
      coracao: r.coracao,
    })
  for (const r of posicao)
    obter(r.competidor).palpites.push({ clube: r.clube, posicao: r.posicao })

  return [...porNome.values()]
}
