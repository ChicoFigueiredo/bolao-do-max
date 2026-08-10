/** Busca HTTP com timeout, retry com recuo e erros tipados. */
import { ErroDeHttp, ErroDeRede } from './porta.ts'

export type OpcoesBusca = {
  fonte: string
  timeoutMs: number
  retry: number
  headers?: Record<string, string>
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 5xx e 429 merecem nova tentativa; 4xx não — o pedido é que está errado. */
const valeTentarDeNovo = (status: number) => status >= 500 || status === 429

export async function buscarJson(url: string, o: OpcoesBusca): Promise<unknown> {
  let ultimo: unknown

  for (let tentativa = 0; tentativa <= o.retry; tentativa++) {
    if (tentativa > 0) await dormir(300 * 2 ** (tentativa - 1))

    const abortar = AbortSignal.timeout(o.timeoutMs)
    try {
      const r = await fetch(url, {
        signal: abortar,
        headers: { Accept: 'application/json', ...o.headers },
      })
      if (!r.ok) {
        const erro = new ErroDeHttp(o.fonte, url, r.status)
        if (valeTentarDeNovo(r.status) && tentativa < o.retry) {
          ultimo = erro
          continue
        }
        throw erro
      }
      return await r.json()
    } catch (e) {
      if (e instanceof ErroDeHttp) throw e
      ultimo = e
      if (tentativa === o.retry) throw new ErroDeRede(o.fonte, url, e)
    }
  }

  throw new ErroDeRede(o.fonte, url, ultimo)
}
