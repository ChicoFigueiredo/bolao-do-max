/**
 * A porta dos provedores de dados esportivos.
 *
 * Existe para que nenhuma fonte seja indispensável. O GE é gratuito e sem
 * cota, então carrega a alta frequência; as APIs com cota entram como
 * conferência e resgate. Trocar, adicionar ou desligar uma fonte é escrever
 * um adaptador e declarar sua cota — nada acima desta interface muda.
 */
import type { Tabela } from '@bolao/dominio'

export type Capacidade = 'classificacao' | 'partidas'

export type StatusPartidaFonte = 'agendada' | 'em_andamento' | 'encerrada' | 'adiada' | 'cancelada'

export type RefClube = {
  nome: string
  /** Id estável na fonte, quando ela oferece. O GE devolve `equipe_id`. */
  idExterno?: string
  sigla?: string
  escudoUrl?: string
}

export type PartidaFonte = {
  externoId: string | null
  rodada: number
  mandante: RefClube
  visitante: RefClube
  /** Nulo quando o jogo foi adiado sem nova data. */
  inicioPrevisto: Date | null
  /**
   * `false` quando a fonte ainda devolve horário provisório. O GE marca isso
   * omitindo `hora_realizacao` e mandando um `T12:00` de fachada na data.
   */
  inicioConfirmado: boolean
  estadio: string | null
  status: StatusPartidaFonte
  golsMandante: number | null
  golsVisitante: number | null
}

export type LinhaClassificacaoFonte = Tabela[number] & { ref: RefClube }

export interface ProvedorEsportivo {
  readonly nome: string
  readonly capacidades: readonly Capacidade[]
  /** Requisições que a operação consome da cota. 0 = fonte sem cota. */
  custo(operacao: Capacidade, temporada: number): number
  obterClassificacao?(temporada: number, serie: string): Promise<LinhaClassificacaoFonte[]>
  obterPartidas?(temporada: number, serie: string): Promise<PartidaFonte[]>
}

// ── Erros tipados ────────────────────────────────────────────
//
// O modo de falha do sistema atual é uma Promise que nunca resolve nem
// rejeita: o cache mantém o valor antigo e o timestamp congela sem aviso.
// Aqui toda falha tem tipo, mensagem e causa.

export class ErroDeProvedor extends Error {
  constructor(
    readonly fonte: string,
    mensagem: string,
    readonly causa?: unknown,
  ) {
    super(`[${fonte}] ${mensagem}`)
    this.name = 'ErroDeProvedor'
  }
}

export class ErroDeRede extends ErroDeProvedor {
  constructor(fonte: string, readonly url: string, causa?: unknown) {
    super(fonte, `falha de rede em ${url}`, causa)
    this.name = 'ErroDeRede'
  }
}

export class ErroDeHttp extends ErroDeProvedor {
  constructor(fonte: string, readonly url: string, readonly status: number) {
    super(fonte, `HTTP ${status} em ${url}`)
    this.name = 'ErroDeHttp'
  }
}

export class PayloadInvalido extends ErroDeProvedor {
  constructor(fonte: string, readonly problemas: string[]) {
    super(fonte, `payload não passou na validação:\n  ${problemas.join('\n  ')}`)
    this.name = 'PayloadInvalido'
  }
}

export class CotaEsgotada extends ErroDeProvedor {
  constructor(fonte: string, readonly janela: string) {
    super(fonte, `cota ${janela} esgotada`)
    this.name = 'CotaEsgotada'
  }
}
