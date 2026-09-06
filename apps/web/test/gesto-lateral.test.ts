import { describe, expect, test } from 'bun:test'
import { sentidoDoArrasto } from '../lib/gesto-lateral.ts'

describe('sentidoDoArrasto', () => {
  test('arrastar da direita para a esquerda avança', () => {
    expect(sentidoDoArrasto({ dx: -120, dy: 4, ms: 220 })).toBe('frente')
  })

  test('arrastar da esquerda para a direita volta', () => {
    expect(sentidoDoArrasto({ dx: 120, dy: -6, ms: 220 })).toBe('tras')
  })

  test('toque parado não é arrasto', () => {
    expect(sentidoDoArrasto({ dx: 0, dy: 0, ms: 90 })).toBeNull()
  })

  test('deslize curto não conta — é o tremor do dedo ao tocar numa linha', () => {
    expect(sentidoDoArrasto({ dx: -18, dy: 3, ms: 120 })).toBeNull()
  })

  test('rolagem vertical não troca de aba, mesmo com desvio lateral', () => {
    expect(sentidoDoArrasto({ dx: -70, dy: 300, ms: 300 })).toBeNull()
  })

  test('diagonal ainda claramente horizontal conta', () => {
    expect(sentidoDoArrasto({ dx: -140, dy: 60, ms: 300 })).toBe('frente')
  })

  test('arrasto lento demais não conta — é seleção de texto, não gesto', () => {
    expect(sentidoDoArrasto({ dx: -200, dy: 0, ms: 4000 })).toBeNull()
  })

  test('o limite de distância é o mesmo nos dois sentidos', () => {
    expect(sentidoDoArrasto({ dx: -56, dy: 0, ms: 200 })).toBe('frente')
    expect(sentidoDoArrasto({ dx: 56, dy: 0, ms: 200 })).toBe('tras')
    expect(sentidoDoArrasto({ dx: -55, dy: 0, ms: 200 })).toBeNull()
    expect(sentidoDoArrasto({ dx: 55, dy: 0, ms: 200 })).toBeNull()
  })
})
