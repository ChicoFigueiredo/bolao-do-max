#!/usr/bin/env bun
/** Sincroniza o calendário da temporada corrente a partir da fonte primária. */
import { carregarConfig } from '@bolao/config'
import { abrirBanco } from '@bolao/db'
import { ProvedorGE } from '@bolao/provider'
import { sincronizarCalendario } from '../casos/sincronizar-partidas.ts'

const cfg = carregarConfig()
const ano = Number(Bun.argv[2] ?? cfg.TEMPORADA_ATUAL)
const { db, fechar } = abrirBanco()

try {
  const t0 = performance.now()
  const r = await sincronizarCalendario(db, cfg, new ProvedorGE(cfg), ano)
  const ms = Math.round(performance.now() - t0)

  console.log(`temporada ${ano} · ${r.total} partidas da fonte · ${ms} ms`)
  console.log(`  inseridas   ${r.inseridas}`)
  console.log(`  atualizadas ${r.atualizadas}`)
  console.log(`  inalteradas ${r.inalteradas}`)
  if (r.clubesCriados.length) console.log(`  clubes novos: ${r.clubesCriados.join(', ')}`)

  if (r.alteracoes.length) {
    console.log(`\n  ${r.alteracoes.length} alterações registradas:`)
    for (const a of r.alteracoes.slice(0, 12))
      console.log(`    ${a.partida} · ${a.campo}: ${a.de ?? '—'} → ${a.para ?? '—'}`)
    if (r.alteracoes.length > 12) console.log(`    … e mais ${r.alteracoes.length - 12}`)
  }
} catch (e) {
  console.error('✗ falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
