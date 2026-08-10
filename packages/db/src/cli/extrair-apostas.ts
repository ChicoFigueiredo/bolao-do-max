#!/usr/bin/env bun
/**
 * Extrai as apostas de 2018–2026 dos arquivos legados para `seeds/apostas/`.
 *
 * Migração de mão única: roda uma vez, o resultado é versionado e revisado.
 * A partir daí a fonte da verdade é o seed, não o JSON antigo.
 *
 * Dois problemas reais nos dados de origem:
 *
 * 1. `bolao.2024.json` é JSON inválido — vírgula sobrando antes do `]` na
 *    linha 3601. Reparado na leitura.
 * 2. O mesmo apostador aparece com grafias diferentes a cada ano
 *    (`Chico`, `Chico 'Virus'`, `Chico 'Vírus'`, `Chico Vírus`). A
 *    consolidação usa o critério de §identidade abaixo e imprime tudo que
 *    uniu, para poder ser conferido.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ORIGEM = 'z_legado/bolao-max-server/json'
const DESTINO = 'seeds/apostas'

type ClubeLegado = { Grupo: string; Clube: string; Coracao?: boolean }
type PalpiteLegado = { Clube: string; posicao: number }
type CompetidorLegado = {
  Nome: string
  Clubes: ClubeLegado[]
  PalpitesPosicao?: PalpiteLegado[]
}

// ── Leitura tolerante ────────────────────────────────────────

function lerLegado(arquivo: string): { competidores: CompetidorLegado[]; reparado: boolean } {
  const cru = readFileSync(arquivo, 'utf8')
  const limpo = cru.replace(/,(\s*[\]}])/g, '$1')
  const d = JSON.parse(limpo) as { Competidores: CompetidorLegado[] }
  return { competidores: d.Competidores, reparado: cru !== limpo }
}

// ── Identidade entre temporadas ──────────────────────────────

/** Minúsculas, sem acento, sem aspas, sem apelido entre aspas. */
function normalizar(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['"`´]/g, '')
    .toLowerCase()
    .trim()
}

function distancia(a: string, b: string): number {
  if (a === b) return 0
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) m[0]![j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i]![j] = Math.min(
        m[i - 1]![j]! + 1,
        m[i]![j - 1]! + 1,
        m[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
  return m[a.length]![b.length]!
}

/**
 * Dois nomes são a mesma pessoa quando, ignorando acentos e apelidos:
 *   · o primeiro nome é igual, ou está a uma letra de distância; **e**
 *   · eles nunca aparecem juntos na mesma temporada.
 *
 * A segunda condição é a salvaguarda: se dois nomes parecidos coexistem num
 * ano, são pessoas diferentes e não podem ser unidos.
 */
function consolidarIdentidades(porAno: Map<number, CompetidorLegado[]>) {
  const anosPorNome = new Map<string, Set<number>>()
  for (const [ano, comps] of porAno)
    for (const c of comps) {
      if (!anosPorNome.has(c.Nome)) anosPorNome.set(c.Nome, new Set())
      anosPorNome.get(c.Nome)!.add(ano)
    }

  const nomes = [...anosPorNome.keys()].sort()
  const canonicoDe = new Map<string, string>()
  const grupos: string[][] = []

  for (const nome of nomes) {
    const primeiro = normalizar(nome).split(/\s+/)[0]!
    const anos = anosPorNome.get(nome)!

    const alvo = grupos.find((g) => {
      const conflita = g.some((outro) => {
        const anosOutro = anosPorNome.get(outro)!
        return [...anos].some((a) => anosOutro.has(a))
      })
      if (conflita) return false
      return g.some((outro) => {
        const p = normalizar(outro).split(/\s+/)[0]!
        return distancia(p, primeiro) <= 1
      })
    })

    if (alvo) alvo.push(nome)
    else grupos.push([nome])
  }

  // Canônico = a grafia usada na temporada mais recente, salvo preferência
  // explícita em `seeds/nomes-canonicos.json`. O apelido do grupo é escolha de
  // quem joga, não do algoritmo — 2026 registra "Chico", mas o nome pelo qual
  // ele é conhecido no bolão é "Chico 'Virus'".
  const preferido = new Map<string, string>()
  try {
    const lista = JSON.parse(readFileSync('seeds/nomes-canonicos.json', 'utf8')) as {
      de: string
      para: string
    }[]
    for (const p of lista) preferido.set(p.de, p.para)
  } catch {
    /* arquivo opcional */
  }

  for (const g of grupos) {
    const maisRecente = g.reduce((melhor, n) =>
      Math.max(...anosPorNome.get(n)!) > Math.max(...anosPorNome.get(melhor)!) ? n : melhor,
    )
    const canonico = preferido.get(maisRecente) ?? maisRecente
    for (const n of g) canonicoDe.set(n, canonico)
  }

  return { canonicoDe, grupos, anosPorNome }
}

// ── Execução ─────────────────────────────────────────────────

const arquivos = readdirSync(ORIGEM)
  .filter((f) => /^bolao\.(\d{4})\.json$/.test(f))
  .map((f) => ({ ano: Number(/^bolao\.(\d{4})\.json$/.exec(f)![1]), arquivo: join(ORIGEM, f) }))
arquivos.push({ ano: 2026, arquivo: join(ORIGEM, 'bolao.json') })
arquivos.sort((a, b) => a.ano - b.ano)

const porAno = new Map<number, CompetidorLegado[]>()
const reparados: number[] = []
for (const { ano, arquivo } of arquivos) {
  const { competidores, reparado } = lerLegado(arquivo)
  porAno.set(ano, competidores)
  if (reparado) reparados.push(ano)
}

const { canonicoDe, grupos, anosPorNome } = consolidarIdentidades(porAno)

mkdirSync(DESTINO, { recursive: true })

console.log('temporada  competidores  palpites  clubes  reparo')
let totalApostas = 0
for (const [ano, comps] of [...porAno].sort((a, b) => a[0] - b[0])) {
  const temPosicao = comps.some((c) => c.PalpitesPosicao?.length)
  const clubes = new Set(comps.flatMap((c) => c.Clubes.map((t) => t.Clube)))

  const seed = {
    temporada: ano,
    serie: 'A',
    temClassico: true,
    temPosicao,
    competidores: comps.map((c) => ({
      nome: canonicoDe.get(c.Nome)!,
      nomeNaTemporada: c.Nome,
      clubes: c.Clubes.map((t) => ({
        grupo: t.Grupo,
        clube: t.Clube,
        coracao: Boolean(t.Coracao),
      })),
      palpites: (c.PalpitesPosicao ?? []).map((p) => ({ clube: p.Clube, posicao: p.posicao })),
    })),
  }

  writeFileSync(join(DESTINO, `${ano}.json`), JSON.stringify(seed, null, 2) + '\n')
  totalApostas += comps.length
  console.log(
    `${ano}       ${String(comps.length).padStart(6)}  ` +
      `${String(temPosicao ? comps.length : 0).padStart(8)}  ` +
      `${String(clubes.size).padStart(6)}  ${reparados.includes(ano) ? 'sim' : '-'}`,
  )
}

const identidades = grupos
  .filter((g) => g.length > 1)
  .map((g) => {
    const canonico = canonicoDe.get(g[0]!)!
    return {
      canonico,
      apelidos: g
        .filter((n) => n !== canonico)
        .map((n) => ({ nome: n, temporadas: [...anosPorNome.get(n)!].sort() })),
    }
  })
  .concat(
    // Um canônico preferido que não aparece em nenhuma temporada ainda precisa
    // registrar a grafia real de cada ano como apelido.
    grupos
      .filter((g) => g.length === 1 && canonicoDe.get(g[0]!) !== g[0]!)
      .map((g) => ({
        canonico: canonicoDe.get(g[0]!)!,
        apelidos: [{ nome: g[0]!, temporadas: [...anosPorNome.get(g[0]!)!].sort() }],
      })),
  )
  .sort((a, b) => a.canonico.localeCompare(b.canonico, 'pt-BR'))

writeFileSync(join('seeds', 'identidades.json'), JSON.stringify(identidades, null, 2) + '\n')

console.log()
console.log(`${totalApostas} apostas em ${porAno.size} temporadas`)
console.log(`${anosPorNome.size} grafias → ${grupos.length} pessoas`)
if (reparados.length) console.log(`JSON reparado em: ${reparados.join(', ')}`)
console.log()
console.log('=== identidades consolidadas (conferir) ===')
for (const i of identidades)
  console.log(
    `  ${i.canonico.padEnd(20)} ← ${i.apelidos.map((a) => `${a.nome} (${a.temporadas.join(',')})`).join('  ·  ')}`,
  )
