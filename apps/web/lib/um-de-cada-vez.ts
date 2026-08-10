/**
 * Coalescência e janela curta de memória para os caminhos de exceção.
 *
 * O caminho comum da web é ler uma chave pronta do Redis. Quando o Redis falta
 * — worker ainda não rodou, cache limpo, instância fora do ar — cada rota cai
 * num cálculo sobre o Postgres. Sem freio, isso significa que N requisições
 * anônimas simultâneas custam N cálculos, e o custo é pago por quem não pediu
 * nada. Era a raiz dos três achados de CWE-400 de 10/08/2026.
 *
 * Duas garantias, nesta ordem:
 *
 *   coalescência   chamadas concorrentes com a mesma chave compartilham uma
 *                  execução — a segunda espera na primeira, não abre outra
 *   janela de TTL  o resultado fica em memória por alguns segundos; dentro da
 *                  janela não há execução nova
 *
 * Juntas transformam "cada requisição custa um cálculo" em "cada janela custa
 * um cálculo", independentemente de quanta gente chegue ao mesmo tempo.
 *
 * Isto vive **só no caminho de exceção**, depois da tentativa no Redis. Com o
 * cache saudável nada aqui é consultado, e quando o Redis volta a primeira
 * requisição já lê dado fresco dele — não há risco de servir dado velho no
 * caminho comum.
 */

type Entrada = { valor: unknown; expiraEm: number }

export type Coalescedor = <T>(
  chave: string,
  ttlMs: number,
  calcular: () => Promise<T>,
) => Promise<T>

/**
 * As chaves são fixas e contadas a dedo — `resultado`, `historico`,
 * `movimento`. O teto não existe para elas: existe para que um erro futuro,
 * que passe a compor chave com entrada do usuário, não transforme esta função
 * no problema que ela foi escrita para resolver.
 */
const TETO_PADRAO = 64

export function criarUmDeCadaVez(
  opcoes: { agora?: () => number; teto?: number } = {},
): Coalescedor {
  const agora = opcoes.agora ?? Date.now
  const teto = opcoes.teto ?? TETO_PADRAO

  const emVoo = new Map<string, Promise<unknown>>()
  const prontos = new Map<string, Entrada>()

  return function umDeCadaVez<T>(
    chave: string,
    ttlMs: number,
    calcular: () => Promise<T>,
  ): Promise<T> {
    const pronto = prontos.get(chave)
    if (pronto) {
      if (pronto.expiraEm > agora()) return Promise.resolve(pronto.valor as T)
      // Expirado é recalculado, nunca servido.
      prontos.delete(chave)
    }

    const voando = emVoo.get(chave)
    if (voando) return voando as Promise<T>

    const execucao = calcular()
      .then((valor) => {
        // Rejeição não chega aqui de propósito: um erro transitório não pode
        // envenenar a janela inteira. A próxima chamada tenta de novo.
        if (!prontos.has(chave) && prontos.size >= teto) {
          const maisAntiga = prontos.keys().next().value
          if (maisAntiga !== undefined) prontos.delete(maisAntiga)
        }
        prontos.set(chave, { valor, expiraEm: agora() + ttlMs })
        return valor
      })
      .finally(() => {
        emVoo.delete(chave)
      })

    emVoo.set(chave, execucao)
    return execucao
  }
}

export const umDeCadaVez = criarUmDeCadaVez()
