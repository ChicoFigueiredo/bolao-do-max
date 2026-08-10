/**
 * Pré-renderização no Redis.
 *
 * Sem isto, tocar um nome na tela dispara uma requisição que lê o payload
 * inteiro, procura o competidor e recalcula a trajetória no Postgres. Com isto,
 * é uma leitura de chave: o worker já montou tudo no fim do ciclo.
 *
 * São 60 chaves de detalhe (30 competidores × 2 bolões) e 6 de evolução
 * (2 bolões × 3 janelas). Escrever isso custa milissegundos uma vez por ciclo;
 * recalcular custaria a cada toque de cada pessoa.
 */
import type { LinhaClassico, LinhaPosicao } from '@bolao/dominio'
import type { Banco } from '@bolao/db'
import type { Cache } from '../cache.ts'
import { calcularHistorico, type Bolao, type Janela } from './series.ts'

export type DetalhePronto = {
  nome: string
  classico?: LinhaClassico
  posicao?: LinhaPosicao
  trajetoria: { pontos: number[]; inicio: string; fim: string; total: number } | null
}

const JANELAS: Janela[] = ['hora', 'dia', 'semana']
const BOLOES: Bolao[] = ['classico', 'posicao']

/** Qual janela alimenta o gráfico dentro do detalhamento. */
const JANELA_DO_DETALHE: Janela = 'dia'

export async function prerenderizar(
  db: Banco,
  cache: Cache,
  temporada: number,
  classico: LinhaClassico[],
  posicao: LinhaPosicao[],
): Promise<{ detalhes: number; series: number }> {
  const historico = await calcularHistorico(db)

  let series = 0
  for (const b of BOLOES)
    for (const j of JANELAS) {
      await cache.publicarEvolucao(temporada, b, j, historico[j][b])
      series++
    }

  const trajetoria = (tipo: Bolao, nome: string) => {
    const s = historico[JANELA_DO_DETALHE][tipo]
    const pontos = s.posicao[nome]
    if (!pontos || pontos.length < 2) return null
    return {
      pontos,
      inicio: s.rotulos[0]!,
      fim: s.rotulos.at(-1)!,
      total: s.rotulos.length,
    }
  }

  const porNomeC = new Map(classico.map((l) => [l.nome, l]))
  const porNomeP = new Map(posicao.map((l) => [l.nome, l]))
  const nomes = new Set([...porNomeC.keys(), ...porNomeP.keys()])

  let detalhes = 0
  for (const nome of nomes) {
    for (const tipo of BOLOES) {
      const payload: DetalhePronto = {
        nome,
        classico: porNomeC.get(nome),
        posicao: porNomeP.get(nome),
        trajetoria: trajetoria(tipo, nome),
      }
      await cache.publicarDetalhe(temporada, tipo, nome, payload)
      detalhes++
    }
  }

  return { detalhes, series }
}
