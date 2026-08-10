/**
 * Snapshots da série temporal.
 *
 * Grava **só quando a tabela muda de verdade**. Uma tabela de futebol muda
 * algumas vezes por dia, não a cada minuto: o hash derruba o volume de
 * milhões de linhas por ano para dezenas de milhares, e é por isso que o
 * histórico completo cabe indefinidamente sem política de expurgo.
 *
 * A unicidade de `(temporada, hash)` no banco é a garantia final — mesmo que
 * dois ciclos rodem em paralelo, o segundo não duplica.
 */
import { clube, competidor, snapshot, snapshotClube, snapshotCompetidor, type Banco } from '@bolao/db'
import type { LinhaClassico, LinhaPosicao, Tabela } from '@bolao/dominio'
import { and, desc, eq } from 'drizzle-orm'

/**
 * Hash estável da classificação. Depende só dos fatos — clube, pontos, jogos
 * e gols — e não da ordem em que vieram, para que reordenação por critério de
 * desempate não conte como mudança.
 */
export function hashTabela(tabela: Tabela): string {
  const canonico = tabela
    .map((l) => `${l.clube}:${l.pontos}:${l.jogos}:${l.vitorias}:${l.empates}:${l.golsPro}:${l.golsContra}`)
    .sort()
    .join('|')
  return Bun.hash(canonico).toString(16)
}

export type ResultadoSnapshot =
  | { gravou: false; motivo: 'inalterado'; snapshotId: number }
  | { gravou: true; snapshotId: number; hash: string }

export async function gravarSnapshot(
  db: Banco,
  temporadaId: number,
  origem: string,
  tabela: Tabela,
  classico: LinhaClassico[],
  posicao: LinhaPosicao[],
  rodada?: number,
  opcoes: { sempre?: boolean } = {},
): Promise<ResultadoSnapshot> {
  const hash = hashTabela(tabela)

  if (opcoes.sempre) return await inserir(db, temporadaId, hash, origem, tabela, classico, posicao, rodada)

  const [ultimo] = await db
    .select({ id: snapshot.id, hash: snapshot.hash })
    .from(snapshot)
    .where(eq(snapshot.temporadaId, temporadaId))
    .orderBy(desc(snapshot.criadoEm))
    .limit(1)

  if (ultimo?.hash === hash) return { gravou: false, motivo: 'inalterado', snapshotId: ultimo.id }

  const [existente] = await db
    .select({ id: snapshot.id })
    .from(snapshot)
    .where(and(eq(snapshot.temporadaId, temporadaId), eq(snapshot.hash, hash)))
  if (existente) return { gravou: false, motivo: 'inalterado', snapshotId: existente.id }

  return await inserir(db, temporadaId, hash, origem, tabela, classico, posicao, rodada)
}

async function inserir(
  db: Banco,
  temporadaId: number,
  hash: string,
  origem: string,
  tabela: Tabela,
  classico: LinhaClassico[],
  posicao: LinhaPosicao[],
  rodada?: number,
): Promise<ResultadoSnapshot> {
  const [novo] = await db
    .insert(snapshot)
    .values({ temporadaId, hash, origem, rodada: rodada ?? null })
    .returning({ id: snapshot.id })
  const snapshotId = novo!.id

  const clubes = new Map((await db.select().from(clube)).map((c) => [c.nome, c.id]))
  const pessoas = new Map((await db.select().from(competidor)).map((c) => [c.nome, c.id]))

  const linhasClube = tabela
    .filter((l) => clubes.has(l.clube))
    .map((l) => ({
      snapshotId,
      clubeId: clubes.get(l.clube)!,
      posicao: l.posicao,
      pontos: l.pontos,
      jogos: l.jogos,
      vitorias: l.vitorias,
      empates: l.empates,
      derrotas: l.derrotas,
      golsPro: l.golsPro,
      golsContra: l.golsContra,
      saldoGols: l.saldoGols,
      aproveitamento: l.aproveitamento ?? null,
    }))
  if (linhasClube.length) await db.insert(snapshotClube).values(linhasClube)

  const porPosicao = new Map(posicao.map((l) => [l.nome, l]))
  const linhasComp = classico
    .filter((l) => pessoas.has(l.nome))
    .map((l) => {
      const p = porPosicao.get(l.nome)
      return {
        snapshotId,
        competidorId: pessoas.get(l.nome)!,
        classicoPontos: l.pontos,
        classicoSaldoGols: l.saldoGols,
        classicoGolsPro: l.golsPro,
        classicoGolsContra: l.golsContra,
        classicoPosicao: l.posicao,
        classicoPremioCentavos: l.premioCentavos,
        posicaoPontos: p?.pontos ?? null,
        posicaoAcertosFaixa: p?.acertosFaixa ?? null,
        posicaoAcertosG4: p?.acertosG4 ?? null,
        posicaoAcertosZ4: p?.acertosZ4 ?? null,
        posicaoPosicao: p?.posicao ?? null,
        posicaoPremioCentavos: p?.premioCentavos ?? 0,
      }
    })
  if (linhasComp.length) await db.insert(snapshotCompetidor).values(linhasComp)

  return { gravou: true, snapshotId, hash }
}
