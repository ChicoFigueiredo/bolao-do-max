import { Painel } from '../components/Painel'
import { lerMovimento24h, lerResultado } from '../lib/dados'

/** Sem cache de rota: o worker republica o Redis a cada ciclo. */
export const dynamic = 'force-dynamic'

export default async function Pagina() {
  const [r, movimento] = await Promise.all([lerResultado(), lerMovimento24h()])

  if (!r)
    return (
      <main style={{ padding: 40, maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22 }}>Bolão do Max</h1>
        <p style={{ color: 'var(--ink-2)', lineHeight: 1.6 }}>
          Ainda não há resultado publicado. Suba a infra local, rode as migrations e o seed, e
          execute um ciclo do worker:
        </p>
        <pre
          style={{
            background: 'var(--surf-2)',
            padding: 14,
            borderRadius: 10,
            fontSize: 13,
            overflowX: 'auto',
          }}
        >
          {`bun run infra:up\nbun run db:migrate\nbun run db:seed\nbun run worker:ciclo`}
        </pre>
      </main>
    )

  // Só o resumo cruza para o cliente. Clubes e palpites — o detalhe — ficam
  // no servidor e são buscados em /api/competidor quando a linha é aberta.
  // Mandar tudo de antemão duplicaria o payload no flight do RSC, que é o
  // mesmo desperdício que esta reescrita existe para eliminar.
  return (
    <Painel
      temporada={r.temporada}
      atualizadoEm={r.atualizadoEm}
      rodada={r.rodada}
      classico={r.classico.map((l) => ({
        nome: l.nome,
        posicao: l.posicao,
        pontos: l.pontos,
        saldoGols: l.saldoGols,
        premioCentavos: l.premioCentavos,
        clubes: l.clubes.map((c) => ({ clube: c.clube, coracao: Boolean(c.coracao) })),
      }))}
      posicao={r.posicao.map((l) => ({
        nome: l.nome,
        posicao: l.posicao,
        pontos: l.pontos,
        acertosFaixa: l.acertosFaixa,
        acertosG4: l.acertosG4,
        acertosZ4: l.acertosZ4,
        premioCentavos: l.premioCentavos,
      }))}
      movimento={movimento}
      fontes={r.fontes}
      origemLeitura={r.origemLeitura}
    />
  )
}
