import { readFileSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

/**
 * O drizzle-kit executa este arquivo sob Node, não sob Bun: `Bun.env` não
 * existe aqui e o `.env` não é carregado sozinho. Por isso a leitura manual.
 */
function lerEnv(chave: string): string | undefined {
  if (process.env[chave]) return process.env[chave]
  try {
    for (const linha of readFileSync('.env', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(linha.trim())
      if (m && m[1] === chave) return m[2]
    }
  } catch {
    /* sem .env — cai no erro abaixo */
  }
  return undefined
}

const url = lerEnv('DATABASE_URL')
if (!url) throw new Error('DATABASE_URL ausente — copie .env.example para .env')

export default defineConfig({
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  verbose: true,
  strict: true,
})
