#!/usr/bin/env bun
/**
 * Recalcula os bolões das temporadas encerradas a partir das tabelas finais.
 *
 * Cada ano é recalculado com as regras gravadas na sua própria `temporada`,
 * pelo mesmo motor que apura a temporada corrente. Nada de código especial
 * para o passado.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { carregarConfig } from '@bolao/config'
import { abrirBanco, carregarApostadores, clube, clubeAlias, temporada } from '@bolao/db'
import type { RegrasTemporada, Tabela } from '@bolao/dominio'
import { chaveClube } from '@bolao/provider'
import { calcularClassico, calcularPosicao } from '@bolao/regras'
import { and, eq } from 'drizzle-orm'

type SeedTabela = {
  temporada: number
  serie: string
  fontes: string[]
  conferido: boolean
  tabela: {
    posicao: number
    clube: string
    pontos: number
    jogos: number
    vitorias: number
    empates: number
    derrotas: number
    golsPro: number
    golsContra: number
    saldoGols: number
  }[]
}

const cfg = carregarConfig()
const { db, fechar } = abrirBanco()
const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`

try {
  // Dicionário nome → clube canônico, montado do banco.
  const canonicos = await db.select({ id: clube.id, nome: clube.nome }).from(clube)
  const aliases = await db.select({ chave: clubeAlias.chave, clubeId: clubeAlias.clubeId }).from(clubeAlias)
  const porId = new Map(canonicos.map((c) => [c.id, c.nome]))
  const dicionario = new Map<string, string>()
  for (const c of canonicos) dicionario.set(chaveClube(c.nome), c.nome)
  for (const a of aliases) {
    const nome = porId.get(a.clubeId)
    if (nome) dicionario.set(chaveClube(a.chave), nome)
  }

  const arquivos = readdirSync('seeds/tabelas-finais')
    .filter((f) => f.endsWith('.json'))
    .sort()

  console.log('HALL DA FAMA — recalculado com as regras de cada temporada\n')

  for (const f of arquivos) {
    const seed: SeedTabela = JSON.parse(readFileSync(join('seeds/tabelas-finais', f), 'utf8'))

    const [t] = await db
      .select()
      .from(temporada)
      .where(and(eq(temporada.ano, seed.temporada), eq(temporada.serie, seed.serie)))
    if (!t) {
      console.log(`${seed.temporada}: sem apostas no banco — pulando`)
      continue
    }

    const naoResolvidos: string[] = []
    const tabela: Tabela = seed.tabela.map((l) => {
      const nome = dicionario.get(chaveClube(l.clube))
      if (!nome) naoResolvidos.push(l.clube)
      return { ...l, clube: nome ?? l.clube }
    })

    const apostadores = await carregarApostadores(db, t.id)
    const usados = new Set(apostadores.flatMap((a) => a.clubes.map((c) => c.clube)))
    const naTabela = new Set(tabela.map((l) => l.clube))
    const apostadosForaDaTabela = [...usados].filter((c) => !naTabela.has(c))

    const regras = t.regras as RegrasTemporada
    if (apostadosForaDaTabela.length) {
      console.log(
        `${seed.temporada}: ✗ ${apostadosForaDaTabela.length} clubes apostados não estão na tabela final — ` +
          `${apostadosForaDaTabela.join(', ')}`,
      )
      if (naoResolvidos.length) console.log(`     nomes da fonte não resolvidos: ${naoResolvidos.join(', ')}`)
      continue
    }

    const classico = calcularClassico(tabela, apostadores, regras)
    const campeao = classico[0]!
    const lanterna = classico.at(-1)!

    console.log(
      `${seed.temporada}  ${seed.conferido ? '✓✓' : '✓ '} ` +
        `campeão do Clássico: ${campeao.nome.padEnd(14)} ${String(campeao.pontos).padStart(3)} pts  ${brl(campeao.premioCentavos)}`,
    )
    console.log(
      `           lanterna:            ${lanterna.nome.padEnd(14)} ${String(lanterna.pontos).padStart(3)} pts  ${brl(lanterna.premioCentavos)}`,
    )

    if (t.temPosicao) {
      const posicao = calcularPosicao(tabela, apostadores, regras)
      const lider = posicao[0]!
      const empatados = posicao.filter((l) => l.posicao === 1)
      console.log(
        `           por Posição:         ${empatados.map((e) => e.nome).join(' + ').padEnd(14)} ` +
          `${String(lider.pontos).padStart(3)} pts  ${brl(lider.premioCentavos)}` +
          (empatados.length > 1 ? `  (dividido entre ${empatados.length})` : ''),
      )

      // Um palpite perfeito nas 8 posições não acontece por acerto: indica
      // que a aposta foi registrada ou corrigida depois do campeonato.
      // Confirmado em 2024, onde os 8 palpites do Chico reproduzem a tabela
      // final exata. Sinalizar é obrigatório — anunciar campeão em cima de
      // dado retroalimentado seria publicar um resultado falso.
      const maximo = 8 * regras.posicao.pontosPosicaoExata
      const perfeitos = posicao.filter((l) => l.pontos === maximo)
      for (const p of perfeitos)
        console.log(
          `           ⚠ ${p.nome} tem os 8 palpites exatos (${p.pontos}/${maximo}) — ` +
            `estatisticamente impossível como previsão. Aposta provavelmente ` +
            `preenchida após o encerramento; resultado não confiável.`,
        )
    }
    console.log()
  }
} catch (e) {
  console.error('✗ falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
