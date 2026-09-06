'use client'

import { useState } from 'react'
import type { Instalacao } from '../lib/usar-instalacao'

/**
 * Convite para instalar o bolão como app.
 *
 * Aparece sozinho a partir da segunda entrada, some por 15 dias a cada "agora
 * não" e some para sempre num "não perguntar mais" — mas o menu pode reabri-lo
 * a qualquer momento, que é a saída de quem mudou de ideia. No Android dispara
 * o diálogo nativo; no iPhone, que não deixa instalar por código, ensina o
 * caminho.
 *
 * Não guarda estado de instalação: quem guarda é `usarInstalacao`, no Painel,
 * porque o menu precisa do mesmo convite e ele é de uso único.
 */
export function Instalar({ inst, suspenso }: { inst: Instalacao; suspenso: boolean }) {
  const [ensinando, setEnsinando] = useState(false)

  // `suspenso` cala o convite enquanto o diálogo de identificação está na tela.
  if (!inst.visivel || suspenso) return null

  const noIOS = inst.plataforma === 'ios'

  return (
    <div
      role="dialog"
      aria-label="Instalar o bolão como aplicativo"
      style={{
        position: 'fixed',
        left: 'var(--gutter)',
        right: 'var(--gutter)',
        bottom: 'calc(var(--gutter) + env(safe-area-inset-bottom))',
        // Acima do cabeçalho grudado (30) e abaixo de qualquer diálogo (50+):
        // convite é convite, não pode passar na frente de quem já abriu algo.
        zIndex: 45,
        maxWidth: 520,
        margin: '0 auto',
        padding: '14px 16px',
        border: '1px solid var(--accent)',
        borderRadius: 16,
        background: 'var(--surf)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img
          src="/icone-192.png"
          alt=""
          width={40}
          height={40}
          style={{ flex: 'none', borderRadius: 10 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>
            Deixar o bolão na tela inicial
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.35 }}>
            Vira um ícone e abre direto, sem a barra do navegador.
          </p>
        </div>
      </div>

      {ensinando && noIOS && (
        <ol
          style={{
            margin: '12px 0 0',
            padding: '12px 14px 12px 30px',
            border: '1px solid var(--line-soft)',
            borderRadius: 12,
            background: 'var(--surf-2)',
            fontSize: 13,
            color: 'var(--ink-2)',
            lineHeight: 1.6,
          }}
        >
          <li>
            Toque em <strong>Compartilhar</strong> na barra do Safari
          </li>
          <li>
            Escolha <strong>Adicionar à Tela de Início</strong>
          </li>
          <li>
            Confirme em <strong>Adicionar</strong>
          </li>
        </ol>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <button
          type="button"
          onClick={noIOS ? () => setEnsinando(true) : inst.instalar}
          style={{
            flex: 1,
            minHeight: 44,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            fontSize: 14.5,
            fontWeight: 700,
          }}
        >
          {noIOS ? 'Como instalar' : 'Instalar'}
        </button>
        <button
          type="button"
          onClick={inst.adiar}
          style={{
            flex: 'none',
            minHeight: 44,
            padding: '10px 14px',
            border: '1px solid var(--line)',
            borderRadius: 12,
            background: 'transparent',
            color: 'var(--ink-2)',
            fontSize: 14.5,
            fontWeight: 600,
          }}
        >
          Agora não
        </button>
      </div>

      <button
        type="button"
        onClick={inst.recusar}
        style={{
          display: 'block',
          margin: '10px auto 0',
          padding: 4,
          background: 'transparent',
          color: 'var(--ink-3)',
          fontSize: 12,
          textDecoration: 'underline',
        }}
      >
        Não perguntar mais
      </button>
    </div>
  )
}
