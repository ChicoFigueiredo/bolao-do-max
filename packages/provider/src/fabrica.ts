import type { Configuracao } from '@bolao/config'
import { ProvedorApiFootball } from './apifootball.ts'
import { FONTE_APIFOOTBALL, FONTE_FOOTBALLDATA, FONTE_GE } from './index.ts'
import { ProvedorFootballData } from './footballdata.ts'
import { ProvedorGE } from './ge.ts'
import type { Limites } from './cota.ts'
import type { ProvedorEsportivo } from './porta.ts'

/** Monta as fontes habilitadas, na ordem de confiança do `.env`. */
export function montarProvedores(cfg: Configuracao): ProvedorEsportivo[] {
  const disponiveis: Record<string, () => ProvedorEsportivo | null> = {
    [FONTE_GE]: () => (cfg.PROVIDER_GE_ENABLED ? new ProvedorGE(cfg) : null),
    [FONTE_APIFOOTBALL]: () =>
      cfg.PROVIDER_APIFOOTBALL_ENABLED ? new ProvedorApiFootball(cfg) : null,
    [FONTE_FOOTBALLDATA]: () =>
      cfg.PROVIDER_FOOTBALLDATA_ENABLED ? new ProvedorFootballData(cfg) : null,
  }
  return cfg.ordemFontes.map((n) => disponiveis[n]?.() ?? null).filter((p): p is ProvedorEsportivo => p !== null)
}

/** Tetos auto-impostos, deliberadamente abaixo dos limites reais das APIs. */
export function limitesDeCota(cfg: Configuracao): Record<string, Limites> {
  return {
    [FONTE_GE]: {},
    [FONTE_APIFOOTBALL]: {
      porMinuto: cfg.PROVIDER_APIFOOTBALL_QUOTA_MINUTE,
      porDia: cfg.PROVIDER_APIFOOTBALL_QUOTA_DAY,
    },
    [FONTE_FOOTBALLDATA]: { porMinuto: cfg.PROVIDER_FOOTBALLDATA_QUOTA_MINUTE },
  }
}
