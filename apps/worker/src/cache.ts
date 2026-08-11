/**
 * Escrita no Redis compartilhado.
 *
 * O cache é **derivado e descartável**: se sumir, a aplicação lê do Postgres e
 * se recompõe no ciclo seguinte. É o oposto do sistema atual, onde o Redis é
 * o único lugar em que o resultado existe.
 *
 * Todas as chaves ficam sob `REDIS_PREFIX` porque a instância é compartilhada
 * com outros projetos no mesmo servidor.
 */
import type { Configuracao } from '@bolao/config'
import type { LinhaClassico, LinhaPosicao, Tabela } from '@bolao/dominio'
import { RedisClient } from 'bun'

export type PayloadCache = {
  temporada: number
  serie: string
  atualizadoEm: string
  rodada: number | null
  tabela: Tabela
  classico: LinhaClassico[]
  posicao: LinhaPosicao[]
  fontes: string[]
  /** Idade do dado é informação de primeira classe: a interface sempre mostra. */
  origem: string
}

export class Cache {
  private cliente: RedisClient

  constructor(private readonly cfg: Configuracao) {
    this.cliente = new RedisClient(cfg.REDIS_URL)
  }

  private k(sufixo: string) {
    return `${this.cfg.REDIS_PREFIX}${sufixo}`
  }

  async publicarResultado(p: PayloadCache): Promise<void> {
    const corpo = JSON.stringify(p)
    await this.cliente.set(this.k(`resultado:${p.temporada}`), corpo)
    await this.cliente.set(this.k('resultado:corrente'), corpo)
    await this.cliente.set(this.k('atualizado_em'), p.atualizadoEm)
  }

  async lerResultado(temporada?: number): Promise<PayloadCache | null> {
    const bruto = await this.cliente.get(
      this.k(temporada ? `resultado:${temporada}` : 'resultado:corrente'),
    )
    return bruto ? (JSON.parse(bruto) as PayloadCache) : null
  }

  // ── Pré-renderização ──────────────────────────────────────
  //
  // O worker monta o detalhamento de cada competidor e as séries de cada
  // janela uma vez por ciclo. Assim tocar um nome na tela é uma leitura de
  // chave no Redis, não um cálculo — e nenhuma requisição de usuário chega ao
  // Postgres no caminho comum.

  private chaveDetalhe(temporada: number, tipo: string, nome: string) {
    return this.k(`detalhe:${temporada}:${tipo}:${nome}`)
  }

  async publicarDetalhe(temporada: number, tipo: string, nome: string, payload: unknown) {
    await this.cliente.set(this.chaveDetalhe(temporada, tipo, nome), JSON.stringify(payload))
  }

  async lerDetalhe<T>(temporada: number, tipo: string, nome: string): Promise<T | null> {
    const bruto = await this.cliente.get(this.chaveDetalhe(temporada, tipo, nome))
    return bruto ? (JSON.parse(bruto) as T) : null
  }

  private chaveEvolucao(temporada: number, bolao: string, janela: string) {
    return this.k(`evolucao:${temporada}:${bolao}:${janela}`)
  }

  async publicarEvolucao(temporada: number, bolao: string, janela: string, serie: unknown) {
    await this.cliente.set(this.chaveEvolucao(temporada, bolao, janela), JSON.stringify(serie))
  }

  async lerEvolucao<T>(temporada: number, bolao: string, janela: string): Promise<T | null> {
    const bruto = await this.cliente.get(this.chaveEvolucao(temporada, bolao, janela))
    return bruto ? (JSON.parse(bruto) as T) : null
  }

  private chaveMovimento(temporada: number) {
    return this.k(`movimento:${temporada}`)
  }

  async publicarMovimento(temporada: number, movimento: unknown) {
    await this.cliente.set(this.chaveMovimento(temporada), JSON.stringify(movimento))
  }

  async lerMovimento<T>(temporada: number): Promise<T | null> {
    const bruto = await this.cliente.get(this.chaveMovimento(temporada))
    return bruto ? (JSON.parse(bruto) as T) : null
  }

  /** Marca quando a interface foi acessada — alimenta a cadência do worker. */
  async registrarAcesso(): Promise<void> {
    await this.cliente.set(this.k('ultimo_acesso'), new Date().toISOString())
  }

  async ultimoAcesso(): Promise<Date | null> {
    const v = await this.cliente.get(this.k('ultimo_acesso'))
    return v ? new Date(v) : null
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.cliente.send('PING', [])) === 'PONG'
    } catch {
      return false
    }
  }

  close() {
    this.cliente.close()
  }
}
