'use client'

import type { LinhaClassico, LinhaPosicao } from '@bolao/dominio'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Movimento } from '../lib/dados'
import { Sheet } from './Sheet'

type Aba = 'classico' | 'posicao'
type Tema = 'ocre' | 'claro' | 'escuro'

const TEMAS: { id: Tema; rotulo: string }[] = [
  { id: 'ocre', rotulo: 'Ocre' },
  { id: 'claro', rotulo: 'Claro' },
  { id: 'escuro', rotulo: 'Escuro' },
]

const brl = (centavos: number) =>
  centavos.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ord = (n: number) => `${n}º`
const sinal = (n: number) => (n > 0 ? `+${n}` : String(n))

/** Resumo: o que a lista precisa. O detalhe vem de /api/competidor. */
export type ResumoClassico = {
  nome: string
  posicao: number
  pontos: number
  saldoGols: number
  premioCentavos: number
  clubes: { clube: string; coracao: boolean }[]
}

export type ResumoPosicao = {
  nome: string
  posicao: number
  pontos: number
  acertosFaixa: number
  acertosG4: number
  acertosZ4: number
  premioCentavos: number
}

export type DadosPainel = {
  temporada: number
  atualizadoEm: string
  rodada: number | null
  classico: ResumoClassico[]
  posicao: ResumoPosicao[]
  movimento: Movimento
  fontes: string[]
  origemLeitura: string
}

