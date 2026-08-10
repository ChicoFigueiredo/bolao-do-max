/**
 * As duas correções decididas, cada uma com seu teste.
 *
 * Rodam sobre a mesma fixture do teste de ouro, trocando apenas o conjunto de
 * regras. Assim fica demonstrado que a diferença vem da regra e não de uma
 * mudança acidental no motor.
 */
import { describe, expect, test } from 'bun:test'
import type { Apostador, Tabela } from '@bolao/dominio'
import { calcularClassico, calcularPosicao } from '../src/index.ts'
import { REGRAS_CORRENTES, REGRAS_LEGADO } from '../src/temporadas.ts'
import producao from './fixtures/producao-2026-08-09.json'

function montarTabela(): Tabela {
  const stats = new Map<string, (typeof producao)['Competidores'][number]['Clubes'][number]>()
  const posicoes = new Map<string, number>()
  for (const c of producao.Competidores) {
    for (const t of c.Clubes) if (!stats.has(t.Clube)) stats.set(t.Clube, t)
    for (const p of c.PalpitesPosicao)
      if (p.posicaoAtualTime != null) posicoes.set(p.Clube, p.posicaoAtualTime)
  }
  return [...new Set([...stats.keys(), ...posicoes.keys()])].map((clube) => {
    const s = stats.get(clube)
    return {
      clube,
      posicao: posicoes.get(clube) ?? 0,
      pontos: Number(s?.pontos ?? 0),
      jogos: Number(s?.jogos ?? 0),
      vitorias: Number(s?.vitorias ?? 0),
      empates: Number(s?.empates ?? 0),
      derrotas: Number(s?.derrotas ?? 0),
      golsPro: Number(s?.golsPro ?? 0),
      golsContra: Number(s?.golsContra ?? 0),
      saldoGols: Number(s?.saldoGols ?? 0),
    }
  })
}

const tabela = montarTabela()
const apostadores: Apostador[] = producao.Competidores.map((c) => ({
  nome: c.Nome,
  clubes: c.Clubes.map((t) => ({
    grupo: t.Grupo as Apostador['clubes'][number]['grupo'],
    clube: t.Clube,
    coracao: t.Coracao,
  })),
  palpites: c.PalpitesPosicao.map((p) => ({ clube: p.Clube, posicao: p.posicao })),
}))

describe('correção 1 — prêmios de 2º e 3º', () => {
  const legado = calcularClassico(tabela, apostadores, REGRAS_LEGADO)
  const corrente = calcularClassico(tabela, apostadores, REGRAS_CORRENTES)

  test('2º sobe de R$ 600 para R$ 650 e 3º de R$ 300 para R$ 350', () => {
    expect(legado.filter((l) => l.premioCentavos > 0).map((l) => l.premioCentavos)).toEqual([
      200000, 60000, 30000, 12000,
    ])
    expect(corrente.filter((l) => l.premioCentavos > 0).map((l) => l.premioCentavos)).toEqual([
      200000, 65000, 35000, 12000,
    ])
  })

  test('a premiação corrigida fecha a conta dos R$ 530 da Mega Sena', () => {
    const { valorApostaCentavos, classico, posicao, megaSenaCentavos } = REGRAS_CORRENTES
    const arrecadado = valorApostaCentavos * apostadores.length
    const distribuido =
      classico.premios.reduce((s, p) => s + p.centavos, 0) +
      classico.premioLanternaCentavos +
      posicao.premioPrimeiroCentavos
    expect(arrecadado).toBe(465000)
    expect(arrecadado - distribuido).toBe(megaSenaCentavos)
  })

  test('a premiação legada NÃO fecha — é a evidência de que o código estava defasado', () => {
    const { valorApostaCentavos, classico, posicao } = REGRAS_LEGADO
    const sobra =
      valorApostaCentavos * apostadores.length -
      (classico.premios.reduce((s, p) => s + p.centavos, 0) +
        classico.premioLanternaCentavos +
        posicao.premioPrimeiroCentavos)
    expect(sobra).toBe(63000)
    expect(sobra).not.toBe(REGRAS_CORRENTES.megaSenaCentavos)
  })

  test('ordem e pontuação não mudam — só o valor do prêmio', () => {
    expect(corrente.map((l) => [l.nome, l.posicao, l.pontos])).toEqual(
      legado.map((l) => [l.nome, l.posicao, l.pontos]),
    )
  })
})

