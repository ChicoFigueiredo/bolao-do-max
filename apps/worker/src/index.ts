#!/usr/bin/env bun
/**
 * Worker do Bolão do Max.
 *
 * Não roda em intervalo fixo: cada ciclo decide quando o próximo vale a pena,
 * lendo o calendário. Durante uma partida consulta de 3 em 3 minutos; num dia
 * sem jogos, duas vezes ao dia; fora de temporada, quase nunca.
 *
 * Uma vez por dia o calendário completo é ressincronizado, para capturar
 * remarcações da CBF — é a única passada que custa 38 requisições.
 */
import { carregarConfig, ErroDeConfiguracao } from '@bolao/config'
import { abrirBanco } from '@bolao/db'
import { Cache } from './cache.ts'
import { executarCiclo } from './casos/ciclo.ts'

let cfg
try {
  cfg = carregarConfig()
} catch (e) {
  console.error(e instanceof ErroDeConfiguracao ? e.message : e)
  process.exit(1)
}

const { db, fechar } = abrirBanco()
const cache = new Cache(cfg)

let parando = false
let proximoTimer: Timer | undefined
let ultimoCalendarioCompleto = 0

const DIA_MS = 86_400_000
const hora = () => new Date().toLocaleTimeString('pt-BR', { timeZone: cfg!.TZ })

async function tick() {
  if (parando) return

  const completo = Date.now() - ultimoCalendarioCompleto > DIA_MS
  let intervaloS = cfg!.PROVIDER_GE_INTERVALO_OCIOSO_S

  try {
    const r = await executarCiclo(cfg!, { db, cache, calendarioCompleto: completo })
    if (completo) ultimoCalendarioCompleto = Date.now()
    intervaloS = r.cadencia.intervaloS

    const conf = r.reconciliacao
      ? ` · ${conf_txt(r.reconciliacao)}`
      : ''
    console.log(
      `[${hora()}] ${r.cadencia.janela} · ` +
        `partidas ${r.partidas.inseridas}n/${r.partidas.atualizadas}a` +
        (r.partidas.alteracoes ? `/${r.partidas.alteracoes}alt` : '') +
        ` · snapshot ${r.snapshot.gravou ? `#${r.snapshot.id} NOVO` : 'inalterado'}` +
        conf +
        ` · pré-render ${r.prerender.detalhes}+${r.prerender.series}` +
        ` · ${r.duracaoMs}ms` +
        (completo ? ' · calendário completo' : ''),
    )
  } catch (e) {
    // Falha de ciclo não derruba o worker: o cache mantém o último bom e a
    // próxima passada tenta de novo, com recuo.
    intervaloS = Math.min(intervaloS, 300)
    console.error(`[${hora()}] ✗ ciclo falhou: ${e instanceof Error ? e.message : e}`)
  }

  if (!parando) proximoTimer = setTimeout(tick, intervaloS * 1000)
}

function conf_txt(r: NonNullable<Awaited<ReturnType<typeof executarCiclo>>['reconciliacao']>) {
  const est = r.divergencias.filter((d) => d.severidade === 'estatistica').length
  return est ? `⚠ ${est} divergências de fato` : `conferido (${r.fontesConsultadas.length} fontes)`
}

async function encerrar(sinal: string) {
  if (parando) return
  parando = true
  console.log(`\n[${hora()}] ${sinal} — encerrando`)
  if (proximoTimer) clearTimeout(proximoTimer)
  cache.close()
  await fechar()
  process.exit(0)
}

process.on('SIGINT', () => void encerrar('SIGINT'))
process.on('SIGTERM', () => void encerrar('SIGTERM'))

console.log(
  `worker do Bolão do Max · temporada ${cfg.TEMPORADA_ATUAL}/${cfg.SERIE} · ` +
    `fontes ${cfg.ordemFontes.join(',')} · TZ ${cfg.TZ}`,
)
if (!(await cache.ping())) console.warn('⚠ Redis não respondeu ao PING — seguindo assim mesmo')

await tick()
