'use client'

import { useEffect, useRef } from 'react'

export const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
export const brlCurto = (centavos: number) => brl(centavos).replace(',00', '')
export const ord = (n: number) => `${n}º`
export const sinal = (n: number) => (n > 0 ? `+${n}` : String(n))
export const setaTxt = (d: number) => (d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '–')
export const setaCor = (d: number) =>
  d > 0 ? 'var(--ok)' : d < 0 ? 'var(--neg)' : 'var(--ink-3)'

/**
 * Converte uma série de posições em `points` de polyline num viewBox 0–100.
 *
 * A escala é fixa em 1..total para o gráfico grande — 1º no topo, último na
 * base — para que curvas de competidores diferentes sejam comparáveis. O
 * protótipo normaliza por 30 competidores; aqui o total vem do dado real.
 */
export function polilinha(serie: number[], total: number): string {
  if (serie.length < 2) return ''
  const y = (p: number) => ((p - 1) / Math.max(1, total - 1)) * 100
  return serie
    .map((p, i) => `${((i / (serie.length - 1)) * 100).toFixed(2)},${y(p).toFixed(2)}`)
    .join(' ')
}

/** Sparkline: escala local à própria série, com folga em cima e embaixo. */
export function sparkline(serie: number[]): string {
  if (serie.length < 2) return ''
  const mn = Math.min(...serie)
  const mx = Math.max(...serie)
  return serie
    .map((p, i) => {
      const x = ((i / (serie.length - 1)) * 100).toFixed(2)
      const y = mx === mn ? 50 : ((p - mn) / (mx - mn)) * 76 + 12
      return `${x},${y.toFixed(2)}`
    })
    .join(' ')
}

/** Diálogo com foco preso, Esc, clique fora e devolução de foco ao gatilho. */
export function usarDialogo(aberto: boolean, fechar: () => void) {
  const painel = useRef<HTMLDivElement>(null)
  const gatilho = useRef<Element | null>(null)

  useEffect(() => {
    if (!aberto) return
    gatilho.current = document.activeElement
    painel.current?.focus()

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar()
        return
      }
      if (e.key !== 'Tab' || !painel.current) return
      const focaveis = painel.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      const visiveis = [...focaveis].filter((el) => el.offsetParent !== null)
      if (!visiveis.length) return
      const primeiro = visiveis[0]!
      const ultimo = visiveis.at(-1)!
      if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === painel.current)) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', aoTeclar)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = overflow
      if (gatilho.current instanceof HTMLElement) gatilho.current.focus()
    }
  }, [aberto, fechar])

  return painel
}

export function BotaoFechar({ rotulo, onClick }: { rotulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={rotulo}
      onClick={onClick}
      style={{
        flex: 'none',
        width: 44,
        height: 44,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: 'var(--surf)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 19,
        color: 'var(--ink-2)',
      }}
    >
      ×
    </button>
  )
}

/** Folha que sobe no mobile e centraliza no desktop, como o protótipo. */
export function Folha({
  aria,
  onFechar,
  cabecalho,
  children,
  zIndex = 60,
}: {
  aria: string
  onFechar: () => void
  cabecalho: React.ReactNode
  children: React.ReactNode
  zIndex?: number
}) {
  const painel = usarDialogo(true, onFechar)
  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        background: 'rgba(20,14,4,.55)',
        display: 'flex',
        alignItems: 'var(--sheet-align)' as never,
        justifyContent: 'center',
        animation: 'surge .16s ease-out',
      }}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={aria}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'var(--sheet-w)',
          maxHeight: 'var(--sheet-maxh)' as never,
          borderRadius: 'var(--sheet-r)' as never,
          background: 'var(--bg)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'sobe .22s cubic-bezier(.2,.8,.3,1)',
        }}
      >
        <div
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--line)',
          }}
        >
          {cabecalho}
          <BotaoFechar rotulo="Fechar" onClick={onFechar} />
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '16px 16px 24px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export function Rotulo({ children, cor = 'var(--ink-3)' }: { children: React.ReactNode; cor?: string }) {
  return (
    <p
      style={{
        margin: '0 0 8px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '.1em',
        color: cor,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </p>
  )
}
