import { lerHistorico, type Bolao, type Janela } from '../../../lib/series'

export const dynamic = 'force-dynamic'

/**
 * Séries de trajetória para a aba Evolução.
 *
 * Endpoint próprio porque são 30 competidores × até 48 pontos: mandar isso na
 * carga inicial pesaria a página para quem nunca abre a aba. O protótipo já
 * prevê o estado "Carregando trajetórias…".
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const janela = (u.searchParams.get('janela') ?? 'dia') as Janela
  const bolao = (u.searchParams.get('bolao') ?? 'classico') as Bolao

  if (janela !== 'hora' && janela !== 'dia')
    return Response.json({ erro: 'janela deve ser hora ou dia' }, { status: 400 })
  if (bolao !== 'classico' && bolao !== 'posicao')
    return Response.json({ erro: 'bolao deve ser classico ou posicao' }, { status: 400 })

  const h = await lerHistorico()
  return Response.json(h[janela][bolao], { headers: { 'Cache-Control': 'no-store' } })
}
