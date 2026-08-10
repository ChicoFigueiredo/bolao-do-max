import { describe, expect, test } from 'bun:test'
import type { Tabela } from '@bolao/dominio'
import { hashTabela } from '../src/casos/snapshot.ts'

const linha = (clube: string, pontos: number, extra: Partial<Tabela[number]> = {}): Tabela[number] => ({
  clube,
  posicao: 1,
  pontos,
  jogos: 10,
  vitorias: 3,
  empates: 1,
  derrotas: 6,
  golsPro: 12,
  golsContra: 15,
  saldoGols: -3,
  ...extra,
})

describe('hashTabela', () => {
  test('mesma tabela, mesmo hash', () => {
    const t = [linha('A', 30), linha('B', 20)]
    expect(hashTabela(t)).toBe(hashTabela([...t]))
  })

  test('ordem não importa — é o conjunto de fatos que conta', () => {
    const a = [linha('A', 30), linha('B', 20)]
    const b = [linha('B', 20), linha('A', 30)]
    expect(hashTabela(a)).toBe(hashTabela(b))
  })

  test('posição não entra no hash: reordenar por desempate não é mudança', () => {
    const a = [linha('A', 30, { posicao: 1 }), linha('B', 30, { posicao: 2 })]
    const b = [linha('A', 30, { posicao: 2 }), linha('B', 30, { posicao: 1 })]
    expect(hashTabela(a)).toBe(hashTabela(b))
  })

  test('um ponto a mais muda o hash', () => {
    expect(hashTabela([linha('A', 30)])).not.toBe(hashTabela([linha('A', 31)]))
  })

  test('um gol a mais muda o hash', () => {
    expect(hashTabela([linha('A', 30)])).not.toBe(hashTabela([linha('A', 30, { golsPro: 13 })]))
  })

  test('um jogo a mais muda o hash', () => {
    expect(hashTabela([linha('A', 30)])).not.toBe(hashTabela([linha('A', 30, { jogos: 11 })]))
  })

  test('clube diferente muda o hash', () => {
    expect(hashTabela([linha('A', 30)])).not.toBe(hashTabela([linha('Z', 30)]))
  })

  test('tabela vazia é estável', () => {
    expect(hashTabela([])).toBe(hashTabela([]))
  })
})
