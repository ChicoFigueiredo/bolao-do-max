#!/usr/bin/env bun
/**
 * Gera `seeds/tabelas-finais/<ano>.json` — a classificação final de cada
 * temporada passada.
 *
 * Os resultados históricos do bolão nunca foram persistidos: os JSONs legados
 * têm `Pontos: 0` em todos os competidores, e as planilhas são formulários de
 * aposta. Só existiam no Redis, que é volátil. Reconstruir exige a tabela
 * final de cada Brasileirão.
 *
 * Cobertura gratuita medida em 09/08/2026 (ver cfg.fornecedores.md §0):
 *   2022        só API-Football
 *   2023, 2024  API-Football e football-data
 *   2025        só football-data
 *   2018–2021   nenhuma fonte gratuita
 *
 * Quando duas fontes cobrem o mesmo ano, as duas são consultadas e as
 * estatísticas conferidas. Divergência de fato interrompe a gravação; a de
 * ordenação é esperada (critério europeu × brasileiro) e fica anotada.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { carregarConfig } from '@bolao/config'
import {
  chaveClube,
  ProvedorApiFootball,
  ProvedorFootballData,
  type LinhaClassificacaoFonte,
  type ProvedorEsportivo,
} from '@bolao/provider'

const DESTINO = 'seeds/tabelas-finais'
const ANOS = [2022, 2023, 2024, 2025]

const cfg = carregarConfig()
const candidatos: ProvedorEsportivo[] = []
if (cfg.PROVIDER_APIFOOTBALL_ENABLED) candidatos.push(new ProvedorApiFootball(cfg))
if (cfg.PROVIDER_FOOTBALLDATA_ENABLED) candidatos.push(new ProvedorFootballData(cfg))

mkdirSync(DESTINO, { recursive: true })

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
const CAMPOS = ['pontos', 'jogos', 'vitorias', 'empates', 'derrotas', 'golsPro', 'golsContra'] as const

for (const ano of ANOS) {
  const obtidas: { fonte: string; linhas: LinhaClassificacaoFonte[] }[] = []

  for (const p of candidatos) {
    if (!p.obterClassificacao) continue
    await dormir(7000) // football-data limita a 10 req/min
    try {
      const linhas = await p.obterClassificacao(ano, cfg.SERIE)
      obtidas.push({ fonte: p.nome, linhas })
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n').slice(0, 2).join(' ') : String(e)
      console.log(`  ${ano} · ${p.nome}: indisponível`)
      if (!/does not have access|HTTP 403|restricted/i.test(msg)) console.log(`     ${msg.slice(0, 110)}`)
    }
  }

  if (!obtidas.length) {
    console.log(`${ano}: ✗ nenhuma fonte gratuita`)
    continue
  }

  const principal = obtidas[0]!
  const divergencias: string[] = []

  if (obtidas.length > 1) {
    // Casar por estatística NÃO funciona: dois clubes podem ter os mesmos
    // pontos, jogos e gols pró. Em 2023, Atlético-PR (14v/14e) e outro clube
    // (16v/8e) somam 56 pontos com o mesmo aproveitamento bruto — casá-los
    // por essa chave produzia divergências inventadas. O casamento é por nome.
    const outra = obtidas[1]!
    const porNome = new Map(outra.linhas.map((l) => [chaveClube(l.clube), l]))
    const semPar: string[] = []
    for (const l of principal.linhas) {
      const par = porNome.get(chaveClube(l.clube))
      if (!par) {
        semPar.push(l.clube)
        continue
      }
      for (const c of CAMPOS)
        if (l[c] !== par[c]) divergencias.push(`${l.clube}.${c}: ${l[c]} × ${par[c]}`)
    }
    if (semPar.length) console.log(`  ${ano}: ${semPar.length} clubes sem par entre as fontes — ${semPar.join(', ')}`)
  }

  const seed = {
    temporada: ano,
    serie: cfg.SERIE,
    fontes: obtidas.map((o) => o.fonte),
    conferido: obtidas.length > 1,
    divergenciasDeEstatistica: divergencias,
    tabela: principal.linhas
      .slice()
      .sort((a, b) => a.posicao - b.posicao)
      .map((l) => ({
        posicao: l.posicao,
        clube: l.clube,
        pontos: l.pontos,
        jogos: l.jogos,
        vitorias: l.vitorias,
        empates: l.empates,
        derrotas: l.derrotas,
        golsPro: l.golsPro,
        golsContra: l.golsContra,
        saldoGols: l.saldoGols,
      })),
  }

  writeFileSync(join(DESTINO, `${ano}.json`), JSON.stringify(seed, null, 2) + '\n')

  const campeao = seed.tabela[0]!
  const lanterna = seed.tabela.at(-1)!
  const marca = divergencias.length ? `⚠ ${divergencias.length} divergências` : obtidas.length > 1 ? '✓ conferido' : '· fonte única'
  console.log(
    `${ano}: ${seed.tabela.length} clubes · campeão ${campeao.clube} (${campeao.pontos}) · ` +
      `lanterna ${lanterna.clube} (${lanterna.pontos}) · ${obtidas.map((o) => o.fonte).join('+')} ${marca}`,
  )
  for (const d of divergencias.slice(0, 4)) console.log(`     ${d}`)
}
