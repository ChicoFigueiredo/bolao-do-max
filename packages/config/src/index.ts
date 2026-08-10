/**
 * Configuração da aplicação, validada na carga.
 *
 * Regra do projeto: nada de fallback silencioso. Se uma variável obrigatória
 * está ausente ou malformada, o processo não sobe — em vez de assumir um
 * default embutido e falhar de forma obscura mais tarde, que é o modo de
 * falha do sistema atual (senha de Redis hardcoded em `app.js`).
 */
import { z } from 'zod'

const booleano = z
  .string()
  .transform((v) => v.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1')

const inteiro = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max)

/** URL com placeholders `{temporada}` / `{rodada}` — validada como template. */
const urlTemplate = z
  .string()
  .min(1)
  .refine((v) => v.startsWith('http://') || v.startsWith('https://'), {
    message: 'deve começar com http:// ou https://',
  })

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  WEB_PORT: inteiro(1, 65535).default(3000),
  WORKER_PORT: inteiro(1, 65535).default(3100),

  TEMPORADA_ATUAL: inteiro(2000, 2100),
  SERIE: z.enum(['A', 'B']).default('A'),

  DATABASE_URL: z.string().startsWith('postgres'),
  DATABASE_POOL_MAX: inteiro(1, 100).default(8),
  DATABASE_POOL_IDLE_TIMEOUT_S: inteiro(1, 3600).default(30),

  REDIS_URL: z.string().startsWith('redis'),
  REDIS_PREFIX: z.string().min(1),
  REDIS_TTL_RESULTADOS_S: inteiro(1, 86400).default(900),

  PROVIDER_GE_ENABLED: booleano.default('true'),
  PROVIDER_GE_URL_CLASSIFICACAO: urlTemplate,
  PROVIDER_GE_URL_AGENDA: urlTemplate,
  PROVIDER_GE_USER_AGENT: z.string().min(1),
  PROVIDER_GE_TIMEOUT_MS: inteiro(500, 60000).default(8000),
  PROVIDER_GE_RETRY: inteiro(0, 5).default(2),
  PROVIDER_GE_INTERVALO_JOGO_S: inteiro(30, 86400).default(180),
  PROVIDER_GE_INTERVALO_DIA_JOGO_S: inteiro(30, 86400).default(1800),
  PROVIDER_GE_INTERVALO_OCIOSO_S: inteiro(30, 604800).default(43200),

  PROVIDER_APIFOOTBALL_ENABLED: booleano.default('false'),
  PROVIDER_APIFOOTBALL_KEY: z.string().default(''),
  PROVIDER_APIFOOTBALL_BASE_URL: z.string().url().default('https://v3.football.api-sports.io'),
  PROVIDER_APIFOOTBALL_LEAGUE_ID: inteiro(1, 100000).default(71),
  PROVIDER_APIFOOTBALL_TIMEOUT_MS: inteiro(500, 60000).default(10000),
  PROVIDER_APIFOOTBALL_QUOTA_DAY: inteiro(1, 1000000).default(60),
  PROVIDER_APIFOOTBALL_QUOTA_MINUTE: inteiro(1, 10000).default(8),

  PROVIDER_FOOTBALLDATA_ENABLED: booleano.default('false'),
  PROVIDER_FOOTBALLDATA_KEY: z.string().default(''),
  PROVIDER_FOOTBALLDATA_BASE_URL: z.string().url().default('https://api.football-data.org/v4'),
  PROVIDER_FOOTBALLDATA_COMPETITION: z.string().default('BSA'),
  PROVIDER_FOOTBALLDATA_TIMEOUT_MS: inteiro(500, 60000).default(10000),
  PROVIDER_FOOTBALLDATA_QUOTA_MINUTE: inteiro(1, 10000).default(8),

  RECONCILIACAO_ORDEM: z.string().default('ge,apifootball,footballdata'),
  RECONCILIACAO_MINIMO_FONTES: inteiro(1, 5).default(2),
  RECONCILIACAO_ALARMA_DIVERGENCIA: booleano.default('true'),

  WORKER_ENABLED: booleano.default('true'),
  WORKER_CRON_CALENDARIO: z.string().default('0 3 * * *'),
  WORKER_JANELA_JOGO_ANTES_MIN: inteiro(0, 600).default(15),
  WORKER_JANELA_JOGO_DEPOIS_MIN: inteiro(0, 600).default(150),
  WORKER_SNAPSHOT_SOMENTE_MUDANCA: booleano.default('true'),
})

export type Configuracao = z.infer<typeof esquema> & {
  /** Nomes das fontes na ordem de confiança, já separados. */
  ordemFontes: string[]
}

export class ErroDeConfiguracao extends Error {
  constructor(public readonly problemas: string[]) {
    super(
      `Configuração inválida — o processo não vai subir:\n` +
        problemas.map((p) => `  · ${p}`).join('\n') +
        `\n\nVeja .env.example e docs/_atual/cfg.fornecedores.md`,
    )
    this.name = 'ErroDeConfiguracao'
  }
}

/**
 * `process.env` e não `Bun.env`: o mesmo código roda no worker sob Bun e
 * dentro do bundle do Next, onde o global `Bun` não existe. `process.env`
 * funciona nos dois.
 */
export function carregarConfig(
  fonte: Record<string, string | undefined> = process.env,
): Configuracao {
  const r = esquema.safeParse(fonte)
  if (!r.success) {
    throw new ErroDeConfiguracao(
      r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
    )
  }
  const c = r.data

  const problemas: string[] = []
  if (c.PROVIDER_APIFOOTBALL_ENABLED && !c.PROVIDER_APIFOOTBALL_KEY)
    problemas.push('PROVIDER_APIFOOTBALL_ENABLED=true exige PROVIDER_APIFOOTBALL_KEY')
  if (c.PROVIDER_FOOTBALLDATA_ENABLED && !c.PROVIDER_FOOTBALLDATA_KEY)
    problemas.push('PROVIDER_FOOTBALLDATA_ENABLED=true exige PROVIDER_FOOTBALLDATA_KEY')
  if (!c.PROVIDER_GE_URL_CLASSIFICACAO.includes('{temporada}'))
    problemas.push('PROVIDER_GE_URL_CLASSIFICACAO precisa do placeholder {temporada}')
  if (!c.PROVIDER_GE_URL_AGENDA.includes('{rodada}'))
    problemas.push('PROVIDER_GE_URL_AGENDA precisa do placeholder {rodada}')

  const ordemFontes = c.RECONCILIACAO_ORDEM.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const conhecidas = new Set(['ge', 'apifootball', 'footballdata'])
  for (const f of ordemFontes)
    if (!conhecidas.has(f)) problemas.push(`RECONCILIACAO_ORDEM tem fonte desconhecida: "${f}"`)

  if (problemas.length) throw new ErroDeConfiguracao(problemas)

  return { ...c, ordemFontes }
}

/** Substitui `{temporada}` e `{rodada}` num template de URL. */
export function montarUrl(
  template: string,
  vars: { temporada?: number; rodada?: number },
): string {
  let u = template
  if (vars.temporada !== undefined) u = u.replaceAll('{temporada}', String(vars.temporada))
  if (vars.rodada !== undefined) u = u.replaceAll('{rodada}', String(vars.rodada))
  const restante = u.match(/\{(\w+)\}/)
  if (restante) throw new Error(`placeholder não substituído em "${template}": {${restante[1]}}`)
  return u
}
