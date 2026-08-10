/** Tipos compartilhados. Sem I/O, sem dependências. */

export type Grupo = 'GP1' | 'GP2' | 'GP3' | 'GP4'

/** Uma linha da classificação do campeonato. */
export type LinhaTabela = {
  clube: string
  posicao: number
  pontos: number
  jogos: number
  vitorias: number
  empates: number
  derrotas: number
  golsPro: number
  golsContra: number
  saldoGols: number
  aproveitamento?: number
}

export type Tabela = LinhaTabela[]

/** Aposta do Bolão Clássico: quatro clubes, um por grupo. */
export type ApostaClassico = {
  grupo: Grupo
  clube: string
  coracao?: boolean
}

/** Palpite do Bolão por Posição: clube numa posição de 1–4 ou 17–20. */
export type PalpitePosicao = {
  clube: string
  posicao: number
}

export type Apostador = {
  nome: string
  clubes: ApostaClassico[]
  palpites: PalpitePosicao[]
}

export type PremioRegra = { posicao: number; centavos: number }

export type RegrasTemporada = {
  valorApostaCentavos: number
  classico: {
    premios: PremioRegra[]
    premioLanternaCentavos: number
  }
  posicao: {
    premioPrimeiroCentavos: number
    pontosFaixa: number
    pontosPosicaoExata: number
  }
  megaSenaCentavos: number
  /**
   * `false` reproduz o comportamento legado: só empates na liderança do
   * Bolão por Posição são colapsados, e o Clássico nunca colapsa.
   * `true` é a regra corrente — pontos iguais, posição igual, nos dois bolões.
   */
  colapsarEmpates: boolean
}

// ── Resultado do Bolão Clássico ──────────────────────────────

export type ClubeDoConjunto = ApostaClassico & {
  pontos: number
  jogos: number
  vitorias: number
  empates: number
  derrotas: number
  golsPro: number
  golsContra: number
  saldoGols: number
  aproveitamento?: number
}

export type LinhaClassico = {
  nome: string
  posicao: number
  pontos: number
  saldoGols: number
  golsPro: number
  golsContra: number
  premioCentavos: number
  clubes: ClubeDoConjunto[]
}

// ── Resultado do Bolão por Posição ───────────────────────────

export type PalpiteAvaliado = PalpitePosicao & {
  posicaoAtual: number | null
  acertoG4: boolean
  acertoZ4: boolean
  acertoPosicao: boolean
  pontos: number
}

export type LinhaPosicao = {
  nome: string
  posicao: number
  pontos: number
  acertosFaixa: number
  acertosG4: number
  acertosZ4: number
  premioCentavos: number
  palpites: PalpiteAvaliado[]
}

export type ResultadoBolao = {
  classico: LinhaClassico[]
  posicao: LinhaPosicao[]
}

export class ClubeNaoEncontrado extends Error {
  constructor(public readonly clube: string) {
    super(`clube não encontrado na classificação: "${clube}"`)
    this.name = 'ClubeNaoEncontrado'
  }
}