export function Painel(d: DadosPainel) {
  const [aba, setAba] = useState<Aba>('classico')
  const [tema, setTema] = useState<Tema>('ocre')
  const [busca, setBusca] = useState('')
  const [eu, setEu] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [regras, setRegras] = useState(false)
  const [detalhe, setDetalhe] = useState<{ nome: string; tipo: Aba } | null>(null)
  const tabs = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const a = localStorage.getItem('bolao:aba')
      if (a === 'classico' || a === 'posicao') setAba(a)
      const t = document.documentElement.getAttribute('data-tema') as Tema | null
      if (t) setTema(t)
      setEu(localStorage.getItem('bolao:eu'))
    } catch {
      /* localStorage bloqueado — segue com os padrões */
    }
  }, [])

  const trocarAba = useCallback((a: Aba) => {
    setAba(a)
    try {
      localStorage.setItem('bolao:aba', a)
    } catch {}
  }, [])

  const trocarTema = useCallback((t: Tema) => {
    setTema(t)
    document.documentElement.setAttribute('data-tema', t)
    try {
      localStorage.setItem('bolao:tema', t)
    } catch {}
  }, [])

  const definirEu = useCallback((nome: string | null) => {
    setEu(nome)
    try {
      if (nome) localStorage.setItem('bolao:eu', nome)
      else localStorage.removeItem('bolao:eu')
    } catch {}
  }, [])

  const q = busca.trim().toLowerCase()
  const filtrar = <T extends { nome: string }>(l: T[]) =>
    q ? l.filter((x) => x.nome.toLowerCase().includes(q)) : l

  const linhasC = useMemo(() => filtrar(d.classico), [d.classico, q])
  const linhasP = useMemo(() => filtrar(d.posicao), [d.posicao, q])

  const naveTabs = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    trocarAba(aba === 'classico' ? 'posicao' : 'classico')
    const alvo = tabs.current?.querySelector<HTMLButtonElement>(
      `#tab-${aba === 'classico' ? 'posicao' : 'classico'}`,
    )
    alvo?.focus()
  }

  const meuClassico = eu ? d.classico.find((l) => l.nome === eu) : undefined
  const meuPosicao = eu ? d.posicao.find((l) => l.nome === eu) : undefined
  const atualizado = new Date(d.atualizadoEm).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max)',
            margin: '0 auto',
            padding: '12px var(--gutter) 0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(18px,4.6vw,26px)',
                fontWeight: 800,
                letterSpacing: '-.025em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              Bolão do Max
            </h1>
            <p
              style={{
                margin: '3px 0 0',
                fontSize: 'clamp(11.5px,2.8vw,13px)',
                color: 'var(--ink-2)',
                lineHeight: 1.3,
              }}
            >
              Brasileirão {d.temporada}
              {d.rodada ? ` · ${d.rodada}ª rodada` : ''} · atualizado {atualizado}
            </p>
          </div>
          <button
            type="button"
            aria-label="Abrir menu"
            aria-haspopup="dialog"
            onClick={() => setMenu(true)}
            style={{
              flex: 'none',
              width: 44,
              height: 44,
              marginTop: -4,
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--surf)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{ display: 'block', width: 18, height: 2, background: 'var(--ink)', borderRadius: 2 }}
              />
            ))}
          </button>
        </div>

        <div
          ref={tabs}
          role="tablist"
          aria-label="Bolões"
          onKeyDown={naveTabs}
          style={{
            maxWidth: 'var(--max)',
            margin: '0 auto',
            padding: '10px var(--gutter) 0',
            display: 'flex',
            gap: 6,
          }}
        >
          {(
            [
              { id: 'classico' as const, titulo: 'Clássico', sub: 'soma dos 4 clubes' },
              { id: 'posicao' as const, titulo: 'Por Posição', sub: 'G4 e Z4' },
            ] satisfies { id: Aba; titulo: string; sub: string }[]
          ).map((t) => {
            const sel = aba === t.id
            return (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={sel}
                aria-controls={`painel-${t.id}`}
                tabIndex={sel ? 0 : -1}
                onClick={() => trocarAba(t.id)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: '9px 12px 11px',
                  borderRadius: '12px 12px 0 0',
                  border: '1px solid var(--line)',
                  borderBottom: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  background: sel ? 'var(--surf)' : 'transparent',
                  color: sel ? 'var(--ink)' : 'var(--ink-2)',
                }}
              >
                <span style={{ fontSize: 'clamp(13px,3.4vw,15px)', fontWeight: sel ? 700 : 500 }}>
                  {t.titulo}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.2 }}>{t.sub}</span>
              </button>
            )
          })}
        </div>
      </header>

      <main style={{ maxWidth: 'var(--max)', margin: '0 auto', padding: '0 0 60px' }}>
        {(meuClassico || meuPosicao) && (
          <div style={{ padding: '12px var(--gutter) 0' }}>
            <button
              type="button"
              onClick={() => setDetalhe({ nome: eu!, tipo: aba })}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 14px',
                border: '1px solid var(--accent)',
                borderRadius: 14,
                background: 'var(--accent-soft)',
              }}
            >
              <span
                style={{ flex: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: 'var(--accent)' }}
              >
                VOCÊ
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700 }}>{eu}</span>
              <span className="mono" style={{ flex: 'none', fontSize: 12.5, color: 'var(--ink-2)' }}>
                {aba === 'classico'
                  ? `${ord(meuClassico?.posicao ?? 0)} · ${meuClassico?.pontos ?? 0} pts`
                  : `${ord(meuPosicao?.posicao ?? 0)} · ${meuPosicao?.pontos ?? 0} pts`}
              </span>
            </button>
          </div>
        )}

        <div style={{ padding: '12px var(--gutter) 0' }}>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome"
            aria-label="Buscar competidor pelo nome"
            style={{
              width: '100%',
              minHeight: 44,
              padding: '10px 14px',
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--surf)',
              fontSize: 15,
            }}
          />
        </div>

        <section
          role="tabpanel"
          id="painel-classico"
          aria-labelledby="tab-classico"
          tabIndex={0}
          hidden={aba !== 'classico'}
        >
          <Cabecalho colunas="var(--cols-c)" itens={['Pos', 'Nome', 'Pts', 'SG', 'Prêmio', 'GP1', 'GP2', 'GP3', 'GP4']} />
          <Lista vazio={linhasC.length === 0}>
            {linhasC.map((l) => (
              <LinhaC
                key={l.nome}
                l={l}
                eu={eu === l.nome}
                mov={d.movimento[l.nome]?.classico ?? null}
                onAbrir={() => setDetalhe({ nome: l.nome, tipo: 'classico' })}
              />
            ))}
          </Lista>
        </section>

        <section
          role="tabpanel"
          id="painel-posicao"
          aria-labelledby="tab-posicao"
          tabIndex={0}
          hidden={aba !== 'posicao'}
        >
          <Cabecalho colunas="var(--cols-p)" itens={['Pos', 'Nome', 'Pts', 'Acertos', 'Prêmio']} />
          <Lista vazio={linhasP.length === 0}>
            {linhasP.map((l) => (
              <LinhaP
                key={l.nome}
                l={l}
                eu={eu === l.nome}
                mov={d.movimento[l.nome]?.posicao ?? null}
                onAbrir={() => setDetalhe({ nome: l.nome, tipo: 'posicao' })}
              />
            ))}
          </Lista>
          <p style={{ padding: '14px var(--gutter)', fontSize: 12.5, color: 'var(--ink-3)', margin: 0 }}>
            ✅ posição exata · 4 pontos &nbsp;·&nbsp; 👍 acertou o G4 ou Z4 · 1 ponto
          </p>
        </section>
      </main>

      {menu && (
        <Sheet titulo="Menu" onFechar={() => setMenu(false)}>
          <Bloco titulo="Tema">
            <div style={{ display: 'flex', gap: 8 }}>
              {TEMAS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => trocarTema(t.id)}
                  aria-pressed={tema === t.id}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 12,
                    border: `1px solid ${tema === t.id ? 'var(--accent)' : 'var(--line)'}`,
                    background: tema === t.id ? 'var(--accent)' : 'var(--surf)',
                    color: tema === t.id ? 'var(--on-accent)' : 'var(--ink)',
                    textAlign: 'center',
                    fontWeight: tema === t.id ? 700 : 500,
                    padding: '0 8px',
                  }}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>
          </Bloco>

          <Bloco titulo="Quem é você">
            <select
              value={eu ?? ''}
              onChange={(e) => definirEu(e.target.value || null)}
              style={{
                width: '100%',
                minHeight: 44,
                padding: '0 12px',
                borderRadius: 12,
                border: '1px solid var(--line)',
                background: 'var(--surf)',
              }}
            >
              <option value="">— ninguém —</option>
              {d.classico.map((l) => (
                <option key={l.nome} value={l.nome}>
                  {l.nome}
                </option>
              ))}
            </select>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-3)' }}>
              Fica destacado no topo e com borda na sua linha. Guardado só neste navegador.
            </p>
          </Bloco>

          <Bloco titulo="Sobre o dado">
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
              Atualizado em {atualizado}.<br />
              Fontes conferidas: {d.fontes.join(', ')}.<br />
              Leitura via {d.origemLeitura}.
            </p>
          </Bloco>

          <button
            type="button"
            onClick={() => {
              setMenu(false)
              setRegras(true)
            }}
            style={{
              width: '100%',
              minHeight: 44,
              borderRadius: 12,
              border: '1px solid var(--line)',
              background: 'var(--surf)',
              padding: '0 14px',
              fontWeight: 600,
            }}
          >
            Ver as regras
          </button>
        </Sheet>
      )}

      {regras && <Regras temporada={d.temporada} onFechar={() => setRegras(false)} />}

      {detalhe && <Detalhe detalhe={detalhe} onFechar={() => setDetalhe(null)} />}
    </div>
  )
}

