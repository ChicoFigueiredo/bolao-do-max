'use client'

import { useEffect, useState } from 'react'
import {
  devePerguntar,
  plataformaDeInstalacao,
  type Decisao,
  type EstadoInstalacao,
  type Plataforma,
} from '../lib/instalacao'

/**
 * O evento que o Chromium dispara quando o site cumpre os critérios de
 * instalação. Não está no lib.dom do TypeScript porque não é padrão: só os
 * navegadores Chromium o implementam.
 */
type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const CHAVE_ENTRADAS = 'bolao:entradas'
const CHAVE_DECISAO = 'bolao:instalar'
const CHAVE_QUANDO = 'bolao:instalar-em'
const CHAVE_SESSAO = 'bolao:entrada-contada'

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

function gravar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    /* navegador sem storage: o convite volta na próxima, e paciência */
  }
}

/**
 * Conta a entrada uma vez por sessão, não por recarregamento.
 *
 * "Segunda entrada" é a segunda vez que a pessoa abre o bolão, não o segundo F5
 * da mesma sessão — quem recarrega três vezes seguidas não voltou três vezes.
 * O `sessionStorage` morre com a aba, que é exatamente a fronteira que queremos.
 */
function contarEntrada(): number {
  const atual = Number(ler(CHAVE_ENTRADAS) ?? '0') || 0
  try {
    if (sessionStorage.getItem(CHAVE_SESSAO)) return atual
    sessionStorage.setItem(CHAVE_SESSAO, '1')
  } catch {
    /* sem sessionStorage, conta por carregamento mesmo */
  }
  const proximo = atual + 1
  gravar(CHAVE_ENTRADAS, String(proximo))
  return proximo
}

/** Se já estamos rodando de dentro do app instalado. */
function abertoComoApp(): boolean {
  if (typeof window === 'undefined') return false
  const emJanelaPropria = window.matchMedia?.('(display-mode: standalone)').matches ?? false
  // O Safari do iOS não implementa `display-mode` e usa esta propriedade sua.
  const noIOS = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return emJanelaPropria || noIOS
}

/**
 * Convite para instalar o bolão como app.
 *
 * Aparece a partir da segunda entrada, some por 15 dias a cada "agora não" e
 * some para sempre num "não perguntar mais". No Android dispara o diálogo
 * nativo; no iPhone, que não deixa instalar por código, ensina o caminho.
 */
export function Instalar({ suspenso }: { suspenso: boolean }) {
  const [convite, setConvite] = useState<EventoDeInstalacao | null>(null)
  const [plataforma, setPlataforma] = useState<Plataforma>('padrao')
  const [aberto, setAberto] = useState(false)
  const [ensinando, setEnsinando] = useState(false)

  useEffect(() => {
    if (abertoComoApp()) return

    const p = plataformaDeInstalacao(navigator.userAgent, navigator.maxTouchPoints)
    setPlataforma(p)

    const estado: EstadoInstalacao = {
      entradas: contarEntrada(),
      decisao: (ler(CHAVE_DECISAO) as Decisao | null) ?? null,
      decididoEm: Number(ler(CHAVE_QUANDO)) || null,
      jaInstalado: false,
    }
    if (!devePerguntar(estado, Date.now())) return

    // No iOS não há evento nenhum para esperar: o convite é só instrução, e
    // pode subir de imediato.
    if (p === 'ios') {
      setAberto(true)
      return
    }

    const aoPoderInstalar = (e: Event) => {
      // Segura o banner nativo do Chrome para oferecer no nosso tempo e com a
      // nossa cara — é para isso que o evento existe.
      e.preventDefault()
      setConvite(e as EventoDeInstalacao)
      setAberto(true)
    }
    const aoInstalar = () => {
      decidir('instalada')
      setAberto(false)
    }

    window.addEventListener('beforeinstallprompt', aoPoderInstalar)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar)
      window.removeEventListener('appinstalled', aoInstalar)
    }
  }, [])

  const decidir = (d: Decisao) => {
    gravar(CHAVE_DECISAO, d)
    gravar(CHAVE_QUANDO, String(Date.now()))
  }

  const instalar = async () => {
    if (!convite) return
    await convite.prompt()
    const { outcome } = await convite.userChoice
    // O convite é de uso único: depois de disparado o objeto morre, e um novo
    // só chega se o navegador emitir o evento outra vez — o que ele evita fazer
    // por um bom tempo depois de uma recusa.
    setConvite(null)
    decidir(outcome === 'accepted' ? 'instalada' : 'adiada')
    setAberto(false)
  }

  const adiar = () => {
    decidir('adiada')
    setAberto(false)
  }

  const recusar = () => {
    decidir('recusada')
    setAberto(false)
  }

  // `suspenso` cala o convite enquanto o diálogo de identificação está na tela.
  if (!aberto || suspenso) return null

  return (
    <div
      role="dialog"
      aria-label="Instalar o bolão como aplicativo"
      style={{
        position: 'fixed',
        left: 'var(--gutter)',
        right: 'var(--gutter)',
        bottom: 'calc(var(--gutter) + env(safe-area-inset-bottom))',
        zIndex: 40,
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

      {ensinando && plataforma === 'ios' && (
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
          onClick={plataforma === 'ios' ? () => setEnsinando(true) : instalar}
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
          {plataforma === 'ios' ? 'Como instalar' : 'Instalar'}
        </button>
        <button
          type="button"
          onClick={adiar}
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
        onClick={recusar}
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
