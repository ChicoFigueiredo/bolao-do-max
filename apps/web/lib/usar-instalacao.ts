'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  devePerguntar,
  plataformaDeInstalacao,
  type Decisao,
  type EstadoInstalacao,
  type Plataforma,
} from './instalacao'

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
 * Todo o estado de instalação, num lugar só.
 *
 * Mora aqui, e não dentro do banner, por causa do menu: o convite do navegador
 * chega uma vez e é de uso único, então quem o guarda tem que ser alguém que
 * escuta sempre — inclusive para quem já disse "não perguntar mais", que
 * continua podendo instalar pelo menu quando mudar de ideia. Se a escuta
 * dependesse de o banner querer aparecer, o item do menu ficaria sem nada para
 * disparar justamente para quem mais precisa dele.
 */
export function usarInstalacao() {
  const [convite, setConvite] = useState<EventoDeInstalacao | null>(null)
  const [plataforma, setPlataforma] = useState<Plataforma>('padrao')
  const [instalado, setInstalado] = useState(false)
  const [visivel, setVisivel] = useState(false)

  useEffect(() => {
    if (abertoComoApp()) {
      setInstalado(true)
      return
    }

    const p = plataformaDeInstalacao(navigator.userAgent, navigator.maxTouchPoints)
    setPlataforma(p)

    const estado: EstadoInstalacao = {
      entradas: contarEntrada(),
      decisao: (ler(CHAVE_DECISAO) as Decisao | null) ?? null,
      decididoEm: Number(ler(CHAVE_QUANDO)) || null,
      jaInstalado: false,
    }
    const sugerir = devePerguntar(estado, Date.now())

    // No iOS não há evento nenhum para esperar: o Safari não deixa instalar por
    // código, o convite é só instrução, e por isso já está disponível.
    if (p === 'ios') {
      if (sugerir) setVisivel(true)
      return
    }

    const aoPoderInstalar = (e: Event) => {
      // Segura o banner nativo do Chrome para oferecer no nosso tempo e com a
      // nossa cara — é para isso que o evento existe.
      e.preventDefault()
      setConvite(e as EventoDeInstalacao)
      if (sugerir) setVisivel(true)
    }
    const aoInstalar = () => {
      gravar(CHAVE_DECISAO, 'instalada')
      gravar(CHAVE_QUANDO, String(Date.now()))
      setInstalado(true)
      setVisivel(false)
    }

    window.addEventListener('beforeinstallprompt', aoPoderInstalar)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', aoPoderInstalar)
      window.removeEventListener('appinstalled', aoInstalar)
    }
  }, [])

  const decidir = useCallback((d: Decisao) => {
    gravar(CHAVE_DECISAO, d)
    gravar(CHAVE_QUANDO, String(Date.now()))
    setVisivel(false)
  }, [])

  const instalar = useCallback(async () => {
    if (!convite) return
    await convite.prompt()
    const { outcome } = await convite.userChoice
    // O convite é de uso único: depois de disparado o objeto morre, e um novo
    // só chega se o navegador emitir o evento outra vez — o que ele evita fazer
    // por um bom tempo depois de uma recusa.
    setConvite(null)
    decidir(outcome === 'accepted' ? 'instalada' : 'adiada')
  }, [convite, decidir])

  /**
   * Dá para oferecer instalação nesta máquina agora.
   *
   * No iOS é sempre que não estiver instalado, porque o convite é instrução e
   * não depende de evento. No resto, só quando o navegador entregou o convite:
   * um item de menu que abre um banner com botão morto é pior que item nenhum.
   */
  const disponivel = !instalado && (plataforma === 'ios' || convite !== null)

  return {
    plataforma,
    disponivel,
    visivel,
    /** Abrir por vontade da pessoa, pelo menu, ignorando a cadência. */
    abrir: useCallback(() => setVisivel(true), []),
    instalar,
    adiar: useCallback(() => decidir('adiada'), [decidir]),
    recusar: useCallback(() => decidir('recusada'), [decidir]),
  }
}

export type Instalacao = ReturnType<typeof usarInstalacao>
