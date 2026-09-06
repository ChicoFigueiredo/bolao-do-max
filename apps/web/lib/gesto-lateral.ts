import type { Sentido } from './navegacao-abas'

/** Um arrasto medido: quanto andou em cada eixo, e em quanto tempo. */
export type Arrasto = { dx: number; dy: number; ms: number }

/**
 * Quanto o dedo precisa andar para virar gesto.
 *
 * Abaixo disso é o tremor de quem toca numa linha da tabela para abrir o
 * detalhe — trocar de aba ali seria roubar o toque.
 */
const DISTANCIA_MINIMA = 56

/**
 * O quanto o arrasto precisa ser mais horizontal do que vertical.
 *
 * A página inteira rola na vertical, e ninguém rola em linha reta. Sem essa
 * margem, descer a lista de trinta competidores trocaria de aba no caminho.
 */
const RAZAO_HORIZONTAL = 1.5

/**
 * Depois disso não é mais gesto, é arrastar.
 *
 * Quem segura o dedo e move devagar está marcando texto ou hesitando; o gesto
 * de trocar de aba é rápido por natureza. É o número mais arbitrário daqui —
 * se um puxão lento e deliberado estiver sendo ignorado, é este que sobe.
 */
const DURACAO_MAXIMA = 1000

/**
 * O sentido do arrasto, ou `null` se não foi um gesto lateral.
 *
 * O eixo x cresce para a direita, então `dx` negativo é o dedo indo da direita
 * para a esquerda — que é avançar na fila de abas.
 */
export function sentidoDoArrasto({ dx, dy, ms }: Arrasto): Sentido | null {
  if (ms > DURACAO_MAXIMA) return null
  if (Math.abs(dx) < DISTANCIA_MINIMA) return null
  if (Math.abs(dx) < Math.abs(dy) * RAZAO_HORIZONTAL) return null
  return dx < 0 ? 'frente' : 'tras'
}
