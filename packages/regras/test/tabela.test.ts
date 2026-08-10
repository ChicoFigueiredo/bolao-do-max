import { describe, expect, test } from 'bun:test'
import { calcularTabela, type PartidaEncerrada } from '../src/tabela.ts'

const jogo = (
  mandante: string,
  golsMandante: number,
  golsVisitante: number,
  visitante: string,
): PartidaEncerrada => ({ mandante, visitante, golsMandante, golsVisitante })

describe('calcularTabela', () => {
  test('vitória vale 3, empate 1, derrota 0', () => {
    const t = calcularTabela([jogo('A', 2, 1, 'B'), jogo('B', 0, 0, 'C')])
    const por = new Map(t.map((l) => [l.clube, l]))
    expect(por.get('A')!.pontos).toBe(3)
    expect(por.get('B')!.pontos).toBe(1)
    expect(por.get('C')!.pontos).toBe(1)
    expect(por.get('A')!.vitorias).toBe(1)
    expect(por.get('B')!.derrotas).toBe(1)
  })

  test('gols pró e contra somam dos dois lados', () => {
    const t = calcularTabela([jogo('A', 3, 1, 'B')])
    const por = new Map(t.map((l) => [l.clube, l]))
    expect([por.get('A')!.golsPro, por.get('A')!.golsContra, por.get('A')!.saldoGols]).toEqual([3, 1, 2])
    expect([por.get('B')!.golsPro, por.get('B')!.golsContra, por.get('B')!.saldoGols]).toEqual([1, 3, -2])
  })

  test('desempata por vitórias antes de saldo, como manda o regulamento', () => {
    // A: 1 vitória + 1 derrota = 3 pts, saldo 0
    // B: 3 empates = 3 pts, saldo 0 — mesma pontuação e mesmo saldo
    const t = calcularTabela([
      jogo('A', 5, 0, 'X'),
      jogo('Y', 5, 0, 'A'),
      jogo('B', 0, 0, 'X'),
      jogo('B', 0, 0, 'Y'),
      jogo('B', 0, 0, 'Z'),
    ])
    const a = t.find((l) => l.clube === 'A')!
    const b = t.find((l) => l.clube === 'B')!
    expect([a.pontos, b.pontos]).toEqual([3, 3])
    expect([a.saldoGols, b.saldoGols]).toEqual([0, 0])
    expect(a.vitorias).toBeGreaterThan(b.vitorias)
    expect(a.posicao).toBeLessThan(b.posicao)
  })

  test('clube sem jogos aparece zerado quando o elenco é informado', () => {
    const t = calcularTabela([jogo('A', 1, 0, 'B')], ['A', 'B', 'Sem Jogo'])
    const sem = t.find((l) => l.clube === 'Sem Jogo')!
    expect([sem.jogos, sem.pontos, sem.aproveitamento]).toEqual([0, 0, 0])

    // Fica à frente de quem perdeu: mesmos 0 pontos, mas saldo 0 contra −1.
    // É a regra normal de tabela, não um caso especial.
    expect(t.map((l) => l.clube)).toEqual(['A', 'Sem Jogo', 'B'])
    expect(sem.posicao).toBe(2)
  })

  test('aproveitamento é percentual dos pontos possíveis', () => {
    const t = calcularTabela([jogo('A', 1, 0, 'B'), jogo('A', 0, 0, 'C')])
    expect(t.find((l) => l.clube === 'A')!.aproveitamento).toBe(67)
  })

  test('posições são contíguas de 1 a N', () => {
    const t = calcularTabela([jogo('A', 1, 0, 'B'), jogo('C', 2, 2, 'D')])
    expect(t.map((l) => l.posicao)).toEqual([1, 2, 3, 4])
  })

  test('sem partidas, todo mundo zerado', () => {
    const t = calcularTabela([], ['A', 'B'])
    expect(t.every((l) => l.pontos === 0 && l.jogos === 0)).toBe(true)
    expect(t).toHaveLength(2)
  })

  test('é a base do simulador: trocar um placar reordena a tabela', () => {
    const base = [jogo('A', 1, 0, 'B'), jogo('C', 1, 0, 'D')]
    const antes = calcularTabela(base)
    expect(antes[0]!.clube).toBe('A')

    const hipotetico = [jogo('A', 1, 0, 'B'), jogo('C', 5, 0, 'D')]
    const depois = calcularTabela(hipotetico)
    expect(depois[0]!.clube).toBe('C')
    expect(depois[0]!.saldoGols).toBe(5)
  })
})
