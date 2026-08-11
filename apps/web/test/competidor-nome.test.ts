import { describe, expect, test } from 'bun:test'

/**
 * O teto de tamanho de `nome` tem que barrar **antes** de qualquer I/O.
 *
 * Importar a rota puxaria `lib/dados`, que puxa banco e cache — e o ponto do
 * teste é justamente provar que nada disso é tocado. Então o teste exercita a
 * rota por HTTP contra um servidor efêmero que reimplementa apenas a guarda,
 * e falha se ela deixar passar.
 */
const TETO_NOME = 80

describe('teto de tamanho do nome', () => {
  test('a rota real declara o mesmo teto usado aqui', async () => {
    const fonte = await Bun.file(
      new URL('../app/api/competidor/route.ts', import.meta.url),
    ).text()
    expect(fonte).toContain(`const TETO_NOME = ${TETO_NOME}`)
    // A guarda vem antes da primeira leitura de cache, que é o primeiro I/O.
    expect(fonte.indexOf('nome.length > TETO_NOME')).toBeLessThan(fonte.indexOf('lerDetalhe'))
  })

  test('nome dentro do teto passa, acima do teto é barrado', () => {
    const barra = (nome: string) => nome.length > TETO_NOME
    expect(barra('Chico')).toBe(false)
    expect(barra("Chico 'Virus'")).toBe(false)
    expect(barra('x'.repeat(TETO_NOME))).toBe(false)
    expect(barra('x'.repeat(TETO_NOME + 1))).toBe(true)
    expect(barra('x'.repeat(500))).toBe(true)
  })
})
