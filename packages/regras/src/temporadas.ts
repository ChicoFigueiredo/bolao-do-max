import type { RegrasTemporada } from '@bolao/dominio'

const R$ = (reais: number) => Math.round(reais * 100)

/**
 * Regras vigentes. Ficam em dado, não em código, porque é o que permite
 * recalcular cada temporada com as regras da época.
 */
export const REGRAS_CORRENTES: RegrasTemporada = {
  valorApostaCentavos: R$(155),
  classico: {
    premios: [
      { posicao: 1, centavos: R$(2000) },
      { posicao: 2, centavos: R$(650) },
      { posicao: 3, centavos: R$(350) },
    ],
    premioLanternaCentavos: R$(120),
  },
  posicao: {
    premioPrimeiroCentavos: R$(1000),
    pontosFaixa: 1,
    pontosPosicaoExata: 4,
  },
  megaSenaCentavos: R$(530),
  colapsarEmpates: true,
}

/**
 * Reproduz exatamente o que roda em produção hoje, divergências inclusive:
 * prêmios de 2º e 3º em R$ 600 / R$ 300 (contra os R$ 650 / R$ 350 do texto
 * das regras) e empates colapsados apenas na liderança do Bolão por Posição.
 *
 * Existe só para o teste de ouro. Não usar em cálculo novo.
 */
export const REGRAS_LEGADO: RegrasTemporada = {
  ...REGRAS_CORRENTES,
  classico: {
    premios: [
      { posicao: 1, centavos: R$(2000) },
      { posicao: 2, centavos: R$(600) },
      { posicao: 3, centavos: R$(300) },
    ],
    premioLanternaCentavos: R$(120),
  },
  colapsarEmpates: false,
}
