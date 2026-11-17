import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RAIZ, carregarParametros } from '../bin/comum.ts'

/**
 * O deploy copia `infra/caddy/<dominio>.caddy` para o servidor sem alterar nada.
 * Estas conferências pegam, antes do deploy, o erro que de outro modo só
 * apareceria no `caddy validate` lá: Site faltando, ou apontando para a porta
 * errada.
 */
const p = carregarParametros()
const dominios = [p.aplicacao.dominio, p.aplicacao.dominio_producao]

describe('Sites do Caddy versionados', () => {
  for (const dominio of dominios) {
    const arquivo = resolve(RAIZ, `infra/caddy/${dominio}.caddy`)

    test(`${dominio}: o arquivo existe`, () => {
      expect(existsSync(arquivo)).toBe(true)
    })

    test(`${dominio}: o Site tem o próprio domínio e aponta para a porta publicada`, () => {
      const texto = readFileSync(arquivo, 'utf8')
      expect(texto).toMatch(new RegExp(`^${dominio.replaceAll('.', '\\.')} \\{`, 'm'))
      expect(texto).toContain(`reverse_proxy 127.0.0.1:${p.aplicacao.porta_publicada}`)
    })

    test(`${dominio}: não depende de segredo nem de arquivo fora do git`, () => {
      const texto = readFileSync(arquivo, 'utf8')
      expect(texto).not.toMatch(/^\s*import (senha|\/etc\/caddy\/segredos)/m)
      expect(texto).not.toContain('{env.')
    })
  }

  test('o parâmetro caddy aponta para caminhos absolutos', () => {
    expect(p.caddy.pasta_sites.startsWith('/')).toBe(true)
    expect(p.caddy.caddyfile.startsWith('/')).toBe(true)
  })
})
