import { describe, expect, test } from 'bun:test'
import { ABAS, navegar, type Vista } from '../lib/navegacao-abas.ts'

/**
 * A sequência que o gesto percorre é linear e tem quatro paradas:
 *
 *   Clássico → Por Posição → Evolução/Clássico → Evolução/Por Posição
 *
 * "Frente" é o arrasto da direita para a esquerda; "trás" é o contrário.
 */
const CLASSICO: Vista = { aba: 'classico', bolao: 'classico' }
const POSICAO: Vista = { aba: 'posicao', bolao: 'classico' }
const EVO_C: Vista = { aba: 'evolucao', bolao: 'classico' }
const EVO_P: Vista = { aba: 'evolucao', bolao: 'posicao' }

describe('navegar para frente', () => {
  test('do clássico vai para o por posição', () => {
    expect(navegar(CLASSICO, 'frente')).toEqual(POSICAO)
  })

  test('do por posição entra na evolução pela subaba clássico', () => {
    expect(navegar(POSICAO, 'frente')).toEqual(EVO_C)
  })

  test('dentro da evolução, troca a subaba antes de tentar trocar de aba', () => {
    expect(navegar(EVO_C, 'frente')).toEqual(EVO_P)
  })

  test('a última parada é parada: não dá a volta', () => {
    expect(navegar(EVO_P, 'frente')).toBeNull()
  })
})

describe('navegar para trás', () => {
  test('da subaba por posição volta para a subaba clássico, sem sair da evolução', () => {
    expect(navegar(EVO_P, 'tras')).toEqual(EVO_C)
  })

  test('só o segundo puxão para trás sai da evolução', () => {
    expect(navegar(EVO_C, 'tras')).toEqual(POSICAO)
  })

  test('do por posição volta para o clássico', () => {
    expect(navegar(POSICAO, 'tras')).toEqual(CLASSICO)
  })

  test('a primeira parada também é parada', () => {
    expect(navegar(CLASSICO, 'tras')).toBeNull()
  })
})

describe('a sequência é simétrica', () => {
  test('ir até o fim e voltar devolve ao ponto de partida', () => {
    const ida: Vista[] = [CLASSICO]
    for (let i = 0; i < 3; i++) ida.push(navegar(ida.at(-1)!, 'frente')!)
    expect(ida).toEqual([CLASSICO, POSICAO, EVO_C, EVO_P])

    const volta: Vista[] = [EVO_P]
    for (let i = 0; i < 3; i++) volta.push(navegar(volta.at(-1)!, 'tras')!)
    expect(volta).toEqual([EVO_P, EVO_C, POSICAO, CLASSICO])
  })

  test('a fila do gesto segue a ordem visual da barra de abas', () => {
    // A barra e a fila são duas listas declarando a mesma ordem. Reordenar uma
    // sem a outra dá uma navegação que contradiz o que está na tela e não
    // quebra nada — este teste é quem percebe.
    const fila: Vista[] = [{ aba: ABAS[0]!.id, bolao: 'classico' }]
    for (let passo = 0; passo < 20; passo++) {
      const proxima = navegar(fila.at(-1)!, 'frente')
      if (!proxima) break
      fila.push(proxima)
    }
    expect([...new Set(fila.map((v) => v.aba))]).toEqual(ABAS.map((t) => t.id))
  })

  test('fora da evolução a subaba lembrada não muda o caminho', () => {
    // Quem estava na Evolução/Por Posição e tocou na aba "Clássico" carrega a
    // subaba junto. O gesto seguinte tem que respeitar a ordem da tela, não a
    // memória da subaba.
    expect(navegar({ aba: 'classico', bolao: 'posicao' }, 'frente')).toEqual(POSICAO)
    expect(navegar({ aba: 'posicao', bolao: 'posicao' }, 'frente')).toEqual(EVO_C)
  })
})
