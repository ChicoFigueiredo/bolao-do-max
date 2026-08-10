import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextConfig } from 'next'

/**
 * O `.env` vive na raiz do monorepo, mas o Next roda com o cwd em `apps/web`
 * e só procura ali. Carregar aqui popula o `process.env` do processo servidor
 * — e só dele: nada disso vai para o bundle do cliente, que é o motivo de não
 * usar a chave `env` do Next.
 */
function carregarEnvDaRaiz() {
  const caminho = resolve(process.cwd(), '../../.env')
  try {
    for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha)
      if (!m) continue
      const [, chave, bruto] = m
      if (process.env[chave!] !== undefined) continue
      process.env[chave!] = bruto!.trim().replace(/^["'](.*)["']$/, '$1')
    }
  } catch {
    // Sem .env na raiz: em produção as variáveis vêm do ambiente do container.
  }
}

carregarEnvDaRaiz()

const config: NextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo são TypeScript cru, sem etapa de build própria —
  // o Next os transpila junto. É o que mantém o repo sem build step extra.
  transpilePackages: ['@bolao/config', '@bolao/db', '@bolao/dominio', '@bolao/worker'],
  serverExternalPackages: ['postgres'],
  output: 'standalone',
  eslint: { ignoreDuringBuilds: true },
}

export default config