// ── peças ────────────────────────────────────────────────────

function Cabecalho({ colunas, itens }: { colunas: string; itens: string[] }) {
  return (
    <div
      style={{
        display: 'var(--dt)',
        padding: '16px var(--gutter) 6px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.09em',
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: colunas,
          gap: 8,
          width: '100%',
          alignItems: 'end',
          padding: '0 13px',
        }}
      >
        {itens.map((t, i) => (
          <span key={t} style={{ textAlign: i === 0 ? 'center' : undefined }}>
            {t}
          </span>
        ))}
      </span>
    </div>
  )
}

function Lista({ children, vazio }: { children: React.ReactNode; vazio: boolean }) {
  if (vazio)
    return (
      <p style={{ padding: '28px var(--gutter)', color: 'var(--ink-3)', fontSize: 14 }}>
        Nenhum competidor com esse nome.
      </p>
    )
  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '8px var(--gutter) 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {children}
    </ol>
  )
}

function Seta({ mov }: { mov: number | null }) {
  if (mov === null || mov === 0) return null
  return (
    <span
      className="mono"
      title="Movimento nas últimas 24 horas"
      style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: mov > 0 ? 'var(--ok)' : 'var(--neg)' }}
    >
      {mov > 0 ? `▲${mov}` : `▼${-mov}`}
    </span>
  )
}

