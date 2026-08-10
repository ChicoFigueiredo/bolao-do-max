/**
 * Resolve o que cada fonte chama de cada clube.
 *
 * O sistema atual casa por string exata (`t.Clube === posicaoAtual.nome`).
 * Quando a fonte renomeia um time, os pontos daquele clube viram zero sem
 * nenhum aviso. Aqui a resolução é em cascata e o resultado é memorizado:
 *
 *   1. id externo da fonte  — estável, é o caminho bom
 *   2. nome já conhecido daquela fonte
 *   3. nome canônico do clube
 *   4. nome normalizado (sem acento, sem caixa) entre os canônicos
 *   5. cria o clube e registra os apelidos
 *
 * Achando por nome, grava o apelido por id externo — da próxima vez cai no
 * passo 1 e nunca mais depende de string.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import type { Banco } from '../index.ts'
import { clube, clubeAlias } from '../schema.ts'

export type RefClubeFonte = {
  nome: string
  idExterno?: string
  sigla?: string
  escudoUrl?: string
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

export class ResolvedorDeClubes {
  private porId = new Map<string, number>()
  private porNome = new Map<string, number>()
  private canonicos: { id: number; nome: string }[] = []
  private carregado = false

  readonly criados: string[] = []
  readonly apelidosNovos: string[] = []

  constructor(
    private readonly db: Banco,
    private readonly fonte: string,
  ) {}

  private async carregar() {
    if (this.carregado) return
    this.canonicos = await this.db.select({ id: clube.id, nome: clube.nome }).from(clube)
    const aliases = await this.db
      .select()
      .from(clubeAlias)
      .where(eq(clubeAlias.fonte, this.fonte))
    for (const a of aliases) {
      if (a.tipo === 'id_externo') this.porId.set(a.chave, a.clubeId)
      else this.porNome.set(normalizar(a.chave), a.clubeId)
    }
    this.carregado = true
  }

  async resolver(ref: RefClubeFonte, temporadaAno?: number): Promise<number> {
    await this.carregar()

    if (ref.idExterno) {
      const achado = this.porId.get(ref.idExterno)
      if (achado) return achado
    }

    const chaveNome = normalizar(ref.nome)
    let id = this.porNome.get(chaveNome)

    if (!id) {
      const exato = this.canonicos.find((c) => c.nome === ref.nome)
      id = exato?.id
    }
    if (!id) {
      const aproximado = this.canonicos.find((c) => normalizar(c.nome) === chaveNome)
      id = aproximado?.id
    }

    if (!id) {
      const [novo] = await this.db
        .insert(clube)
        .values({ nome: ref.nome, sigla: ref.sigla ?? null, escudoUrl: ref.escudoUrl ?? null })
        .onConflictDoUpdate({
          target: clube.nome,
          set: { sigla: sql`coalesce(excluded.sigla, ${clube.sigla})` },
        })
        .returning({ id: clube.id })
      id = novo!.id
      this.canonicos.push({ id, nome: ref.nome })
      this.criados.push(ref.nome)
    } else if (ref.sigla || ref.escudoUrl) {
      // Enriquece o canônico com o que a fonte trouxe, sem sobrescrever.
      await this.db
        .update(clube)
        .set({
          sigla: sql`coalesce(${clube.sigla}, ${ref.sigla ?? null})`,
          escudoUrl: sql`coalesce(${clube.escudoUrl}, ${ref.escudoUrl ?? null})`,
        })
        .where(and(eq(clube.id, id), or(isNull(clube.sigla), isNull(clube.escudoUrl))))
    }

    const novos: (typeof clubeAlias.$inferInsert)[] = []
    if (ref.idExterno && !this.porId.has(ref.idExterno)) {
      novos.push({
        clubeId: id,
        fonte: this.fonte,
        tipo: 'id_externo',
        chave: ref.idExterno,
        temporadaAno: null,
      })
      this.porId.set(ref.idExterno, id)
      this.apelidosNovos.push(`${this.fonte}:${ref.idExterno} → ${ref.nome}`)
    }
    if (!this.porNome.has(chaveNome)) {
      novos.push({
        clubeId: id,
        fonte: this.fonte,
        tipo: 'nome',
        chave: ref.nome,
        temporadaAno: temporadaAno ?? null,
      })
      this.porNome.set(chaveNome, id)
    }
    if (novos.length) await this.db.insert(clubeAlias).values(novos).onConflictDoNothing()

    return id
  }
}
