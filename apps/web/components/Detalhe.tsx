'use client'

import type { LinhaClassico, LinhaPosicao } from '@bolao/dominio'
import { useEffect, useState } from 'react'
import { Folha, Rotulo, brl, ord, polilinha, setaCor, setaTxt, sinal } from './ui'

type Aba = 'classico' | 'posicao'

type Resposta = {
  nome: string
  classico?: LinhaClassico
  posicao?: LinhaPosicao
  trajetoria: { pontos: number[]; inicio: string; fim: string; total: number } | null
}

const CORES_BARRA = ['var(--accent)', 'var(--ok)', 'var(--ink-3)', 'var(--gold, #8A6410)']

export function Detalhe({
  nome,
  tipo,
  totalCompetidores,
  onFechar,
}: {
  nome: string
  tipo: Aba
  totalCompetidores: number
  onFechar: () => void
}) {
  const [d, setD] = useState<Resposta | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setD(null)
    setErro(null)
    fetch(`/api/competidor?nome=${encodeURIComponent(nome)}&tipo=${tipo}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => vivo && setD(j))
      .catch((e) => vivo && setErro(String(e?.message ?? e)))
    return () => {
      vivo = false
    }
  }, [nome, tipo])

  const c = d?.classico
  const p = d?.posicao
  const ehClassico = tipo === 'classico'
  const linha = ehClassico ? c : p
  const bolao = ehClassico ? 'Bolão Clássico' : 'Bolão por Posição'
  const sub = linha
    ? `${ord(linha.posicao)} de ${totalCompetidores} · prêmio ${linha.premioCentavos ? brl(linha.premioCentavos) : '—'}`
    : ''

  const stats = !linha
    ? []
    : ehClassico && c
      ? [
          { rot: 'Pontos', val: String(c.pontos), cor: 'var(--ink)' },
          { rot: 'Saldo', val: sinal(c.saldoGols), cor: c.saldoGols < 0 ? 'var(--neg)' : 'var(--ink)' },
          { rot: 'Gols pró', val: String(c.golsPro), cor: 'var(--ink)' },
          { rot: 'Gols contra', val: String(c.golsContra), cor: 'var(--ink)' },
        ]
      : p
        ? [
            { rot: 'Pontos', val: String(p.pontos), cor: 'var(--ink)' },
            {
              rot: 'Na mosca',
              val: `${p.palpites.filter((x) => x.acertoPosicao).length}/8`,
              cor: p.palpites.some((x) => x.acertoPosicao) ? 'var(--ok)' : 'var(--ink)',
            },
            { rot: 'Clubes certos', val: `${p.acertosFaixa}/8`, cor: 'var(--ink)' },
            { rot: 'G4 · Z4', val: `${p.acertosG4} · ${p.acertosZ4}`, cor: 'var(--ink)' },
          ]
        : []

  return (
    <Folha
      aria={ehClassico ? `Detalhamento de ${nome} no Bolão Clássico` : `Palpites de ${nome} no Bolão por Posição`}
      onFechar={onFechar}
      cabecalho={
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.12em',
              color: 'var(--accent)',
              textTransform: 'uppercase',
            }}
          >
            {bolao}
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 'clamp(20px,5vw,26px)',
              fontWeight: 800,
              letterSpacing: '-.025em',
              lineHeight: 1.05,
            }}
          >
            {nome}
          </h2>
          <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{sub}</span>
        </div>
      }
    >
      {erro && <p style={{ color: 'var(--neg)', fontSize: 14 }}>Não consegui carregar: {erro}</p>}
      {!d && !erro && <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>Carregando…</p>}

      {stats.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
          {stats.map((s) => (
            <div
              key={s.rot}
              style={{
                padding: 10,
                border: '1px solid var(--line-soft)',
                borderRadius: 12,
                background: 'var(--surf)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '.07em',
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                }}
              >
                {s.rot}
              </span>
              <span
                className="mono"
                style={{ fontSize: 'clamp(16px,4.4vw,20px)', fontWeight: 600, color: s.cor }}
              >
                {s.val}
              </span>
            </div>
          ))}
        </div>
      )}

      {d?.trajetoria && <Trajetoria t={d.trajetoria} />}

      {ehClassico && c && <ComposicaoClassico c={c} />}
      {!ehClassico && p && <Palpites p={p} />}
    </Folha>
  )
}

function Trajetoria({
  t,
}: {
  t: { pontos: number[]; inicio: string; fim: string; total: number }
}) {
  const delta = t.pontos[0]! - t.pontos.at(-1)!
  const cor = delta > 0 ? 'var(--ok)' : delta < 0 ? 'var(--neg)' : 'var(--accent)'
  return (
    <div
      style={{
        marginTop: 12,
        border: '1px solid var(--line-soft)',
        borderRadius: 14,
        background: 'var(--surf)',
        padding: '12px 14px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '.09em',
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
          }}
        >
          Trajetória · {t.total} dias
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
          {ord(t.pontos[0]!)} → {ord(t.pontos.at(-1)!)}
        </span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: setaCor(delta) }}>
          {setaTxt(delta)}
        </span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ width: '100%', height: 64, display: 'block', marginTop: 8, overflow: 'visible' }}
      >
        <line x1="0" y1="0" x2="100" y2="0" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="100" x2="100" y2="100" stroke="var(--line-soft)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline
          points={polilinha(t.pontos, 30)}
          fill="none"
          stroke={cor}
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: 5,
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span>{t.inicio}</span>
        <span>1º no topo · 30º na base</span>
        <span>{t.fim}</span>
      </div>
    </div>
  )
}

function ComposicaoClassico({ c }: { c: LinhaClassico }) {
  const total = c.pontos || 1
  return (
    <>
      <div style={{ marginTop: 18 }}>
        <Rotulo>Como os {c.pontos} pontos se formam</Rotulo>
        <div
          style={{
            display: 'flex',
            height: 12,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--line-soft)',
          }}
        >
          {c.clubes.map((x, i) => (
            <span
              key={x.grupo}
              title={`${x.clube}: ${x.pontos} pts`}
              style={{ width: `${(x.pontos / total) * 100}%`, background: CORES_BARRA[i] }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {c.clubes.map((x) => {
          const chips = [
            { rot: 'J', val: String(x.jogos), cor: 'var(--ink)' },
            { rot: 'V', val: String(x.vitorias), cor: 'var(--ok)' },
            { rot: 'E', val: String(x.empates), cor: 'var(--ink-2)' },
            { rot: 'D', val: String(x.derrotas), cor: 'var(--neg)' },
            { rot: 'GP', val: String(x.golsPro), cor: 'var(--ink)' },
            { rot: 'GC', val: String(x.golsContra), cor: 'var(--ink)' },
            { rot: 'SG', val: sinal(x.saldoGols), cor: x.saldoGols < 0 ? 'var(--neg)' : 'var(--ink)' },
          ]
          const pct = x.aproveitamento ?? 0
          return (
            <div
              key={x.grupo}
              style={{
                border: '1px solid var(--line-soft)',
                borderRadius: 14,
                background: 'var(--surf)',
                padding: '12px 14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.08em',
                    color: 'var(--accent)',
                    border: '1px solid var(--line)',
                    borderRadius: 5,
                    padding: '2px 5px',
                  }}
                >
                  {x.grupo}
                </span>
                <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em' }}>
                  {x.clube}
                  {x.coracao ? ' ❤️' : ''}
                </span>
                {/*
                  Sem isto o cartão diz quanto o clube rendeu e não diz onde ele
                  está. Condicional porque o detalhe vem pré-renderizado no
                  Redis: durante uma troca de versão o payload guardado ainda é
                  o antigo, e é melhor faltar a linha do que escrever "undefinedº".
                */}
                {x.posicaoTabela ? (
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {ord(x.posicaoTabela)} na tabela
                  </span>
                ) : null}
                <span style={{ flex: 1 }} />
                <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
                  {x.pontos}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>pts</span>
              </div>
              <div style={{ marginTop: 9, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {chips.map((ch) => (
                  <span
                    key={ch.rot}
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-2)',
                      background: 'var(--surf-2)',
                      borderRadius: 7,
                      padding: '4px 8px',
                    }}
                  >
                    {ch.rot}{' '}
                    <b className="mono" style={{ fontWeight: 600, color: ch.cor }}>
                      {ch.val}
                    </b>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    flex: 1,
                    height: 6,
                    borderRadius: 3,
                    background: 'var(--surf-2)',
                    overflow: 'hidden',
                    display: 'block',
                  }}
                >
                  <span
                    style={{ display: 'block', height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 3 }}
                  />
                </span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {pct}% aproveitamento
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Palpites({ p }: { p: LinhaPosicao }) {
  const g4 = p.palpites.filter((x) => x.posicao <= 4).sort((a, b) => a.posicao - b.posicao)
  const z4 = p.palpites.filter((x) => x.posicao >= 17).sort((a, b) => a.posicao - b.posicao)
  const blocos = [
    { titulo: 'G4 — palpites de 1º a 4º', sub: 'Quem foi apostado no topo e onde esses clubes estão hoje', itens: g4 },
    { titulo: 'Z4 — palpites de 17º a 20º', sub: 'Quem foi apostado na zona e onde esses clubes estão hoje', itens: z4 },
  ]

  return (
    <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {blocos.map((b) => (
        <div key={b.titulo}>
          <Rotulo>{b.titulo}</Rotulo>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--ink-3)' }}>{b.sub}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {b.itens.map((x) => (
              <EixoPalpite key={`${x.clube}-${x.posicao}`} x={x} />
            ))}
          </div>
        </div>
      ))}
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        Círculo vazado = o palpite. Círculo cheio = onde o clube está hoje.
      </p>
    </div>
  )
}

/** Eixo de 1º a 20º com o palpite e a posição real, como no protótipo. */
function EixoPalpite({ x }: { x: LinhaPosicao['palpites'][number] }) {
  const L = (n: number) => ((n - 1) / 19) * 100
  const a = L(x.posicao)
  const b = x.posicaoAtual != null ? L(x.posicaoAtual) : null
  const dist = x.posicaoAtual != null ? Math.abs(x.posicao - x.posicaoAtual) : null

  const corAlvo = x.acertoPosicao ? 'var(--ok)' : x.pontos ? 'var(--accent)' : 'var(--ink-3)'
  const distTxt =
    dist === null
      ? 'clube fora da tabela'
      : dist === 0
        ? 'na mosca'
        : dist === 1
          ? '1 posição de distância'
          : `${dist} posições de distância`

  return (
    <div
      style={{
        border: `1px solid ${x.pontos ? 'var(--line)' : 'var(--line-soft)'}`,
        borderRadius: 14,
        background: 'var(--surf)',
        padding: '11px 13px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: '-.01em',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {x.clube}
        </span>
        <span className="mono" style={{ fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'nowrap' }}>
          {ord(x.posicao)} → {x.posicaoAtual != null ? ord(x.posicaoAtual) : '—'}
        </span>
        <span
          className="mono"
          style={{
            flex: 'none',
            minWidth: 44,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            padding: '4px 8px',
            borderRadius: 8,
            background: x.acertoPosicao ? 'var(--ok)' : 'transparent',
            color: x.acertoPosicao ? 'var(--on-accent)' : x.pontos ? 'var(--accent)' : 'var(--ink-3)',
            border: `1px solid ${x.acertoPosicao ? 'var(--ok)' : x.pontos ? 'var(--accent)' : 'var(--line-soft)'}`,
          }}
        >
          {x.pontos ? `+${x.pontos}` : '0'}
        </span>
      </div>

      <div style={{ marginTop: 10, position: 'relative', height: 14 }}>
        <span
          style={{ position: 'absolute', left: 0, right: 0, top: 6, height: 2, background: 'var(--line-soft)', borderRadius: 2 }}
        />
        {/* faixas G4 e Z4 destacadas */}
        <span style={{ position: 'absolute', left: 0, top: 6, height: 2, width: '20%', background: 'var(--accent-soft)', borderRadius: 2 }} />
        <span style={{ position: 'absolute', right: 0, top: 6, height: 2, width: '20%', background: 'var(--accent-soft)', borderRadius: 2 }} />
        {b !== null && (
          <span
            style={{
              position: 'absolute',
              top: 6,
              height: 2,
              left: `${Math.min(a, b)}%`,
              width: `${Math.abs(a - b)}%`,
              background: x.acertoPosicao ? 'var(--ok)' : x.pontos ? 'var(--accent)' : 'var(--line)',
              borderRadius: 2,
            }}
          />
        )}
        <span
          title={`palpite: ${ord(x.posicao)}`}
          style={{
            position: 'absolute',
            top: 1,
            left: `${a}%`,
            width: 12,
            height: 12,
            marginLeft: -6,
            borderRadius: '50%',
            border: '2px solid var(--ink-3)',
            background: 'var(--bg)',
          }}
        />
        {b !== null && (
          <span
            title={`hoje: ${ord(x.posicaoAtual!)}`}
            style={{
              position: 'absolute',
              top: 1,
              left: `${b}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              borderRadius: '50%',
              border: `2px solid ${corAlvo}`,
              background: corAlvo,
            }}
          />
        )}
      </div>
      <div
        style={{
          marginTop: 3,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--ink-3)',
        }}
      >
        <span>1º</span>
        <span>{distTxt}</span>
        <span>20º</span>
      </div>
    </div>
  )
}