function botaoLinha(eu: boolean, colunas: string): React.CSSProperties {
  return {
    width: '100%',
    minHeight: 'var(--row-min)',
    display: 'grid',
    gridTemplateColumns: colunas,
    gap: 8,
    alignItems: 'center',
    padding: '8px 12px',
    border: '1px solid var(--line-soft)',
    borderRadius: 14,
    background: 'var(--surf)',
    boxShadow: eu ? 'inset 0 0 0 2px var(--accent)' : 'none',
  }
}

function LinhaC({
  l,
  eu,
  mov,
  onAbrir,
}: {
  l: ResumoClassico
  eu: boolean
  mov: number | null
  onAbrir: () => void
}) {
  const podio = l.posicao <= 3
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${l.nome}, ${ord(l.posicao)} lugar, ${l.pontos} pontos. Ver detalhamento.`}
        style={botaoLinha(eu, 'var(--cols-c)')}
      >
        <span
          className="mono"
          style={{
            fontSize: podio ? 17 : 14,
            fontWeight: 600,
            color: podio ? 'var(--accent)' : 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          {l.posicao}
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 'var(--fs-nome)',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {l.nome}
            </span>
            {l.premioCentavos > 0 && (
              <span
                style={{
                  flex: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 5,
                  background: podio ? 'var(--accent)' : 'transparent',
                  color: podio ? 'var(--on-accent)' : 'var(--ink-2)',
                  border: `1px solid ${podio ? 'var(--accent)' : 'var(--line)'}`,
                }}
              >
                {podio ? brl(l.premioCentavos / 100).replace(',00', '') : 'LANTERNA'}
              </span>
            )}
            <Seta mov={mov} />
          </span>
          <span
            style={{
              display: 'var(--mb)',
              fontSize: 12,
              color: 'var(--ink-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {l.clubes.map((c) => `${c.clube}${c.coracao ? ' ❤️' : ''}`).join(' · ')}
          </span>
        </span>
        <span
          style={{ display: 'var(--mb)', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.05 }}
        >
          <span className="mono" style={{ fontSize: 19, fontWeight: 600 }}>
            {l.pontos}
          </span>
          <span
            className="mono"
            style={{ fontSize: 11.5, color: l.saldoGols < 0 ? 'var(--neg)' : 'var(--ink-2)' }}
          >
            {sinal(l.saldoGols)}
          </span>
        </span>
        <span className="mono" style={{ display: 'var(--dt)', justifyContent: 'flex-end', fontSize: 16, fontWeight: 600 }}>
          {l.pontos}
        </span>
        <span
          className="mono"
          style={{
            display: 'var(--dt)',
            justifyContent: 'flex-end',
            fontSize: 13,
            color: l.saldoGols < 0 ? 'var(--neg)' : 'var(--ink-2)',
          }}
        >
          {sinal(l.saldoGols)}
        </span>
        <span
          className="mono"
          style={{ display: 'var(--dt)', fontSize: 12.5, color: l.premioCentavos ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          {l.premioCentavos ? brl(l.premioCentavos / 100) : '—'}
        </span>
        {l.clubes.map((c) => (
          <span
            key={c.clube}
            style={{
              display: 'var(--dt)',
              fontSize: 12.5,
              color: 'var(--ink-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.clube}
            {c.coracao ? ' ❤️' : ''}
          </span>
        ))}
      </button>
    </li>
  )
}

function LinhaP({
  l,
  eu,
  mov,
  onAbrir,
}: {
  l: ResumoPosicao
  eu: boolean
  mov: number | null
  onAbrir: () => void
}) {
  const podio = l.posicao <= 3
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${l.nome}, ${ord(l.posicao)} lugar, ${l.pontos} pontos. Ver palpites.`}
        style={botaoLinha(eu, 'var(--cols-p)')}
      >
        <span
          className="mono"
          style={{
            fontSize: podio ? 17 : 14,
            fontWeight: 600,
            color: podio ? 'var(--accent)' : 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          {l.posicao}
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: 'var(--fs-nome)',
                fontWeight: 600,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {l.nome}
            </span>
            {l.premioCentavos > 0 && (
              <span
                style={{
                  flex: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 5,
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                }}
              >
                {brl(l.premioCentavos / 100).replace(',00', '')}
              </span>
            )}
            <Seta mov={mov} />
          </span>
          <span style={{ display: 'var(--mb)', fontSize: 12, color: 'var(--ink-3)' }}>
            {l.acertosFaixa} na faixa · {l.acertosG4} no G4 · {l.acertosZ4} no Z4
          </span>
        </span>
        <span style={{ display: 'var(--mb)', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span className="mono" style={{ fontSize: 19, fontWeight: 600 }}>
            {l.pontos}
          </span>
        </span>
        <span className="mono" style={{ display: 'var(--dt)', justifyContent: 'flex-end', fontSize: 16, fontWeight: 600 }}>
          {l.pontos}
        </span>
        <span className="mono" style={{ display: 'var(--dt)', fontSize: 12.5, color: 'var(--ink-2)' }}>
          {l.acertosFaixa} faixa · {l.acertosG4}/{l.acertosZ4}
        </span>
        <span
          className="mono"
          style={{ display: 'var(--dt)', fontSize: 12.5, color: l.premioCentavos ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          {l.premioCentavos ? brl(l.premioCentavos / 100) : '—'}
        </span>
      </button>
    </li>
  )
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3
        style={{
          margin: '0 0 8px',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--ink-3)',
        }}
      >
        {titulo}
      </h3>
      {children}
    </div>
  )
}

function Detalhe({
  detalhe,
  onFechar,
}: {
  detalhe: { nome: string; tipo: Aba }
  onFechar: () => void
}) {
  const [dados, setDados] = useState<{ classico?: LinhaClassico; posicao?: LinhaPosicao } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(null)
    fetch(`/api/competidor?nome=${encodeURIComponent(detalhe.nome)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => vivo && setDados(j))
      .catch((e) => vivo && setErro(String(e.message ?? e)))
    return () => {
      vivo = false
    }
  }, [detalhe.nome])

  const c = dados?.classico
  const p = dados?.posicao

  return (
    <Sheet titulo={detalhe.nome} onFechar={onFechar}>
      {erro && (
        <p style={{ color: 'var(--neg)', fontSize: 14 }}>
          Não consegui carregar o detalhamento: {erro}
        </p>
      )}
      {!dados && !erro && (
        <p style={{ color: 'var(--ink-3)', fontSize: 14 }}>Carregando…</p>
      )}

      {detalhe.tipo === 'classico' && c && (
        <>
          <p className="mono" style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-2)' }}>
            {ord(c.posicao)} lugar · {c.pontos} pontos · saldo {sinal(c.saldoGols)} ·{' '}
            {c.premioCentavos ? brl(c.premioCentavos / 100) : 'sem prêmio'}
          </p>
          {c.clubes.map((clube) => (
            <div
              key={clube.grupo}
              style={{
                border: '1px solid var(--line-soft)',
                borderRadius: 12,
                padding: '10px 12px',
                marginBottom: 8,
                background: 'var(--surf-2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <strong style={{ fontSize: 15 }}>
                  {clube.clube}
                  {clube.coracao ? ' \u2764\ufe0f' : ''}
                </strong>
                <span className="mono" style={{ fontSize: 17, fontWeight: 600 }}>
                  {clube.pontos}
                </span>
              </div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 4 }}>
                {clube.jogos}J · {clube.vitorias}V {clube.empates}E {clube.derrotas}D ·{' '}
                {clube.golsPro}\u2013{clube.golsContra} (saldo {sinal(clube.saldoGols)})
                {clube.aproveitamento != null ? ` · ${clube.aproveitamento}%` : ''}
              </div>
            </div>
          ))}
        </>
      )}

      {detalhe.tipo === 'posicao' && p && (
        <>
          <p className="mono" style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-2)' }}>
            {ord(p.posicao)} lugar · {p.pontos} pontos · {p.acertosFaixa} acertos de faixa ·{' '}
            {p.premioCentavos ? brl(p.premioCentavos / 100) : 'sem prêmio'}
          </p>
          {p.palpites.map((pl) => {
            const marca = pl.acertoPosicao ? '\u2705' : pl.acertoG4 || pl.acertoZ4 ? '\ud83d\udc4d' : ''
            const distancia = pl.posicaoAtual != null ? pl.posicaoAtual - pl.posicao : null
            return (
              <div
                key={`${pl.clube}-${pl.posicao}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '38px 1fr auto auto',
                  gap: 10,
                  alignItems: 'center',
                  padding: '9px 12px',
                  marginBottom: 6,
                  border: '1px solid var(--line-soft)',
                  borderRadius: 12,
                  background: pl.pontos ? 'var(--accent-soft)' : 'var(--surf-2)',
                }}
              >
                <span className="mono" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {ord(pl.posicao)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{pl.clube}</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                  {pl.posicaoAtual != null ? `hoje ${ord(pl.posicaoAtual)}` : '\u2014'}
                  {distancia ? ` (${sinal(distancia)})` : ''}
                </span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, minWidth: 34, textAlign: 'right' }}>
                  {marca} {pl.pontos}
                </span>
              </div>
            )
          })}
        </>
      )}
    </Sheet>
  )
}

