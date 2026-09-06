/**
 * Quando convidar a pessoa a instalar o bolão como app.
 *
 * O navegador não pergunta sozinho e não há tag que mande ele perguntar: o
 * manifest só torna o site instalável, e o evento `beforeinstallprompt` entrega
 * o convite na nossa mão para dispararmos quando quisermos. Quando é "quando
 * quisermos" é a decisão deste módulo, e ela é puro cálculo — por isso mora
 * longe do React e tem teste.
 */

/** O que a pessoa respondeu da última vez. */
export type Decisao = 'adiada' | 'recusada' | 'instalada'

export type EstadoInstalacao = {
  /** Quantas vezes a pessoa abriu o site. Conta sessão, não recarregamento. */
  entradas: number
  decisao: Decisao | null
  /** Quando a decisão foi tomada, em epoch ms. */
  decididoEm: number | null
  /** O site já está aberto de dentro do app instalado. */
  jaInstalado: boolean
}

/**
 * A partir de qual entrada o convite aparece.
 *
 * A primeira visita já tem um diálogo — o de dizer quem você é — e é o que faz
 * a tela funcionar. Empilhar o convite de instalar em cima disso são dois
 * modais na cara de quem chega e não conhece o site ainda. Na segunda entrada a
 * pessoa já voltou por vontade própria, que é justamente o sinal de que vale a
 * pena ter o ícone na tela inicial.
 */
export const ENTRADA_MINIMA = 2

/** Quanto tempo o "agora não" compra de silêncio. */
export const ESPERA_MS = 15 * 24 * 60 * 60 * 1000

/** Se cabe mostrar o convite agora. */
export function devePerguntar(e: EstadoInstalacao, agora: number): boolean {
  if (e.jaInstalado) return false
  if (e.decisao === 'instalada' || e.decisao === 'recusada') return false
  if (e.entradas < ENTRADA_MINIMA) return false
  if (e.decisao === 'adiada' && e.decididoEm !== null) return agora - e.decididoEm >= ESPERA_MS
  return true
}

/**
 * `ios` é o caminho sem prompt nativo; `padrao` é onde o navegador coopera.
 *
 * O Safari não implementa `beforeinstallprompt` e não deixa instalar por
 * código: no iPhone o único caminho é a pessoa fazer Compartilhar → Adicionar à
 * Tela de Início. Saber em qual dos dois mundos estamos muda o convite inteiro,
 * de um botão para um passo a passo.
 */
export type Plataforma = 'ios' | 'padrao'

export function plataformaDeInstalacao(userAgent: string, pontosDeToque: number): Plataforma {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios'
  // Desde o iPadOS 13 o Safari do iPad se apresenta como Macintosh. O que
  // sobra para distinguir de um Mac de verdade é a tela sensível ao toque.
  if (/macintosh/i.test(userAgent) && pontosDeToque > 1) return 'ios'
  return 'padrao'
}