describe('correção 2 — empates colapsados em qualquer posição', () => {
  const legado = calcularPosicao(tabela, apostadores, REGRAS_LEGADO)
  const corrente = calcularPosicao(tabela, apostadores, REGRAS_CORRENTES)

  test('os dois com 16 pontos passam de 2º/3º para 2º/2º', () => {
    expect(legado.filter((l) => l.pontos === 16).map((l) => l.posicao)).toEqual([2, 3])
    expect(corrente.filter((l) => l.pontos === 16).map((l) => l.posicao)).toEqual([2, 2])
  })

  test('os dois com 14 pontos passam de 4º/5º para 4º/4º', () => {
    expect(legado.filter((l) => l.pontos === 14).map((l) => l.posicao)).toEqual([4, 5])
    expect(corrente.filter((l) => l.pontos === 14).map((l) => l.posicao)).toEqual([4, 4])
  })

  test('a posição seguinte pula, como manda o ranking de competição', () => {
    const pos = corrente.map((l) => l.posicao)
    expect(pos.slice(0, 6)).toEqual([1, 2, 2, 4, 4, 6])
  })

  test('a ordem dos competidores não muda — só o número da posição', () => {
    expect(corrente.map((l) => l.nome)).toEqual(legado.map((l) => l.nome))
  })

  test('líder isolado continua levando o prêmio inteiro', () => {
    expect(corrente[0]!.premioCentavos).toBe(100000)
    expect(corrente.filter((l) => l.premioCentavos > 0)).toHaveLength(1)
  })
})

describe('divisão de prêmio entre empatados', () => {
  test('empate na liderança divide o prêmio do Bolão por Posição', () => {
    const dois = apostadores.slice(0, 2).map((a) => ({ ...a, palpites: apostadores[0]!.palpites }))
    const r = calcularPosicao(tabela, dois, REGRAS_CORRENTES)
    expect(r.map((l) => l.posicao)).toEqual([1, 1])
    expect(r.map((l) => l.premioCentavos)).toEqual([50000, 50000])
  })

  test('empate na lanterna do Clássico divide os R$ 120', () => {
    // Os 30 reais mais um clone do lanterna: dois empatam na última posição.
    const lanterna = apostadores.at(-1)!
    const clone: Apostador = { ...lanterna, nome: `${lanterna.nome} (clone)` }
    const r = calcularClassico(tabela, [...apostadores, clone], REGRAS_CORRENTES)

    const ultima = Math.max(...r.map((l) => l.posicao))
    const ultimos = r.filter((l) => l.posicao === ultima)
    expect(ultima).toBe(30)
    expect(ultimos.map((l) => l.nome).sort()).toEqual(['Marlon', 'Marlon (clone)'])
    expect(ultimos.map((l) => l.premioCentavos)).toEqual([6000, 6000])
  })

  test('pódio tem precedência sobre lanterna quando as posições colidem', () => {
    // Bolão degenerado de 3 pessoas: a 2ª posição é pódio e lanterna ao
    // mesmo tempo. Vale o prêmio de vice, que é o maior e o mais específico.
    const tres = [apostadores[0]!, apostadores[1]!, apostadores.at(-1)!]
    const r = calcularClassico(tabela, tres, REGRAS_CORRENTES)
    expect(r.map((l) => l.premioCentavos)).toEqual([200000, 65000, 35000])
  })
})
