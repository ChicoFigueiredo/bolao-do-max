import { carregarConfig } from '@bolao/config'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { esquema } from './schema.ts'

export * from './schema.ts'
export { esquema }

export type Banco = ReturnType<typeof abrirBanco>['db']

/**
 * Abre a conexão. Devolve também o cliente cru para poder encerrar — scripts
 * de CLI precisam fechar explicitamente ou o processo fica pendurado.
 */
export function abrirBanco(url?: string) {
  const cfg = carregarConfig()
  const sql = postgres(url ?? cfg.DATABASE_URL, {
    max: cfg.DATABASE_POOL_MAX,
    idle_timeout: cfg.DATABASE_POOL_IDLE_TIMEOUT_S,
    onnotice: () => {},
  })
  const db = drizzle(sql, { schema: esquema })
  return { db, sql, fechar: () => sql.end({ timeout: 5 }) }
}
