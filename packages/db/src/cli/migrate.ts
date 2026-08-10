#!/usr/bin/env bun
/** Aplica as migrations pendentes. Idempotente. */
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { abrirBanco } from '../index.ts'

const { db, fechar } = abrirBanco()

try {
  console.log('aplicando migrations…')
  await migrate(db, { migrationsFolder: 'packages/db/migrations' })
  console.log('✓ banco em dia')
} catch (e) {
  console.error('✗ falhou:', e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await fechar()
}