function Regras({ temporada, onFechar }: { temporada: number; onFechar: () => void }) {
  return (
    <Sheet titulo={`Regras ${temporada}`} onFechar={onFechar}>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-2)' }}>
        <p style={{ marginTop: 0 }}>
          A aposta custa <strong>R$ 155,00</strong> e vale para dois bolões.
        </p>
        <Bloco titulo="Bolão Clássico">
          <p style={{ margin: 0 }}>
            Você concorre com a soma dos pontos dos quatro clubes do seu conjunto. O desempate é por
            saldo de gols, depois gols pró, gols contra e nome.
            <br />
            1º R$ 2.000,00 · 2º R$ 650,00 · 3º R$ 350,00 · último R$ 120,00
          </p>
        </Bloco>
        <Bloco titulo="Bolão por Posição">
          <p style={{ margin: 0 }}>
            Você crava os quatro primeiros (G4) e os quatro últimos (Z4), com posição.
            <br />
            Clube na faixa certa: <strong>1 ponto</strong> (👍). Posição exata:{' '}
            <strong>4 pontos</strong> (✅).
            <br />
            1º lugar leva R$ 1.000,00, dividido em caso de empate.
          </p>
        </Bloco>
        <Bloco titulo="Mega da Virada">
          <p style={{ margin: 0 }}>
            Com os R$ 530,00 restantes sai a aposta de 9 dezenas na Mega Sena da Virada.
          </p>
        </Bloco>
      </div>
    </Sheet>
  )
}
