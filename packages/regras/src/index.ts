/**
 * Motor de regras do Bolão do Max.
 *
 * Função pura: sem I/O, sem banco, sem rede. Recebe classificação e apostas,
 * devolve os dois rankings. É o que permite testar exaustivamente, recalcular
 * temporadas passadas e — no futuro — simular resultados hipotéticos com
 * exatamente o mesmo código.
 */
import {
  ClubeNaoEncontrado,
  type Apostador,
  type LinhaClassico,
  type LinhaPosicao,
  type PalpiteAvaliado,
  type RegrasTemporada,
  type ResultadoBolao,
  type Tabela,
} from '@bolao/dominio'

export * from './tabela.ts'

const G4_MIN = 1
const G4_MAX = 4
const Z4_MIN = 17

function indexar(tabela: Tabela) {
  const m = new Map<string, Tabela[number]>()
  for (const l of tabela) m.set(l.clube, l)
  return m
}

/**
 * Atribui posições a um ranking já ordenado.
 *
 * `colapsarEmpates` liga o ranking de competição padrão (1, 2, 2, 4). Com
 * `false`, cada linha recebe seu índice — o comportamento legado do Clássico.
 */
function atribuirPosicoes<T>(
  ordenado: T[],
  mesmoNivel: (a: T, b: T) => boolean,
  colapsar: boolean,
): number[] {
  const pos: number[] = []
  for (let i = 0; i < ordenado.length; i++) {
    const atual = ordenado[i]!
    if (i === 0) {
      pos.push(1)
      continue
    }
    const anterior = ordenado[i - 1]!
    if (colapsar && mesmoNivel(anterior, atual)) pos.push(pos[i - 1]!)
    else pos.push(i + 1)
  }
  return pos
}

// ─────────────────────────────────────────────────────────────
// Bolão Clássico
// ─────────────────────────────────────────────────────────────

export function calcularClassico(
  tabela: Tabela,
  apostadores: Apostador[],
  regras: RegrasTemporada,
): LinhaClassico[] {
  const idx = indexar(tabela)

  const linhas = apostadores.map((a) => {
    const clubes = a.clubes.map((c) => {
      const t = idx.get(c.clube)
      if (!t) throw new ClubeNaoEncontrado(c.clube)
      return {
        ...c,
        posicaoTabela: t.posicao,
        pontos: t.pontos,
        jogos: t.jogos,
        vitorias: t.vitorias,
        empates: t.empates,
        derrotas: t.derrotas,
        golsPro: t.golsPro,
        golsContra: t.golsContra,
        saldoGols: t.saldoGols,
        aproveitamento: t.aproveitamento,
      }
    })
    const soma = (f: (c: (typeof clubes)[number]) => number) =>
      clubes.reduce((s, c) => s + f(c), 0)
    return {
      nome: a.nome,
      posicao: 0,
      pontos: soma((c) => c.pontos),
      saldoGols: soma((c) => c.saldoGols),
      golsPro: soma((c) => c.golsPro),
      golsContra: soma((c) => c.golsContra),
      premioCentavos: 0,
      clubes,
    } satisfies LinhaClassico
  })

  // Desempate em cascata: pontos, saldo, gols pró, gols contra, nome.
  linhas.sort(
    (a, b) =>
      b.pontos - a.pontos ||
      b.saldoGols - a.saldoGols ||
      b.golsPro - a.golsPro ||
      a.golsContra - b.golsContra ||
      a.nome.localeCompare(b.nome, 'pt-BR'),
  )

  const empatados = (x: LinhaClassico, y: LinhaClassico) =>
    x.pontos === y.pontos &&
    x.saldoGols === y.saldoGols &&
    x.golsPro === y.golsPro &&
    x.golsContra === y.golsContra

  const posicoes = atribuirPosicoes(linhas, empatados, regras.colapsarEmpates)
  linhas.forEach((l, i) => (l.posicao = posicoes[i]!))

  const ultima = posicoes[posicoes.length - 1]!
  const porPosicao = new Map(regras.classico.premios.map((p) => [p.posicao, p.centavos]))

  // Prêmios são divididos entre os empatados na mesma posição premiada.
  //
  // Precedência: se a última posição coincidir com uma posição de pódio — só
  // acontece num bolão minúsculo, mas o código precisa decidir — vale o
  // prêmio do pódio, que é o maior e o mais específico.
  const quantos = (p: number) => posicoes.filter((x) => x === p).length
  for (const l of linhas) {
    const base = porPosicao.get(l.posicao)
    if (base !== undefined) l.premioCentavos = Math.round(base / quantos(l.posicao))
    else if (l.posicao === ultima && regras.classico.premioLanternaCentavos > 0)
      l.premioCentavos = Math.round(regras.classico.premioLanternaCentavos / quantos(l.posicao))
  }

  return linhas
}

