import { carregarConfig } from '@bolao/config'
import type { Bolao, Janela, SerieTemporal } from '@bolao/worker/series'
import { calcularHistorico } from '@bolao/worker/series'
import { cacheCompartilhado } from '../../../lib/dados'

export const dynamic = 'force-dynamic'

/**
 * Séries de trajetória para a aba Evolução.
 *
 * Lidas prontas do Redis, onde o worker as deixa a cada ciclo. Recalcular a
 * cada requisição significaria varrer 146 snapshots × 30 competidores por
 * usuário que abre a aba.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const janela = (u.searchParams.get('janela') ?? 'dia') as Janela
  const bolao = (u.searchParams.get('bolao') ?? 'classico') as Bolao

  if (janela !== 'hora' && janela !== 'dia' && janela !== 'semana')
    return Response.json({ erro: 'janela deve ser hora, dia ou semana' }, { status: 400 })
  if (bolao !== 'classico' && bolao !== 'posicao')
    return Response.json({ erro: 'bolao deve ser classico ou posicao' }, { status: 400 })

  const cfg = carregarConfig()

  try {
    const pronta = await cacheCompartilhado(cfg).lerEvolucao<SerieTemporal>(
      cfg.TEMPORADA_ATUAL,
      bolao,
      janela,
    )
    if (pronta) return Response.json(pronta, { headers: { 'Cache-Control': 'no-store', 'X-Origem': 'cache' } })
  } catch {
    /* Redis fora do ar — calcula */
  }

  const h = await calcularHistorico()
  return Response.json(h[janela][bolao], {
    headers: { 'Cache-Control': 'no-store', 'X-Origem': 'calculado' },
  })
}
