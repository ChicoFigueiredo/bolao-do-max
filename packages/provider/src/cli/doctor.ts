#!/usr/bin/env bun
/**
 * Diagnóstico das fontes. Consulta cada uma habilitada e relata cobertura,
 * latência e coerência. É o critério de verificação das fases 4 e 6.
 */
import { carregarConfig } from '@bolao/config'
import { ProvedorGE } from '../ge.ts'
import { ErroDeProvedor, type ProvedorEsportivo } from '../porta.ts'

const cfg = carregarConfig()
const temporada = cfg.TEMPORADA_ATUAL

const provedores: ProvedorEsportivo[] = []
if (cfg.PROVIDER_GE_ENABLED) provedores.push(new ProvedorGE(cfg))

if (!provedores.length) {
  console.error('nenhuma fonte habilitada — veja PROVIDER_*_ENABLED no .env')
  process.exit(1)
}

console.log(`diagnóstico · temporada ${temporada} · série ${cfg.SERIE}\n`)
let falhas = 0

for (const p of provedores) {
  const partes: string[] = []

  if (p.obterClassificacao) {
    const t0 = performance.now()
    try {
      const c = await p.obterClassificacao(temporada, cfg.SERIE)
      const ms = Math.round(performance.now() - t0)
      const lider = c.find((l) => l.posicao === 1)
      partes.push(`classificação ${c.length} clubes · líder ${lider?.clube} (${lider?.pontos} pts) · ${ms} ms`)
      if (c.length !== 20) partes.push(`⚠ esperava 20 clubes`)
    } catch (e) {
      falhas++
      partes.push(`classificação ✗ ${e instanceof ErroDeProvedor ? e.message : e}`)
    }
  }

  if (p.obterPartidas) {
    const t0 = performance.now()
    try {
      const j = await p.obterPartidas(temporada, cfg.SERIE)
      const ms = Math.round(performance.now() - t0)
      const rodadas = new Set(j.map((x) => x.rodada)).size
      const encerradas = j.filter((x) => x.status === 'encerrada').length
      const comHorario = j.filter((x) => x.inicioConfirmado).length
      const adiadas = j.filter((x) => x.status === 'adiada').length
      partes.push(
        `partidas ${j.length} em ${rodadas} rodadas · ${encerradas} encerradas · ` +
          `${comHorario} com horário firme · ${adiadas} adiadas · ${ms} ms`,
      )
    } catch (e) {
      falhas++
      partes.push(`partidas ✗ ${e instanceof ErroDeProvedor ? e.message : e}`)
    }
  }

  const ok = !partes.some((x) => x.includes('✗'))
  console.log(`${ok ? '✓' : '✗'} ${p.nome.padEnd(14)}${partes.join('\n                ')}`)
}

process.exitCode = falhas ? 1 : 0
