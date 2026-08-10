/**
 * Teste de ouro.
 *
 * O motor novo tem que reproduzir, campo a campo, a saída real de produção
 * capturada em 09/08/2026 às 18:45 — **incluindo as divergências conhecidas**
 * (prêmios de 2º e 3º em R$ 600/R$ 300 e empates não colapsados fora da
 * liderança). Só depois de bater exatamente é que as correções entram.
 *
 * É isto que separa "reescrevi" de "mudei o resultado".
 */
import { describe, expect, test } from 'bun:test'
import type { Apostador, Tabela } from '@bolao/dominio'
import { calcularClassico, calcularPosicao } from '../src/index.ts'
import { REGRAS_LEGADO } from '../src/temporadas.ts'
import producao from './fixtures/producao-2026-08-09.json'

type CompetidorProd = (typeof producao)['Competidores'][number]

/**
 * Reconstrói a classificação a partir da própria captura, para o teste ser
 * auto-contido e determinístico.
 *
 * As estatísticas saem de `Clubes[]` e as posições de `PalpitesPosicao[]`.
 * O Botafogo aparece só com posição: nenhum apostador o escolheu no Clássico,
 * então suas estatísticas nunca são lidas — o que o próprio teste afirma.
 */
function montarTabela(): Tabela {
  const stats = new Map<string, CompetidorProd['Clubes'][number]>()
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
      aproveitamento: s ? Number(s.percentual) : undefined,
    }
  })
}

function montarApostadores(): Apostador[] {
  return producao.Competidores.map((c) => ({
    nome: c.Nome,
    clubes: c.Clubes.map((t) => ({
      grupo: t.Grupo as Apostador['clubes'][number]['grupo'],
      clube: t.Clube,
      coracao: t.Coracao,
    })),
    palpites: c.PalpitesPosicao.map((p) => ({ clube: p.Clube, posicao: p.posicao })),
  }))
}

const centavos = (brl: string) =>
  brl === '-' ? 0 : Math.round(Number(brl.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')) * 100)

const tabela = montarTabela()
const apostadores = montarApostadores()

describe('fixture de produção', () => {
  test('tem 30 competidores e 20 clubes', () => {
    expect(producao.Competidores).toHaveLength(30)
    expect(producao.BolaoNovo).toHaveLength(30)
    expect(tabela).toHaveLength(20)
  })

  test('nenhuma aposta do Clássico usa clube sem estatística', () => {
    const semStats = new Set(tabela.filter((l) => l.jogos === 0).map((l) => l.clube))
    expect([...semStats]).toEqual(['Botafogo'])
    const usados = new Set(apostadores.flatMap((a) => a.clubes.map((c) => c.clube)))
    for (const c of semStats) expect(usados.has(c)).toBe(false)
  })
})

describe('Bolão Clássico — reproduz a produção', () => {
  const calculado = calcularClassico(tabela, apostadores, REGRAS_LEGADO)

  test('mesma ordem de competidores', () => {
    expect(calculado.map((l) => l.nome)).toEqual(producao.Competidores.map((c) => c.Nome))
  })

  test('pontos, saldo, gols pró e posição batem em todos', () => {
    calculado.forEach((l, i) => {
      const p = producao.Competidores[i]!
      expect({ nome: l.nome, pontos: l.pontos, saldo: l.saldoGols, gp: l.golsPro, pos: l.posicao }).toEqual({
        nome: p.Nome,
        pontos: p.Pontos,
        saldo: p.Saldo_Gols,
        gp: p.golsPro,
        pos: p.Posicao,
      })
    })
  })

  test('prêmios batem — inclusive os valores hoje divergentes do texto', () => {
    calculado.forEach((l, i) => {
      expect([l.nome, l.premioCentavos]).toEqual([
        producao.Competidores[i]!.Nome,
        centavos(producao.Competidores[i]!.Premio),
      ])
    })
    const premiados = calculado.filter((l) => l.premioCentavos > 0)
    expect(premiados.map((l) => l.premioCentavos)).toEqual([200000, 60000, 30000, 12000])
  })

  test('estatísticas de cada clube do conjunto batem', () => {
    calculado.forEach((l, i) => {
      const p = producao.Competidores[i]!
      l.clubes.forEach((c, j) => {
        const pc = p.Clubes[j]!
        expect([c.clube, c.pontos, c.saldoGols, c.jogos]).toEqual([
          pc.Clube,
          pc.pontos,
          pc.saldoGols,
          pc.jogos,
        ])
      })
    })
  })
})

describe('Bolão por Posição — reproduz a produção', () => {
  const calculado = calcularPosicao(tabela, apostadores, REGRAS_LEGADO)

  test('mesma ordem de competidores', () => {
    expect(calculado.map((l) => l.nome)).toEqual(producao.BolaoNovo.map((c) => c.Nome))
  })

  test('pontos, acertos e posição batem em todos', () => {
    calculado.forEach((l, i) => {
      const p = producao.BolaoNovo[i]!
      expect({
        nome: l.nome,
        pts: l.pontos,
        faixa: l.acertosFaixa,
        g4: l.acertosG4,
        z4: l.acertosZ4,
        pos: l.posicao,
      }).toEqual({
        nome: p.Nome,
        pts: p.PontosG4Z4,
        faixa: p.AcertosG4Z4,
        g4: p.AcertosG4,
        z4: p.AcertosZ4,
        pos: p.PosicaoG4Z4,
      })
    })
  })

  test('avaliação de cada palpite bate', () => {
    calculado.forEach((l, i) => {
      const p = producao.BolaoNovo[i]!
      l.palpites.forEach((pl, j) => {
        const pp = p.PalpitesPosicao[j]!
        expect([pl.clube, pl.posicao, pl.acertoG4, pl.acertoZ4, pl.acertoPosicao, pl.pontos]).toEqual([
          pp.Clube,
          pp.posicao,
          pp.acertoG4,
          pp.acertoZ4,
          pp.acertoPosicao,
          pp.pontos,
        ])
      })
    })
  })

  test('prêmio do líder bate', () => {
    calculado.forEach((l, i) => {
      expect([l.nome, l.premioCentavos]).toEqual([
        producao.BolaoNovo[i]!.Nome,
        centavos(producao.BolaoNovo[i]!.PremioG4Z4),
      ])
    })
  })

  test('empates fora da liderança NÃO são colapsados — o defeito legado', () => {
    const dezesseis = calculado.filter((l) => l.pontos === 16)
    expect(dezesseis.map((l) => l.posicao)).toEqual([2, 3])
  })
})
