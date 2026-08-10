/**
 * Reconciliação entre fontes.
 *
 * A tabela calculada a partir das partidas é a referência. A tabela informada
 * por cada provedor entra como conferência. Discordância nunca é resolvida em
 * silêncio: vira registro e, quando há fontes suficientes, é decidida por
 * maioria.
 *
 * A comparação é por clube resolvido, não por string — fontes diferentes
 * escrevem o mesmo time de formas diferentes, e é justamente isso que a
 * conferência precisa atravessar.
 */
import type { Tabela } from '@bolao/dominio'
import type { LinhaClassificacaoFonte } from './porta.ts'

export type CamposConferidos = 'posicao' | 'pontos' | 'jogos' | 'vitorias' | 'saldoGols' | 'golsPro'

export const CAMPOS: CamposConferidos[] = [
  'posicao',
  'pontos',
  'jogos',
  'vitorias',
  'saldoGols',
  'golsPro',
]

/**
 * `estatistica` é problema de verdade: duas fontes discordam de um fato
 * (pontos, jogos, gols). Merece alarme.
 *
 * `ordenacao` é divergência de convenção, não de fato. A football-data.org
 * ordena por saldo de gols antes de vitórias — critério europeu — enquanto o
 * Brasileirão desempata por vitórias primeiro. Times empatados em pontos
 * saem em ordem diferente sem que ninguém esteja errado sobre os números.
 * Verificado em 09/08/2026: Cruzeiro e Bahia, ambos com 33 pontos, e
 * Mirassol e Internacional, ambos com 23.
 */
export type SeveridadeDivergencia = 'estatistica' | 'ordenacao'

export type DivergenciaCampo = {
  clube: string
  campo: CamposConferidos
  severidade: SeveridadeDivergencia
  valores: Record<string, number | undefined>
  adotado: number | undefined
  votos: number
  total: number
}

export type ResultadoReconciliacao = {
  fontesConsultadas: string[]
  fontesComFalha: { fonte: string; erro: string }[]
  divergencias: DivergenciaCampo[]
  /** Clubes que nenhuma regra conseguiu casar — precisam de apelido. */
  naoResolvidos: { fonte: string; clube: string }[]
  /** `true` quando todas as fontes disponíveis concordaram em tudo. */
  unanime: boolean
  /** `true` quando não há discordância sobre fatos — só sobre ordenação. */
  fatosConferem: boolean
}

/**
 * Normalização de nome — último recurso.
 *
 * Casar fonte com fonte por string não funciona: a football-data.org escreve
 * "Atlético Mineiro" onde o GE escreve "Atlético-MG", e "Vasco da Gama" onde
 * o GE escreve "Vasco". O caminho correto é resolver pelo `clube_alias` do
 * banco, passando um `resolver` — esta função só cobre o caso sem banco.
 */
export function chaveClube(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|ec|sc|ac|clube|futebol|regatas|da|de|do)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

export type ResolvedorDeChave = (nome: string) => string | null

/**
 * Compara a tabela calculada com o que cada fonte informou.
 *
 * @param calculada referência, derivada das partidas
 * @param fontes    o que cada provedor devolveu
 * @param resolver  mapeia nome → chave canônica. Sem ele, cai na
 *                  normalização por string, que erra entre fontes distintas.
 */
export function reconciliar(
  calculada: Tabela,
  fontes: Record<string, LinhaClassificacaoFonte[]>,
  resolver: ResolvedorDeChave = chaveClube,
): ResultadoReconciliacao {
  const chave = (nome: string) => resolver(nome) ?? chaveClube(nome)
  const nomes = Object.keys(fontes)
  const indexadas: Record<string, Map<string, LinhaClassificacaoFonte>> = {}
  const naoResolvidos: { fonte: string; clube: string }[] = []
  for (const n of nomes) {
    indexadas[n] = new Map()
    for (const l of fontes[n]!) {
      const k = resolver(l.clube)
      if (k === null) naoResolvidos.push({ fonte: n, clube: l.clube })
      indexadas[n]!.set(k ?? chaveClube(l.clube), l)
    }
  }

  const divergencias: DivergenciaCampo[] = []

  for (const c of calculada) {
    const k = chave(c.clube)
    for (const campo of CAMPOS) {
      const valores: Record<string, number | undefined> = { calculado: c[campo] }
      for (const n of nomes) valores[n] = indexadas[n]!.get(k)?.[campo]

      const presentes = Object.values(valores).filter((v): v is number => v !== undefined)
      if (presentes.length < 2) continue
      if (new Set(presentes).size === 1) continue

      // Maioria simples; empate mantém o valor calculado, que é a referência.
      const contagem = new Map<number, number>()
      for (const v of presentes) contagem.set(v, (contagem.get(v) ?? 0) + 1)
      let adotado = c[campo]
      let votos = contagem.get(c[campo]) ?? 0
      for (const [valor, n] of contagem) if (n > votos) ((adotado = valor), (votos = n))

      divergencias.push({
        clube: c.clube,
        campo,
        severidade: campo === 'posicao' ? 'ordenacao' : 'estatistica',
        valores,
        adotado,
        votos,
        total: presentes.length,
      })
    }
  }

  return {
    fontesConsultadas: nomes,
    fontesComFalha: [],
    divergencias,
    naoResolvidos,
    unanime: divergencias.length === 0 && naoResolvidos.length === 0,
    fatosConferem:
      naoResolvidos.length === 0 &&
      divergencias.every((d) => d.severidade === 'ordenacao'),
  }
}
