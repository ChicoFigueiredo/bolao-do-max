'use client'

import type * as React from 'react'
import { useCallback, useRef } from 'react'
import { sentidoDoArrasto } from './gesto-lateral'
import type { Sentido } from './navegacao-abas'

/**
 * Por quanto tempo, depois de um gesto, um clique ainda é resquício dele.
 *
 * O toque que virou gesto também vira clique no fim, e sem isso o arrasto que
 * começa e termina em cima de uma linha da tabela abriria o detalhe do
 * competidor ao mesmo tempo em que troca de aba. É uma janela, e não uma
 * bandeira ligada até o próximo clique, porque a bandeira ficaria armada depois
 * de um gesto que não gerasse clique nenhum e engoliria um Enter no teclado
 * meia hora depois.
 */
const JANELA_DO_CLIQUE = 700

/**
 * Reconhece o arrasto lateral e devolve como vestir um elemento com ele.
 *
 * Só toque e caneta: no desktop o mesmo gesto é arrastar o mouse, que é como se
 * marca um trecho da tabela para copiar. Lá as setas do teclado e o clique na
 * aba já resolvem, e sequestrar o arrasto do mouse tiraria mais do que daria.
 */
export function usarArrastoLateral(aoArrastar: (s: Sentido) => void) {
  const inicio = useRef<{ x: number; y: number; t: number; id: number } | null>(null)
  const engolirCliqueAte = useRef(0)

  const aoDescer = useCallback((e: React.PointerEvent<HTMLElement>) => {
    engolirCliqueAte.current = 0
    inicio.current = null
    if (e.pointerType === 'mouse') return
    inicio.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId }
  }, [])

  const aoSubir = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const i = inicio.current
      inicio.current = null
      if (!i || i.id !== e.pointerId) return

      const s = sentidoDoArrasto({ dx: e.clientX - i.x, dy: e.clientY - i.y, ms: Date.now() - i.t })
      if (!s) return

      engolirCliqueAte.current = Date.now() + JANELA_DO_CLIQUE
      aoArrastar(s)
    },
    [aoArrastar],
  )

  // O navegador cancela o ponteiro quando decide que aquilo era rolagem.
  const aoCancelar = useCallback(() => {
    inicio.current = null
  }, [])

  const aoClicarNaCaptura = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (Date.now() > engolirCliqueAte.current) return
    engolirCliqueAte.current = 0
    e.preventDefault()
    e.stopPropagation()
  }, [])

  /**
   * As propriedades para espalhar no elemento que escuta o gesto, já com o
   * estilo dele misturado.
   *
   * O `touch-action` vem daqui, e não de quem chama, porque esquecê-lo mata o
   * gesto sem erro nenhum: o navegador assume o toque como rolagem e manda um
   * `pointercancel` no meio do caminho. Deixar isso a cargo do chamador era uma
   * armadilha esperando a terceira chamada.
   */
  return useCallback(
    (estilo?: React.CSSProperties) => ({
      onPointerDown: aoDescer,
      onPointerUp: aoSubir,
      onPointerCancel: aoCancelar,
      onClickCapture: aoClicarNaCaptura,
      style: { ...estilo, touchAction: 'pan-y pinch-zoom' },
    }),
    [aoDescer, aoSubir, aoCancelar, aoClicarNaCaptura],
  )
}
