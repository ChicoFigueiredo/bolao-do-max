import { describe, expect, test } from 'bun:test'
import { criarUmDeCadaVez } from '../lib/um-de-cada-vez.ts'

/** Relógio manual: o TTL precisa ser testável sem esperar de verdade. */
function relogio(inicio = 0) {
  let t = inicio
  return { agora: () => t, avancar: (ms: number) => (t += ms) }
}

/** Função contadora que só resolve quando mandarem — para segurar as chamadas em voo. */
function represa<T>(valor: T) {
  let liberar!: () => void
  const portao = new Promise<void>((r) => (liberar = r))
  let chamadas = 0
  return {
    calcular: async () => {
      chamadas++
      await portao
      return valor
    },
    liberar,
    get chamadas() {
      return chamadas
    },
  }
}

describe('umDeCadaVez', () => {
  test('chamadas concorrentes compartilham uma execução', async () => {
    const um = criarUmDeCadaVez()
    const r = represa('tabela')

    const espera = [um('resultado', 1000, r.calcular), um('resultado', 1000, r.calcular), um('resultado', 1000, r.calcular)]
    expect(r.chamadas).toBe(1)

    r.liberar()
    expect(await Promise.all(espera)).toEqual(['tabela', 'tabela', 'tabela'])
    expect(r.chamadas).toBe(1)
  })

  test('dentro do TTL não recalcula', async () => {
    const c = relogio()
    const um = criarUmDeCadaVez({ agora: c.agora })
    let chamadas = 0
    const calcular = async () => ++chamadas

    expect(await um('resultado', 15_000, calcular)).toBe(1)
    c.avancar(14_999)
    expect(await um('resultado', 15_000, calcular)).toBe(1)
    expect(chamadas).toBe(1)
  })

  test('depois do TTL recalcula', async () => {
    const c = relogio()
    const um = criarUmDeCadaVez({ agora: c.agora })
    let chamadas = 0
    const calcular = async () => ++chamadas

    expect(await um('resultado', 15_000, calcular)).toBe(1)
    c.avancar(15_001)
    expect(await um('resultado', 15_000, calcular)).toBe(2)
  })

  test('rejeição não entra no cache — a chamada seguinte tenta de novo', async () => {
    const um = criarUmDeCadaVez()
    let chamadas = 0
    const calcular = async () => {
      chamadas++
      if (chamadas === 1) throw new Error('Postgres fora do ar')
      return 'ok'
    }

    await expect(um('resultado', 60_000, calcular)).rejects.toThrow('Postgres fora do ar')
    expect(await um('resultado', 60_000, calcular)).toBe('ok')
    expect(chamadas).toBe(2)
  })

  test('rejeição alcança todos os que esperavam a mesma execução', async () => {
    const um = criarUmDeCadaVez()
    let liberar!: (e: Error) => void
    const calcular = () => new Promise<string>((_, rej) => (liberar = rej))

    const a = um('resultado', 60_000, calcular)
    const b = um('resultado', 60_000, calcular)
    liberar(new Error('caiu'))

    await expect(a).rejects.toThrow('caiu')
    await expect(b).rejects.toThrow('caiu')
  })

  test('chaves distintas não interferem', async () => {
    const um = criarUmDeCadaVez()
    let resultado = 0
    let historico = 0

    expect(await um('resultado', 60_000, async () => ++resultado)).toBe(1)
    expect(await um('historico', 60_000, async () => ++historico)).toBe(1)
    expect(await um('resultado', 60_000, async () => ++resultado)).toBe(1)
    expect(resultado).toBe(1)
    expect(historico).toBe(1)
  })

  test('o teto de entradas descarta a mais antiga', async () => {
    const c = relogio()
    const um = criarUmDeCadaVez({ agora: c.agora, teto: 2 })

    await um('a', 60_000, async () => 'a')
    await um('b', 60_000, async () => 'b')
    await um('c', 60_000, async () => 'c')

    // 'a' saiu para 'c' entrar: recalcula.
    let recalculou = false
    await um('a', 60_000, async () => {
      recalculou = true
      return 'a'
    })
    expect(recalculou).toBe(true)
  })
})
