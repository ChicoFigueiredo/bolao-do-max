#!/usr/bin/env bun
/**
 * Gera `seeds/clubes-alias.json` — o mapa de como cada fonte escreve cada
 * clube.
 *
 * Casar clube entre fontes por string não funciona: a football-data.org diz
 * "CA Mineiro" onde o GE diz "Atlético-MG", e "Clube do Remo" onde o GE diz
 * "Remo". A cascata abaixo resolve o que dá para resolver com segurança e
 * IMPRIME o que sobrou, para entrar no arquivo à mão em vez de ser adivinhado.
 *
 *   1. nome idêntico depois de normalizar
 *   2. sigla igual, considerando só os que sobraram do passo 1
 *      (a colisão COR de Corinthians × Coritiba já foi resolvida pelo nome)
 *   3. o resto: reportado, nunca chutado
 *
 * O resultado é versionado e revisável, como `seeds/identidades.json`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { carregarConfig } from '@bolao/config'
import { montarProvedores } from '@bolao/provider'
import type { LinhaClassificacaoFonte } from '@bolao/provider'

const ARQUIVO = 'seeds/clubes-alias.json'

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(fc|ec|sc|ca|cr|se|rb|fr|fbc|fbpa|af|ac|clube|futebol|regatas|da|de|do)\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

const cfg = carregarConfig()
const provedores = montarProvedores(cfg)

const referencia = provedores.find((p) => p.nome === 'ge')
if (!referencia?.obterClassificacao) throw new Error('GE precisa estar habilitado — é a referência')

const canonica = await referencia.obterClassificacao(cfg.TEMPORADA_ATUAL, cfg.SERIE)
console.log(`referência: ${referencia.nome} · ${canonica.length} clubes\n`)

type Alias = { fonte: string; nome: string; canonico: string; via: string }
const aliases: Alias[] = []
const pendentes: { fonte: string; nome: string; sigla?: string }[] = []

for (const p of provedores) {
  if (p.nome === referencia.nome || !p.obterClassificacao) continue

  let outra: LinhaClassificacaoFonte[]
  try {
    outra = await p.obterClassificacao(cfg.TEMPORADA_ATUAL, cfg.SERIE)
  } catch (e) {
    console.log(`⚠ ${p.nome}: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    continue
  }

  const restamCanonicos = new Map(canonica.map((l) => [normalizar(l.clube), l]))
  const casados: Alias[] = []
  const sobrando: LinhaClassificacaoFonte[] = []

  for (const l of outra) {
    const k = normalizar(l.clube)
    const alvo = restamCanonicos.get(k)
    if (alvo) {
      casados.push({ fonte: p.nome, nome: l.clube, canonico: alvo.clube, via: 'nome' })
      restamCanonicos.delete(k)
    } else sobrando.push(l)
  }

  const porSigla = new Map(
    [...restamCanonicos.values()].filter((l) => l.ref.sigla).map((l) => [l.ref.sigla!, l]),
  )
  const aindaSobrando: LinhaClassificacaoFonte[] = []
  for (const l of sobrando) {
    const alvo = l.ref.sigla ? porSigla.get(l.ref.sigla) : undefined
    if (alvo) {
      casados.push({ fonte: p.nome, nome: l.clube, canonico: alvo.clube, via: 'sigla' })
      porSigla.delete(l.ref.sigla!)
    } else aindaSobrando.push(l)
  }

  aliases.push(...casados)
  pendentes.push(...aindaSobrando.map((l) => ({ fonte: p.nome, nome: l.clube, sigla: l.ref.sigla })))

  const porNome = casados.filter((c) => c.via === 'nome').length
  const porSiglaN = casados.filter((c) => c.via === 'sigla').length
  console.log(
    `${p.nome.padEnd(14)} ${casados.length}/${outra.length} casados ` +
      `(${porNome} por nome, ${porSiglaN} por sigla)` +
      (aindaSobrando.length ? ` · ${aindaSobrando.length} pendentes` : ''),
  )
  for (const c of casados.filter((x) => x.via === 'sigla'))
    console.log(`   sigla: ${c.nome} → ${c.canonico}`)
}

// Preserva o que já foi mapeado à mão em execuções anteriores.
const anteriores: Alias[] = existsSync(ARQUIVO) ? JSON.parse(readFileSync(ARQUIVO, 'utf8')) : []
const manuais = anteriores.filter((a) => a.via === 'manual')
const chave = (a: Alias) => `${a.fonte}|${a.nome}`
const jaTem = new Set(aliases.map(chave))
const finais = [...aliases, ...manuais.filter((m) => !jaTem.has(chave(m)))].sort(
  (a, b) => a.fonte.localeCompare(b.fonte) || a.canonico.localeCompare(b.canonico, 'pt-BR'),
)

writeFileSync(ARQUIVO, JSON.stringify(finais, null, 2) + '\n')
console.log(`\n✓ ${finais.length} apelidos em ${ARQUIVO}`)

if (pendentes.length) {
  const cobertos = new Set(manuais.map(chave))
  const faltam = pendentes.filter((p) => !cobertos.has(`${p.fonte}|${p.nome}`))
  if (faltam.length) {
    console.log(`\n⚠ ${faltam.length} sem mapeamento — adicione à mão com "via": "manual":`)
    for (const p of faltam)
      console.log(`    { "fonte": "${p.fonte}", "nome": "${p.nome}", "canonico": "???", "via": "manual" }`)
    process.exitCode = 1
  }
}
