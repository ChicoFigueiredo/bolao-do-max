'use client'

import { useEffect, useRef } from 'react'

/**
 * Painel modal que substitui o `alert()` nativo.
 *
 * Faz o que um alert nunca fez: fecha com Esc e com toque fora, prende o foco
 * enquanto aberto, devolve o foco ao gatilho ao fechar, e é estilizável nos
 * três temas. No mobile sobe de baixo; no desktop centraliza.
 */
export function Sheet({
  titulo,
  onFechar,
  children,
}: {
  titulo: string
  onFechar: () => void
  children: React.ReactNode
}) {
  const painel = useRef<HTMLDivElement>(null)
  const gatilho = useRef<Element | null>(null)

  useEffect(() => {
    gatilho.current = document.activeElement
    painel.current?.focus()

    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFechar()
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
  }, [onFechar])

  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'var(--sheet-align)' as never,
        justifyContent: 'center',
        animation: 'surge .12s ease-out',
      }}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'var(--sheet-w)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--surf)',
          color: 'var(--ink)',
          borderRadius: 'var(--sheet-r)' as never,
          boxShadow: 'var(--shadow)',
          padding: '18px var(--gutter) calc(24px + env(safe-area-inset-bottom))',
          animation: 'sobe .18s ease-out',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: '-.02em' }}>{titulo}</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar"
            style={{
              flex: 'none',
              width: 36,
              height: 36,
              borderRadius: 10,
              border: '1px solid var(--line)',
              background: 'var(--surf-2)',
              display: 'grid',
              placeItems: 'center',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
