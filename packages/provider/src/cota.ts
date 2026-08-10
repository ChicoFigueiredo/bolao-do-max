/**
 * Governo de free-tier.
 *
 * Toda requisição a fonte com cota passa por aqui antes de sair. O consumo
 * real fica registrado em `fonte_chamada`, então o orçamento é medido, não
 * estimado — e sobrevive a reinício do processo.
 *
 * Os tetos configurados ficam propositalmente abaixo dos limites reais
 * (60 de 100 por dia na API-Football). A margem existe para que um laço com
 * defeito não queime a cota do dia inteiro.
 */
import { CotaEsgotada } from './porta.ts'

export type Limites = { porMinuto?: number; porDia?: number }

/** O que o governante precisa saber sobre o passado. Implementado pelo banco. */
export interface RegistroDeChamadas {
  contar(fonte: string, desde: Date): Promise<number>
  registrar(r: {
    fonte: string
    operacao: string
    sucesso: boolean
    httpStatus?: number
    duracaoMs?: number
    erro?: string
  }): Promise<void>
}

/** Registro em memória — para testes e para o modo sem banco. */
export class RegistroEmMemoria implements RegistroDeChamadas {
  private chamadas: { fonte: string; em: Date }[] = []

  async contar(fonte: string, desde: Date) {
    return this.chamadas.filter((c) => c.fonte === fonte && c.em >= desde).length
  }

  async registrar(r: { fonte: string }) {
    this.chamadas.push({ fonte: r.fonte, em: new Date() })
  }
}

export class GovernanteDeCota {
  constructor(
    private readonly registro: RegistroDeChamadas,
    private readonly limites: Record<string, Limites>,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /** Quantas requisições ainda cabem na janela mais apertada. */
  async saldo(fonte: string): Promise<{ minuto: number | null; dia: number | null }> {
    const l = this.limites[fonte]
    if (!l) return { minuto: null, dia: null }
    const t = this.agora()
    const minuto =
      l.porMinuto == null
        ? null
        : l.porMinuto - (await this.registro.contar(fonte, new Date(t.getTime() - 60_000)))
    const dia =
      l.porDia == null
        ? null
        : l.porDia - (await this.registro.contar(fonte, new Date(t.getTime() - 86_400_000)))
    return { minuto, dia }
  }

  /** Lança `CotaEsgotada` se a chamada não couber no orçamento. */
  async exigirFolga(fonte: string, custo = 1): Promise<void> {
    const l = this.limites[fonte]
    if (!l) return
    const s = await this.saldo(fonte)
    if (s.dia != null && s.dia < custo) throw new CotaEsgotada(fonte, 'diária')
    if (s.minuto != null && s.minuto < custo) throw new CotaEsgotada(fonte, 'por minuto')
  }

  /** Envolve a operação: verifica a cota antes, registra o consumo depois. */
  async medir<T>(fonte: string, operacao: string, custo: number, fn: () => Promise<T>): Promise<T> {
    if (custo > 0) await this.exigirFolga(fonte, custo)
    const t0 = performance.now()
    try {
      const r = await fn()
      await this.registro.registrar({
        fonte,
        operacao,
        sucesso: true,
        duracaoMs: Math.round(performance.now() - t0),
      })
      return r
    } catch (e) {
      await this.registro.registrar({
        fonte,
        operacao,
        sucesso: false,
        duracaoMs: Math.round(performance.now() - t0),
        erro: e instanceof Error ? e.message : String(e),
      })
      throw e
    }
  }
}
