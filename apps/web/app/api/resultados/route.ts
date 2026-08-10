import { lerResultado } from '../../../lib/dados'

export const dynamic = 'force-dynamic'

/**
 * Contrato compatível com o `/resultados` do sistema atual.
 *
 * O endpoint antigo tem CORS aberto e pode ter consumidores que ninguém
 * mapeou. Quebrar sem aviso não é opção, então os nomes de campo do payload
 * legado são preservados — `Competidores`, `BolaoNovo`, `Nome`, `Pontos` —
 * e os campos novos entram ao lado.
 */
export async function GET() {
  const r = await lerResultado()
  if (!r)
    return Response.json({ msg: 'Sem resultado publicado' }, { status: 503, headers: cors() })

  const legado = {
    ano: r.temporada,
    titulo: `Bolão do Max - ${r.temporada}`,
    atualizado_em: r.atualizadoEm,
    Competidores: r.classico.map((l) => ({
      Nome: l.nome,
      Pontos: l.pontos,
      Saldo_Gols: l.saldoGols,
      golsPro: l.golsPro,
      Posicao: l.posicao,
      Premio: l.premioCentavos ? formatar(l.premioCentavos) : '-',
      premioCentavos: l.premioCentavos,
      Clubes: l.clubes.map((c) => ({
        Grupo: c.grupo,
        Clube: c.clube,
        Coracao: Boolean(c.coracao),
        pontos: c.pontos,
        jogos: c.jogos,
        vitorias: c.vitorias,
        empates: c.empates,
        derrotas: c.derrotas,
        golsPro: c.golsPro,
        golsContra: c.golsContra,
        saldoGols: c.saldoGols,
        percentual: c.aproveitamento ?? null,
      })),
    })),
    BolaoNovo: r.posicao.map((l) => ({
      Nome: l.nome,
      PontosG4Z4: l.pontos,
      PosicaoG4Z4: l.posicao,
      AcertosG4Z4: l.acertosFaixa,
      AcertosG4: l.acertosG4,
      AcertosZ4: l.acertosZ4,
      PremioG4Z4: l.premioCentavos ? formatar(l.premioCentavos) : '-',
      premioCentavos: l.premioCentavos,
      PalpitesPosicao: l.palpites.map((p) => ({
        Clube: p.clube,
        posicao: p.posicao,
        posicaoAtualTime: p.posicaoAtual ?? undefined,
        acertoG4: p.acertoG4,
        acertoZ4: p.acertoZ4,
        acertoPosicao: p.acertoPosicao,
        pontos: p.pontos,
      })),
    })),
    tabela: r.tabela,
    fontes: r.fontes,
  }

  return Response.json(legado, { headers: cors() })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() })
}

const formatar = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const cors = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store',
})
