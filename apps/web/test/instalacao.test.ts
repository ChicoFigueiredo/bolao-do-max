import { describe, expect, test } from 'bun:test'
import {
  ENTRADA_MINIMA,
  ESPERA_MS,
  devePerguntar,
  plataformaDeInstalacao,
  type EstadoInstalacao,
} from '../lib/instalacao.ts'

const DIA = 24 * 60 * 60 * 1000
const AGORA = 1_800_000_000_000

/** Estado de quem já voltou uma vez e nunca respondeu nada. */
const base: EstadoInstalacao = {
  entradas: ENTRADA_MINIMA,
  decisao: null,
  decididoEm: null,
  jaInstalado: false,
}

describe('quando perguntar sobre instalar', () => {
  test('na primeira entrada não pergunta — essa visita é de se identificar', () => {
    expect(devePerguntar({ ...base, entradas: 1 }, AGORA)).toBe(false)
  })

  test('na segunda entrada pergunta', () => {
    expect(devePerguntar({ ...base, entradas: 2 }, AGORA)).toBe(true)
  })

  test('quem já abre pelo app instalado nunca é perguntado', () => {
    expect(devePerguntar({ ...base, entradas: 40, jaInstalado: true }, AGORA)).toBe(false)
  })

  test('quem instalou não é perguntado de novo', () => {
    expect(devePerguntar({ ...base, decisao: 'instalada', decididoEm: AGORA - 400 * DIA }, AGORA)).toBe(
      false,
    )
  })

  test('quem disse que não quer mais não é perguntado nunca mais', () => {
    // "Agora não" volta em 15 dias; "não perguntar mais" é definitivo. Insistir
    // com quem já disse não é o que faz a pessoa desinstalar de raiva.
    expect(devePerguntar({ ...base, decisao: 'recusada', decididoEm: AGORA - 900 * DIA }, AGORA)).toBe(
      false,
    )
  })
})

describe('o adiamento de 15 dias', () => {
  test('no décimo quarto dia ainda está calado', () => {
    expect(devePerguntar({ ...base, decisao: 'adiada', decididoEm: AGORA - 14 * DIA }, AGORA)).toBe(false)
  })

  test('no décimo quinto dia volta a perguntar', () => {
    expect(devePerguntar({ ...base, decisao: 'adiada', decididoEm: AGORA - 15 * DIA }, AGORA)).toBe(true)
  })

  test('a espera é exatamente quinze dias', () => {
    expect(ESPERA_MS).toBe(15 * DIA)
    expect(devePerguntar({ ...base, decisao: 'adiada', decididoEm: AGORA - ESPERA_MS }, AGORA)).toBe(true)
    expect(devePerguntar({ ...base, decisao: 'adiada', decididoEm: AGORA - ESPERA_MS + 1 }, AGORA)).toBe(
      false,
    )
  })

  test('adiamento sem data gravada não prende para sempre', () => {
    // Storage corrompido ou meia-gravação não pode calar o convite eternamente.
    expect(devePerguntar({ ...base, decisao: 'adiada', decididoEm: null }, AGORA)).toBe(true)
  })

  test('a contagem de entradas vence o adiamento vencido', () => {
    expect(
      devePerguntar({ ...base, entradas: 1, decisao: 'adiada', decididoEm: AGORA - 90 * DIA }, AGORA),
    ).toBe(false)
  })
})

describe('plataformaDeInstalacao', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
  const IPAD_ANTIGO =
    'Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1'
  const IPAD_NOVO =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'
  const MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'

  test('iPhone e iPad antigo se anunciam no user agent', () => {
    expect(plataformaDeInstalacao(IPHONE, 5)).toBe('ios')
    expect(plataformaDeInstalacao(IPAD_ANTIGO, 5)).toBe('ios')
  })

  test('iPad moderno mente que é Mac — o toque é o que entrega', () => {
    // Desde o iPadOS 13 o Safari do iPad se apresenta como Macintosh. Só o
    // número de pontos de toque distingue de um Mac de verdade.
    expect(plataformaDeInstalacao(IPAD_NOVO, 5)).toBe('ios')
  })

  test('Mac de verdade não é iOS', () => {
    expect(plataformaDeInstalacao(MAC, 0)).toBe('padrao')
  })

  test('Android é o caminho padrão, com prompt nativo', () => {
    expect(plataformaDeInstalacao(ANDROID, 5)).toBe('padrao')
  })
})
