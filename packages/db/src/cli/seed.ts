#!/usr/bin/env bun
/**
 * Carrega `seeds/` no banco. Idempotente: pode rodar quantas vezes quiser.
 *
 * Ordem importa por causa das chaves estrangeiras:
 *   clube → competidor → temporada → apostas
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { REGRAS_CORRENTES } from '@bolao/regras/temporadas'
import { eq, sql } from 'drizzle-orm'
import {
  abrirBanco,
  apostaClassico,
  apostaPosicao,
  clube,
  clubeAlias,
  competidor,
  competidorAlias,
  temporada,
} from '../index.ts'

type SeedAposta = {
  temporada: number
  serie: string
  temClassico: boolean
  temPosicao: boolean
  competidores: {
    nome: string
    nomeNaTemporada: string
    clubes: { grupo: string; clube: string; coracao: boolean }[]
    palpites: { clube: string; posicao: number }[]
  }[]
}

type SeedIdentidade = { canonico: string; apelidos: { nome: string; temporadas: number[] }[] }

const ler = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T

const temporadas = readdirSync('seeds/apostas')
  .filter((f) => f.endsWith('.json'))
  .map((f) => ler<SeedAposta>(join('seeds/apostas', f)))
  .sort((a, b) => a.temporada - b.temporada)

const identidades = ler<SeedIdentidade[]>('seeds/identidades.json')

const { db, fechar } = abrirBanco()

try {
  // ── Clubes ───────────────────────────────────────────────
  const nomesClube = [
    ...new Set(
      temporadas.flatMap((t) =>
        t.competidores.flatMap((c) => [
          ...c.clubes.map((x) => x.clube),
          ...c.palpites.map((p) => p.clube),
        ]),
      ),
    ),
  ].sort()

  await db
    .insert(clube)
    .values(nomesClube.map((nome) => ({ nome })))
    .onConflictDoNothing()

  const clubes = new Map((await db.select().from(clube)).map((c) => [c.nome, c.id]))

  await db
    .insert(clubeAlias)
    .values(
      nomesClube.map((nome) => ({
        clubeId: clubes.get(nome)!,
        fonte: 'seed',
        tipo: 'nome' as const,
        chave: nome,
        temporadaAno: null,
      })),
    )
    .onConflictDoNothing()

  // Como cada fonte externa escreve cada clube. Gerado por
  // `gerar-alias-clubes.ts` e revisado à mão quando necessário.
  type AliasFonte = { fonte: string; nome: string; canonico: string; via: string }
  let aliasFontes: AliasFonte[] = []
  try {
    aliasFontes = ler<AliasFonte[]>('seeds/clubes-alias.json')
  } catch {
    /* opcional: só existe depois de rodar o gerador */
  }
  const semCanonico = aliasFontes.filter((a) => !clubes.has(a.canonico))
  if (semCanonico.length)
    throw new Error(
      `clubes-alias.json aponta para clubes inexistentes: ${semCanonico
        .map((a) => `${a.fonte}:${a.nome} → ${a.canonico}`)
        .join(', ')}`,
    )
  if (aliasFontes.length)
    await db
      .insert(clubeAlias)
      .values(
        aliasFontes.map((a) => ({
          clubeId: clubes.get(a.canonico)!,
          fonte: a.fonte,
          tipo: 'nome' as const,
          chave: a.nome,
          temporadaAno: null,
        })),
      )
      .onConflictDoNothing()

  // ── Competidores e apelidos ──────────────────────────────
  const canonicos = [...new Set(temporadas.flatMap((t) => t.competidores.map((c) => c.nome)))].sort()

  // Renomeia no lugar quando o canônico muda.
  //
  // Inserir a grafia nova criaria outra pessoa, e os snapshots já gravados
  // continuariam apontando para a antiga — o histórico da Evolução ficaria
  // órfão. Renomear preserva o id e, com ele, todas as referências.
  let renomeados = 0
  try {
    const overrides = ler<{ de: string; para: string }[]>('seeds/nomes-canonicos.json')
    for (const o of overrides) {
      const [antigo] = await db.select().from(competidor).where(eq(competidor.nome, o.de))
      if (!antigo) continue
      const [novo] = await db.select().from(competidor).where(eq(competidor.nome, o.para))
      if (novo) continue // já renomeado numa execução anterior
      await db.update(competidor).set({ nome: o.para }).where(eq(competidor.id, antigo.id))
      renomeados++
      console.log(`  renomeado: ${o.de} → ${o.para} (id ${antigo.id} preservado)`)
    }
  } catch {
    /* arquivo opcional */
  }

  await db
    .insert(competidor)
    .values(canonicos.map((nome) => ({ nome })))
    .onConflictDoNothing()

  const pessoas = new Map((await db.select().from(competidor)).map((c) => [c.nome, c.id]))

  const aliases = identidades.flatMap((i) =>
    i.apelidos.flatMap((a) =>
      a.temporadas.map((ano) => ({
        competidorId: pessoas.get(i.canonico)!,
        nome: a.nome,
        temporadaAno: ano,
      })),
    ),
  )
  if (aliases.length) await db.insert(competidorAlias).values(aliases).onConflictDoNothing()

  // ── Temporadas e apostas ─────────────────────────────────
  let totalClassico = 0
  let totalPosicao = 0

  for (const t of temporadas) {
    await db
      .insert(temporada)
      .values({
        ano: t.temporada,
        serie: t.serie,
        temClassico: t.temClassico,
        temPosicao: t.temPosicao,
        regras: REGRAS_CORRENTES,
      })
      .onConflictDoUpdate({
        target: [temporada.ano, temporada.serie],
        set: { temPosicao: t.temPosicao, regras: REGRAS_CORRENTES },
      })

    const [tmp] = await db
      .select({ id: temporada.id })
      .from(temporada)
      .where(sql`${temporada.ano} = ${t.temporada} and ${temporada.serie} = ${t.serie}`)
    const temporadaId = tmp!.id

    // Recarrega do zero: o seed é a fonte da verdade das apostas.
    await db.delete(apostaClassico).where(eq(apostaClassico.temporadaId, temporadaId))
    await db.delete(apostaPosicao).where(eq(apostaPosicao.temporadaId, temporadaId))

    const classico = t.competidores.flatMap((c) =>
      c.clubes.map((x) => ({
        temporadaId,
        competidorId: pessoas.get(c.nome)!,
        grupo: x.grupo as 'GP1',
        clubeId: clubes.get(x.clube)!,
        coracao: x.coracao,
      })),
    )
    if (classico.length) await db.insert(apostaClassico).values(classico)
    totalClassico += classico.length

    const posicao = t.competidores.flatMap((c) =>
      c.palpites.map((p) => ({
        temporadaId,
        competidorId: pessoas.get(c.nome)!,
        posicao: p.posicao,
        clubeId: clubes.get(p.clube)!,
      })),
    )
    if (posicao.length) await db.insert(apostaPosicao).values(posicao)
    totalPosicao += posicao.length
  }

  console.log(`✓ ${clubes.size} clubes`)
  console.log(`✓ ${pessoas.size} competidores · ${aliases.length} apelidos`)
  console.log(`✓ ${temporadas.length} temporadas`)
  console.log(`✓ ${totalClassico} apostas do Clássico · ${totalPosicao} palpites de Posição`)
} catch (e) {
  console.error('✗ seed falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
