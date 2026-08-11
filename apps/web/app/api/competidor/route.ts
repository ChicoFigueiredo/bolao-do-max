import { carregarConfig } from '@bolao/config'
import { cacheCompartilhado, lerResultado } from '../../../lib/dados'
import type { DetalhePronto } from '@bolao/worker/prerender'

export const dynamic = 'force-dynamic'

const TETO_NOME = 80

/**
 * Detalhe de um competidor.
 *
 * Caminho comum: leitura de uma chave que o worker já montou. Sem cálculo, sem
 * Postgres, sem varrer o payload inteiro — é o que faz o toque na tela abrir o
 * painel sem espera.
 *
 * Caminho de exceção: o Redis não tem a chave (worker ainda não rodou, ou cache
 * limpo). Aí monta na hora a partir do resultado, para a tela não quebrar.
 */
export async function GET(req: Request) {
  const u = new URL(req.url)
  const nome = u.searchParams.get('nome')
  const tipo = u.searchParams.get('tipo') === 'posicao' ? 'posicao' : 'classico'
  if (!nome) return Response.json({ erro: 'informe ?nome=' }, { status: 400 })
  // `nome` vem do público e vira sufixo de chave no Redis. Não há injeção — o
  // client fala RESP e trata o valor como argumento — mas tamanho de chave sem
  // teto é entrada não limitada vinda de fora. Nome de competidor não chega
  // perto disto.
  if (nome.length > TETO_NOME) return Response.json({ erro: 'nome longo demais' }, { status: 400 })

  const cfg = carregarConfig()

  try {
    const pronto = await cacheCompartilhado(cfg).lerDetalhe<DetalhePronto>(
      cfg.TEMPORADA_ATUAL,
      tipo,
      nome,
    )
    if (pronto) return Response.json(pronto, { headers: cabecalhos('cache') })
  } catch {
    /* Redis fora do ar — monta na hora */
  }

  // O resultado vem antes da checagem do nome, e continua vindo: `lerResultado`
  // coalesce o modo degradado, então mil nomes inválidos simultâneos custam um
  // cálculo, não mil. Inverter a ordem exigiria publicar e manter uma lista de
  // nomes válidos — estado novo para uma propriedade que a coalescência já dá.
  const r = await lerResultado()
  if (!r) return Response.json({ erro: 'sem resultado publicado' }, { status: 503 })

  const classico = r.classico.find((l) => l.nome === nome)
  const posicao = r.posicao.find((l) => l.nome === nome)
  if (!classico && !posicao)
    return Response.json({ erro: 'competidor não encontrado' }, { status: 404 })

  // Sem trajetória neste caminho: calculá-la exigiria varrer os snapshots, que
  // é justamente o custo que a pré-renderização existe para evitar. Ela volta
  // no próximo ciclo do worker.
  return Response.json(
    { nome, classico, posicao, trajetoria: null } satisfies DetalhePronto,
    { headers: cabecalhos('calculado') },
  )
}

const cabecalhos = (origem: string) => ({
  'Cache-Control': 'no-store',
  'X-Origem': origem,
})
