import { lerResultado } from '../../../lib/dados'

export const dynamic = 'force-dynamic'

/**
 * Detalhe de um competidor, sob demanda.
 *
 * A lista precisa de nome, posição, pontos e prêmio; o detalhamento — os
 * quatro clubes com campanha, os oito palpites confrontados com a realidade —
 * só interessa quando alguém abre uma linha. Mandar tudo de antemão é o mesmo
 * erro do sistema atual, que serializa o competidor inteiro em cada atributo
 * `onclick` e infla a página para 220 KB.
 */
export async function GET(req: Request) {
  const nome = new URL(req.url).searchParams.get('nome')
  if (!nome) return Response.json({ erro: 'informe ?nome=' }, { status: 400 })

  const r = await lerResultado()
  if (!r) return Response.json({ erro: 'sem resultado publicado' }, { status: 503 })

  const classico = r.classico.find((l) => l.nome === nome)
  const posicao = r.posicao.find((l) => l.nome === nome)
  if (!classico && !posicao) return Response.json({ erro: 'competidor não encontrado' }, { status: 404 })

  return Response.json({ nome, classico, posicao }, { headers: { 'Cache-Control': 'no-store' } })
}
