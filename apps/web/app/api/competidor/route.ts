import { lerResultado } from '../../../lib/dados'
import { lerHistorico } from '../../../lib/series'

export const dynamic = 'force-dynamic'

/**
 * Detalhe de um competidor, sob demanda.
 *
 * A lista precisa de nome, posição, pontos e prêmio; o detalhamento — os quatro
 * clubes com campanha, os oito palpites confrontados com a realidade, a
 * trajetória de 21 dias — só interessa quando alguém abre uma linha. Mandar
 * tudo de antemão é o mesmo erro do sistema atual, que serializa o competidor
 * inteiro em cada atributo `onclick` e infla a página para 220 KB.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const nome = u.searchParams.get('nome')
  const tipo = u.searchParams.get('tipo') === 'posicao' ? 'posicao' : 'classico'
  if (!nome) return Response.json({ erro: 'informe ?nome=' }, { status: 400 })

  const r = await lerResultado()
  if (!r) return Response.json({ erro: 'sem resultado publicado' }, { status: 503 })

  const classico = r.classico.find((l) => l.nome === nome)
  const posicao = r.posicao.find((l) => l.nome === nome)
  if (!classico && !posicao) return Response.json({ erro: 'competidor não encontrado' }, { status: 404 })

  // Trajetória de 21 dias, do bolão que a linha aberta representa.
  const h = await lerHistorico()
  const serie = h.dia[tipo]
  const pontos = serie.posicao[nome]
  const trajetoria =
    pontos && pontos.length >= 2
      ? { pontos, inicio: serie.rotulos[0], fim: serie.rotulos.at(-1), total: serie.rotulos.length }
      : null

  return Response.json(
    { nome, classico, posicao, trajetoria },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
