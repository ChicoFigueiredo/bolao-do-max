/**
 * Classificação calculada a partir das partidas.
 *
 * É isto que torna nenhuma fonte de classificação indispensável: conhecendo
 * os resultados, a tabela é uma projeção. Também é a base do simulador —
 * simular é chamar esta função com placares hipotéticos.
 *
 * Critérios de desempate conforme o regulamento do Brasileirão publicado
 * pelo próprio GE: 1) mais vitórias; 2) melhor saldo de gols; 3) mais gols
 * pró. Confronto direto e cartões não são modelados — os dados de cartão não
 * vêm nas fontes usadas, então o desempate final cai em ordem alfabética,
 * que é determinístico e explícito.
 */
import type { LinhaTabela, Tabela } from '@bolao/dominio'

export type PartidaEncerrada = {
  mandante: string
  visitante: string
  golsMandante: number
  golsVisitante: number
}

const zerado = (clube: string): LinhaTabela => ({
  clube,
  posicao: 0,
  pontos: 0,
  jogos: 0,
  vitorias: 0,
  empates: 0,
  derrotas: 0,
  golsPro: 0,
  golsContra: 0,
  saldoGols: 0,
})

/**
 * @param clubes elenco da temporada. Passar explicitamente garante que um
 *   clube sem jogos disputados ainda apareça na tabela, zerado.
 */
export function calcularTabela(partidas: PartidaEncerrada[], clubes?: string[]): Tabela {
  const m = new Map<string, LinhaTabela>()
  const obter = (c: string) => {
    let l = m.get(c)
    if (!l) m.set(c, (l = zerado(c)))
    return l
  }
  for (const c of clubes ?? []) obter(c)

  for (const p of partidas) {
    const casa = obter(p.mandante)
    const fora = obter(p.visitante)

    casa.jogos++
    fora.jogos++
    casa.golsPro += p.golsMandante
    casa.golsContra += p.golsVisitante
    fora.golsPro += p.golsVisitante
    fora.golsContra += p.golsMandante

    if (p.golsMandante > p.golsVisitante) {
      casa.vitorias++
      casa.pontos += 3
      fora.derrotas++
    } else if (p.golsMandante < p.golsVisitante) {
      fora.vitorias++
      fora.pontos += 3
      casa.derrotas++
    } else {
      casa.empates++
      fora.empates++
      casa.pontos++
      fora.pontos++
    }
  }

  const tabela = [...m.values()]
  for (const l of tabela) {
    l.saldoGols = l.golsPro - l.golsContra
    l.aproveitamento = l.jogos ? Math.round((l.pontos / (l.jogos * 3)) * 100) : 0
  }

  tabela.sort(
    (a, b) =>
      b.pontos - a.pontos ||
      b.vitorias - a.vitorias ||
      b.saldoGols - a.saldoGols ||
      b.golsPro - a.golsPro ||
      a.clube.localeCompare(b.clube, 'pt-BR'),
  )
  tabela.forEach((l, i) => (l.posicao = i + 1))
  return tabela
}
