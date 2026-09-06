/**
 * A ordem em que o gesto lateral percorre a tela.
 *
 * As três abas do topo não são três paradas, são quatro: a Evolução tem duas
 * subabas, e o dedo não distingue "aba" de "subaba" — para quem arrasta, é tudo
 * a mesma fila. Por isso a Evolução ocupa dois lugares na sequência, e sair
 * dela para trás custa dois puxões: um para trocar a subaba, outro para trocar
 * de aba.
 *
 * A barra de abas mora aqui junto com a fila de propósito. Eram duas listas em
 * dois arquivos declarando a mesma ordem, e reordenar uma sem a outra dava uma
 * navegação que contradiz a barra sem quebrar nada — lado a lado, e com o teste
 * que compara as duas, a divergência aparece.
 */

export type Aba = 'classico' | 'posicao' | 'evolucao'

/** A subaba da Evolução, que escolhe qual bolão o gráfico desenha. */
export type BolaoEvolucao = 'classico' | 'posicao'

/** Onde a pessoa está: a aba aberta e a subaba que a Evolução guarda. */
export type Vista = { aba: Aba; bolao: BolaoEvolucao }

/** `frente` é o arrasto da direita para a esquerda; `tras`, o contrário. */
export type Sentido = 'frente' | 'tras'

export const ABAS: { id: Aba; titulo: string; sub: string }[] = [
  { id: 'classico', titulo: 'Clássico', sub: 'soma dos 4 clubes' },
  { id: 'posicao', titulo: 'Por Posição', sub: 'G4 e Z4' },
  { id: 'evolucao', titulo: 'Evolução', sub: 'trajetórias' },
]

const FILA: readonly Vista[] = [
  { aba: 'classico', bolao: 'classico' },
  { aba: 'posicao', bolao: 'classico' },
  { aba: 'evolucao', bolao: 'classico' },
  { aba: 'evolucao', bolao: 'posicao' },
]

/**
 * Lugar da vista na fila, ou -1 se ela não estiver lá.
 *
 * Fora da Evolução o campo `bolao` é memória de uma tela que não está aberta, e
 * ignorá-lo é de propósito: a fila é a ordem visível das abas, não o histórico
 * de quem passou por elas.
 */
function indice(v: Vista): number {
  return FILA.findIndex((p) => p.aba === v.aba && (v.aba !== 'evolucao' || p.bolao === v.bolao))
}

/**
 * O próximo lugar da fila, ou `null` nas pontas.
 *
 * Sem volta ao começo: pular do fim para o início num gesto que não pede
 * confirmação desorienta mais do que ajuda. Quem quiser ir do fim ao começo
 * toca na aba.
 */
export function navegar(v: Vista, sentido: Sentido): Vista | null {
  const i = indice(v)
  if (i < 0) return null
  return FILA[i + (sentido === 'frente' ? 1 : -1)] ?? null
}
