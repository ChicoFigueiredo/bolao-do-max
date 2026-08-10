'use client'

import { useEffect, useMemo, useState } from 'react'
import { Rotulo, ord, polilinha, setaCor, setaTxt, sparkline } from './ui'

type Bolao = 'classico' | 'posicao'
type Janela = 'hora' | 'dia' | 'semana'

const PERIODO: Record<Janela, string> = {
  hora: 'últimas 48 horas',
  dia: 'últimos 30 dias',
  semana: 'campeonato inteiro, por semana',
}

type Serie = {
  rotulos: string[]
  posicao: Record<string, number[]>
  pontosReais: number
}

/**
 * Aba Evolução: trajetória de posição de cada competidor.
 *
 * Sai dos snapshots — dado que o sistema atual descarta. Carrega sob demanda
 * porque são 30 séries de até 48 pontos, e quem nunca abre a aba não deve
 * pagar por elas.
 */
export function Evolucao({ eu }: { eu: string | null }) {
  const [bolao, setBolao] = useState<Bolao>('classico')
  const [janela, setJanela] = useState<Janela>('dia')
  const [serie, setSerie] = useState<Serie | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [foco, setFoco] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro(null)
    fetch(`/api/evolucao?bolao=${bolao}&janela=${janela}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => vivo && setSerie(j))
      .catch((e) => vivo && setErro(String(e?.message ?? e)))
      .finally(() => vivo && setCarregando(false))
    return () => {
      vivo = false
    }
  }, [bolao, janela])

  const movs = useMemo(() => {
    if (!serie) return []
    return Object.entries(serie.posicao)
      .map(([nome, s]) => ({
        nome,
        serie: s,
        ini: s[0]!,
        fim: s.at(-1)!,
        delta: s[0]! - s.at(-1)!,
      }))
      .sort((a, b) => a.fim - b.fim)
  }, [serie])

  const total = movs.length || 30

  /** Foco: quem o usuário escolheu, senão ele mesmo, senão quem mais se moveu. */
  const nomeFoco = useMemo(() => {
    if (foco && serie?.posicao[foco]) return foco
    if (eu && serie?.posicao[eu]) return eu
    let melhor = ''
    let amp = -1
    for (const m of movs) {
      const a = Math.abs(m.delta)
      if (a > amp) {
        amp = a
        melhor = m.nome
      }
    }
    return melhor || movs[0]?.nome || ''
  }, [foco, eu, serie, movs])

  const fm = movs.find((m) => m.nome === nomeFoco)
  const porDelta = [...movs].sort((a, b) => b.delta - a.delta)
  const sobem = porDelta.filter((m) => m.delta > 0).slice(0, 3)
  const caem = porDelta.filter((m) => m.delta < 0).slice(-3).reverse()

  const semDados = !carregando && !erro && movs.length === 0

  return (
    <>
      <div style={{ padding: '14px var(--gutter) 0', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Segmentos
          rotuloGrupo="Escolher bolão"
          opcoes={[
            { k: 'classico', rot: 'Clássico' },
            { k: 'posicao', rot: 'Por Posição' },
          ]}
          valor={bolao}
          onMudar={(k) => setBolao(k as Bolao)}
        />
        <Segmentos
          rotuloGrupo="Escolher janela de tempo"
          opcoes={[
            { k: 'hora', rot: '48 horas' },
            { k: 'dia', rot: '30 dias' },
            { k: 'semana', rot: 'Campeonato' },
          ]}
          valor={janela}
          onMudar={(k) => setJanela(k as Janela)}
        />
      </div>

      {carregando && <Aviso>Carregando trajetórias…</Aviso>}
      {erro && <Aviso cor="var(--neg)">Não consegui carregar as trajetórias: {erro}</Aviso>}
      {semDados && (
        <Aviso>
          Ainda não há série suficiente nesta janela. A trajetória aparece quando existirem pelo
          menos dois snapshots — o worker grava um a cada vez que a tabela muda.
        </Aviso>
      )}

      {serie && fm && movs.length > 0 && (
        <>
          <div
            style={{
              margin: '12px var(--gutter) 0',
              border: '1px solid var(--line-soft)',
              borderRadius: 16,
              background: 'var(--surf)',
              padding: '14px 14px 12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '.12em',
                  color: 'var(--accent)',
                  textTransform: 'uppercase',
                }}
              >
                {bolao === 'classico' ? 'Bolão Clássico' : 'Bolão por Posição'}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {PERIODO[janela]} · {serie.rotulos.length} pontos · {serie.pontosReais} snapshots
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 2 }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: 'clamp(19px,4.8vw,24px)',
                  fontWeight: 800,
                  letterSpacing: '-.025em',
                }}
              >
                {nomeFoco}
              </h2>
              <span className="mono" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
                {ord(fm.ini)} → {ord(fm.fim)}
              </span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: setaCor(fm.delta) }}>
                {setaTxt(fm.delta)}
              </span>
            </div>

            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <div
                className="mono"
                style={{
                  flex: 'none',
                  width: 26,
                  position: 'relative',
                  height: 210,
                  fontSize: 10.5,
                  color: 'var(--ink-3)',
                  textAlign: 'right',
                }}
              >
                {[1, 10, 20, total].map((p) => (
                  <span
                    key={p}
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: `${((p - 1) / Math.max(1, total - 1)) * 100}%`,
                      transform: 'translateY(-50%)',
                    }}
                  >
                    {ord(p)}
                  </span>
                ))}
              </div>
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={`Trajetória de posição de ${nomeFoco} entre ${serie.rotulos[0]} e ${serie.rotulos.at(-1)}`}
                style={{ flex: 1, height: 210, display: 'block', overflow: 'visible' }}
              >
                {[1, 10, 20, total].map((p) => {
                  const y = ((p - 1) / Math.max(1, total - 1)) * 100
                  return (
                    <line
                      key={p}
                      x1="0"
                      y1={y}
                      x2="100"
                      y2={y}
                      stroke="var(--line-soft)"
                      strokeWidth="1"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
                {movs
                  .filter((m) => m.nome !== nomeFoco)
                  .map((m) => (
                    <polyline
                      key={m.nome}
                      points={polilinha(m.serie, total)}
                      fill="none"
                      stroke={m.nome === eu ? 'var(--ok)' : 'var(--line-soft)'}
                      strokeWidth={m.nome === eu ? 1.8 : 1.25}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                    />
                  ))}
                <polyline
                  points={polilinha(fm.serie, total)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  vectorEffect="non-scaling-stroke"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                margin: '6px 0 0 34px',
                fontSize: 11,
                color: 'var(--ink-3)',
              }}
            >
              <span>{serie.rotulos[0]}</span>
              <span>{serie.rotulos.at(-1)}</span>
            </div>
          </div>

          <div
            style={{
              margin: '12px var(--gutter) 0',
              display: 'grid',
              gridTemplateColumns: 'var(--cols-mov)',
              gap: 8,
            }}
          >
            {[
              { titulo: 'Quem mais subiu', cor: 'var(--ok)', itens: sobem },
              { titulo: 'Quem mais caiu', cor: 'var(--neg)', itens: caem },
            ].map((b) => (
              <div
                key={b.titulo}
                style={{
                  border: '1px solid var(--line-soft)',
                  borderRadius: 14,
                  background: 'var(--surf)',
                  padding: 12,
                }}
              >
                <Rotulo cor={b.cor}>{b.titulo}</Rotulo>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {b.itens.map((m) => (
                    <button
                      key={m.nome}
                      type="button"
                      onClick={() => setFoco(m.nome)}
                      style={{ display: 'flex', alignItems: 'baseline', gap: 6, width: '100%' }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13.5,
                          fontWeight: 600,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.nome}
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {ord(m.ini)}→{ord(m.fim)}
                      </span>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: b.cor }}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </span>
                    </button>
                  ))}
                  {!b.itens.length && (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                      Ninguém se mexeu nessa janela.
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <ol
            style={{
              listStyle: 'none',
              margin: 0,
              padding: '14px var(--gutter) 0',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            {movs.map((m) => {
              const focado = m.nome === nomeFoco
              return (
                <li key={m.nome}>
                  <button
                    type="button"
                    onClick={() => setFoco(m.nome)}
                    aria-label={`${m.nome}, hoje ${ord(m.fim)}, era ${ord(m.ini)}. Ver no gráfico.`}
                    style={{
                      width: '100%',
                      minHeight: 'var(--row-min)',
                      display: 'grid',
                      gridTemplateColumns: 'var(--cols-e)',
                      gap: 8,
                      alignItems: 'center',
                      padding: '8px 12px',
                      border: `1px solid ${focado ? 'var(--accent)' : 'var(--line-soft)'}`,
                      borderRadius: 14,
                      background: 'var(--surf)',
                      boxShadow: eu === m.nome ? 'inset 0 0 0 2px var(--accent)' : 'none',
                    }}
                  >
                    <span
                      className="mono"
                      style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)', textAlign: 'center' }}
                    >
                      {m.fim}
                    </span>
                    <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span
                        style={{
                          fontSize: 'var(--fs-nome)',
                          fontWeight: 600,
                          letterSpacing: '-.01em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.nome}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                        {ord(m.ini)} → {ord(m.fim)}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 100 100"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                      style={{ width: '100%', height: 30, display: 'block', overflow: 'visible' }}
                    >
                      <polyline
                        points={sparkline(m.serie)}
                        fill="none"
                        stroke={focado ? 'var(--accent)' : m.nome === eu ? 'var(--ok)' : 'var(--ink-3)'}
                        strokeWidth={focado ? 2.5 : 1.5}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span
                      className="mono"
                      style={{
                        textAlign: 'right',
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: setaCor(m.delta),
                      }}
                    >
                      {setaTxt(m.delta)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          <p
            style={{
              margin: '14px var(--gutter) 0',
              fontSize: 12,
              color: 'var(--ink-3)',
              lineHeight: 1.5,
            }}
          >
            Cada linha mostra a trajetória da posição na janela escolhida — topo do quadro é 1º, base
            é {ord(total)}. Toque para trazer alguém ao gráfico grande.
          </p>
        </>
      )}
    </>
  )
}

function Segmentos({
  rotuloGrupo,
  opcoes,
  valor,
  onMudar,
}: {
  rotuloGrupo: string
  opcoes: { k: string; rot: string }[]
  valor: string
  onMudar: (k: string) => void
}) {
  return (
    <div
      role="group"
      aria-label={rotuloGrupo}
      style={{
        display: 'flex',
        gap: 3,
        padding: 3,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--surf)',
      }}
    >
      {opcoes.map((o) => {
        const sel = valor === o.k
        return (
          <button
            key={o.k}
            type="button"
            aria-pressed={sel}
            onClick={() => onMudar(o.k)}
            style={{
              minHeight: 38,
              padding: '6px 12px',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: sel ? 700 : 500,
              background: sel ? 'var(--accent)' : 'transparent',
              color: sel ? 'var(--on-accent)' : 'var(--ink-2)',
            }}
          >
            {o.rot}
          </button>
        )
      })}
    </div>
  )
}

function Aviso({ children, cor = 'var(--ink-3)' }: { children: React.ReactNode; cor?: string }) {
  return (
    <p
      style={{
        margin: '14px var(--gutter) 0',
        padding: '22px 16px',
        border: '1px solid var(--line-soft)',
        borderRadius: 16,
        background: 'var(--surf)',
        color: cor,
        fontSize: 14,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  )
}
