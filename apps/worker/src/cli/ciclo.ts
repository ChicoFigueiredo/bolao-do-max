#!/usr/bin/env bun
/** Roda um ciclo do worker e relata. `--forcar` consulta as APIs com cota. */
import { carregarConfig } from '@bolao/config'
import { executarCiclo } from '../casos/ciclo.ts'

const cfg = carregarConfig()
const forcar = Bun.argv.includes('--forcar')

try {
  const r = await executarCiclo(cfg, { forcar })

  console.log(`ciclo · ${r.duracaoMs} ms`)
  console.log(`  cadência    ${r.cadencia.janela} — ${r.cadencia.motivo}`)
  console.log(`              próxima passada em ${r.cadencia.intervaloS}s`)
  console.log(
    `  partidas    ${r.partidas.inseridas} novas · ${r.partidas.atualizadas} atualizadas · ` +
      `${r.partidas.inalteradas} inalteradas` +
      (r.partidas.alteracoes ? ` · ${r.partidas.alteracoes} alterações registradas` : ''),
  )
  console.log(
    `  snapshot    ${r.snapshot.gravou ? `gravado #${r.snapshot.id}` : `inalterado (#${r.snapshot.id})`}`,
  )
  if (r.reconciliacao) {
    const est = r.reconciliacao.divergencias.filter((d) => d.severidade === 'estatistica').length
    const ord = r.reconciliacao.divergencias.filter((d) => d.severidade === 'ordenacao').length
    console.log(
      `  conferência ${r.reconciliacao.fontesConsultadas.join(' + ')} · ` +
        `${est} divergências de fato · ${ord} de ordenação · ` +
        `${r.reconciliacao.fatosConferem ? 'fatos conferem ✓' : 'FATOS DIVERGEM ✗'}`,
    )
  } else {
    console.log(`  conferência pulada nesta cadência`)
  }
  console.log(`  cache       ${r.publicouCache ? 'publicado' : 'não publicado'}`)
  console.log(`  pré-render  ${r.prerender.detalhes} detalhes · ${r.prerender.series} séries`)
} catch (e) {
  console.error('✗ ciclo falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
}