// ─────────────────────────────────────────────────────────────
// Bolão por Posição
// ─────────────────────────────────────────────────────────────

export function calcularPosicao(
  tabela: Tabela,
  apostadores: Apostador[],
  regras: RegrasTemporada,
): LinhaPosicao[] {
  const idx = indexar(tabela)
  const { pontosFaixa, pontosPosicaoExata } = regras.posicao

  const linhas = apostadores.map((a) => {
    const palpites: PalpiteAvaliado[] = a.palpites.map((p) => {
      const t = idx.get(p.clube)
      const real = t?.posicao ?? null
      let acertoG4 = false
      let acertoZ4 = false
      let acertoPosicao = false
      let pontos = 0

      if (real !== null) {
        if (p.posicao >= G4_MIN && p.posicao <= G4_MAX && real <= G4_MAX) {
          acertoG4 = true
          pontos = pontosFaixa
        }
        if (p.posicao >= Z4_MIN && real >= Z4_MIN) {
          acertoZ4 = true
          pontos = pontosFaixa
        }
        if ((acertoG4 || acertoZ4) && p.posicao === real) {
          acertoPosicao = true
          pontos = pontosPosicaoExata
        }
      }
      return { ...p, posicaoAtual: real, acertoG4, acertoZ4, acertoPosicao, pontos }
    })

    const conta = (f: (p: PalpiteAvaliado) => boolean) => palpites.filter(f).length
    return {
      nome: a.nome,
      posicao: 0,
      pontos: palpites.reduce((s, p) => s + p.pontos, 0),
      acertosFaixa: conta((p) => p.acertoG4) + conta((p) => p.acertoZ4),
      acertosG4: conta((p) => p.acertoG4),
      acertosZ4: conta((p) => p.acertoZ4),
      premioCentavos: 0,
      palpites,
    } satisfies LinhaPosicao
  })

  linhas.sort(
    (a, b) =>
      b.pontos - a.pontos ||
      b.acertosFaixa - a.acertosFaixa ||
      b.acertosG4 - a.acertosG4 ||
      b.acertosZ4 - a.acertosZ4,
  )

  const empatados = (x: LinhaPosicao, y: LinhaPosicao) =>
    x.pontos === y.pontos &&
    x.acertosFaixa === y.acertosFaixa &&
    x.acertosG4 === y.acertosG4 &&
    x.acertosZ4 === y.acertosZ4

  // No modo legado o empate na liderança já era colapsado — só ele.
  const posicoes = regras.colapsarEmpates
    ? atribuirPosicoes(linhas, empatados, true)
    : atribuirPosicoesLegado(linhas)
  linhas.forEach((l, i) => (l.posicao = posicoes[i]!))

  const lideres = posicoes.filter((p) => p === 1).length
  for (const l of linhas)
    if (l.posicao === 1)
      l.premioCentavos = Math.round(regras.posicao.premioPrimeiroCentavos / lideres)

  return linhas
}

/**
 * Reproduz o laço de `regras.bolao.js`: empates só colapsam enquanto a
 * pontuação for igual à do líder; quebrada a sequência, nunca mais colapsa.
 */
function atribuirPosicoesLegado(ordenado: LinhaPosicao[]): number[] {
  const pos: number[] = []
  let pontosAnterior = 0
  for (let i = 0; i < ordenado.length; i++) {
    const b = ordenado[i]!
    if (i === 0) {
      pos.push(1)
      pontosAnterior = b.pontos
    } else if (b.pontos === pontosAnterior) {
      pos.push(1)
    } else {
      pos.push(i + 1)
      pontosAnterior = -1
    }
  }
  return pos
}

// ─────────────────────────────────────────────────────────────

export function calcularBolao(
  tabela: Tabela,
  apostadores: Apostador[],
  regras: RegrasTemporada,
): ResultadoBolao {
  return {
    classico: calcularClassico(tabela, apostadores, regras),
    posicao: regras.posicao.premioPrimeiroCentavos >= 0 ? calcularPosicao(tabela, apostadores, regras) : [],
  }
}
