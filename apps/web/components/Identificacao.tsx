'use client'

import { useEffect, useRef, useState } from 'react'
import { Logo } from './Logo'
import { Rotulo } from './ui'

/**
 * Diálogo de primeira visita.
 *
 * Pede o nome para que a pessoa veja a própria linha destacada, o cartão VOCÊ
 * no topo e a própria curva em destaque na Evolução. Sem isso o app é uma
 * tabela de trinta estranhos.
 *
 * Não fecha com Esc nem com clique fora, e não tem X: exige uma escolha
 * explícita. Mas oferece "sou visitante" — sem essa saída, quem não aposta
 * ficaria preso na tela, e um diálogo sem saída é defeito disfarçado de
 * requisito.
 */
export function Identificacao({
  nomes,
  onEscolher,
  onVisitante,
}: {
  nomes: string[]
  onEscolher: (nome: string) => void
  onVisitante: () => void
}) {
  const [nome, setNome] = useState('')
  const painel = useRef<HTMLDivElement>(null)
  const select = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    select.current?.focus()

    // Prende o foco dentro do diálogo, mas sem tratar Esc: aqui a saída é uma
    // decisão, não um atalho.
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (e.key !== 'Tab' || !painel.current) return
      const focaveis = [
        ...painel.current.querySelectorAll<HTMLElement>('button:not([disabled]), select'),
      ].filter((el) => el.offsetParent !== null)
      if (!focaveis.length) return
      const primeiro = focaveis[0]!
      const ultimo = focaveis.at(-1)!
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault()
        ultimo.focus()
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault()
        primeiro.focus()
      }
    }

    document.addEventListener('keydown', aoTeclar, true)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar, true)
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        background: 'rgba(20,14,4,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--gutter)',
        animation: 'surge .16s ease-out',
      }}
    >
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ident-titulo"
        aria-describedby="ident-texto"
        style={{
          width: 'min(420px, 100%)',
          maxHeight: '88vh',
          overflowY: 'auto',
          background: 'var(--bg)',
          borderRadius: 18,
          boxShadow: 'var(--shadow)',
          padding: '22px 20px 20px',
          animation: 'sobe .22s cubic-bezier(.2,.8,.3,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          {/* id próprio: o clipPath da marca do cabeçalho já ocupa o outro */}
          <Logo id="bolaMaxIdent" />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '.12em',
              color: 'var(--accent)',
              textTransform: 'uppercase',
            }}
          >
            Bolão do Max
          </span>
        </div>
        <h2
          id="ident-titulo"
          style={{
            margin: '6px 0 8px',
            fontSize: 'clamp(20px,5.4vw,25px)',
            fontWeight: 800,
            letterSpacing: '-.025em',
            lineHeight: 1.1,
          }}
        >
          Quem é você?
        </h2>
        <p
          id="ident-texto"
          style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5 }}
        >
          Escolha seu nome para ver sua posição em destaque no topo, sua linha marcada nas duas
          tabelas e sua trajetória realçada no gráfico. Fica guardado só neste navegador e pode ser
          trocado depois no menu.
        </p>

        <Rotulo>Meu nome</Rotulo>
        <select
          ref={select}
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-label="Escolher meu nome na lista de apostadores"
          style={{
            width: '100%',
            minHeight: 48,
            padding: '10px 12px',
            border: `1px solid ${nome ? 'var(--accent)' : 'var(--line)'}`,
            borderRadius: 12,
            background: 'var(--surf)',
            fontSize: 16,
          }}
        >
          <option value="">— escolha na lista —</option>
          {nomes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={!nome}
          onClick={() => nome && onEscolher(nome)}
          style={{
            width: '100%',
            minHeight: 50,
            marginTop: 14,
            borderRadius: 12,
            border: '1px solid var(--accent)',
            background: nome ? 'var(--accent)' : 'var(--surf-2)',
            color: nome ? 'var(--on-accent)' : 'var(--ink-3)',
            fontSize: 16,
            fontWeight: 700,
            textAlign: 'center',
            cursor: nome ? 'pointer' : 'not-allowed',
            borderColor: nome ? 'var(--accent)' : 'var(--line)',
          }}
        >
          {nome ? `Sou ${nome}` : 'Escolha um nome'}
        </button>

        <button
          type="button"
          onClick={onVisitante}
          style={{
            width: '100%',
            minHeight: 44,
            marginTop: 8,
            borderRadius: 12,
            background: 'transparent',
            color: 'var(--ink-3)',
            fontSize: 13.5,
            textAlign: 'center',
          }}
        >
          Não aposto, só estou olhando
        </button>
      </div>
    </div>
  )
}
