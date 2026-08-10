/**
 * Base comum dos scripts de infraestrutura: parâmetros em YAML, conversa com o
 * servidor e registro do que está acontecendo.
 *
 * Três princípios que valem para todos os scripts daqui:
 *
 *   1. **Parâmetro nunca é constante embutida.** Host, pasta, porta e política
 *      de retenção vêm de `infra/deploy.yml`. Trocar de servidor é editar um
 *      arquivo, não caçar strings em quatro scripts.
 *   2. **Leitura e escrita são coisas diferentes.** `ler()` sempre executa;
 *      `rodar()` respeita `--dry-run`. Assim a verificação prévia funciona
 *      inteira em modo seco, sem mentir sobre o estado do servidor.
 *   3. **Segredo não passa por disco nem por log.** O `.env` de produção sobe
 *      pela entrada padrão do ssh, com umask 077, e os logs mostram nomes de
 *      variáveis — nunca valores.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'

export const RAIZ = resolve(import.meta.dir, '../..')

// ─────────────────────────────────────────────────────────────
// Parâmetros
// ─────────────────────────────────────────────────────────────

const esquema = z.object({
  servidor: z.object({
    host: z.string().min(1),
    usuario: z.string().min(1),
    porta: z.number().int().min(1).max(65535).default(22),
    chave: z.string().nullable().default(null),
    pasta: z.string().startsWith('/'),
  }),
  aplicacao: z.object({
    nome: z.string().regex(/^[a-z][a-z0-9-]*$/),
    imagem: z.string().min(1),
    porta_publicada: z.number().int().min(1).max(65535),
    porta_interna: z.number().int().min(1).max(65535).default(3000),
    dominio: z.string().min(1),
    redes_externas: z.array(z.string().min(1)).min(1),
    memoria_web: z.string().regex(/^\d+[mg]$/),
    memoria_worker: z.string().regex(/^\d+[mg]$/),
    versoes_guardadas: z.number().int().min(1).max(20).default(3),
  }),
  banco: z.object({
    nome: z.string().regex(/^[a-z][a-z0-9_]*$/),
    container: z.string().min(1),
    credencial: z.string().startsWith('/'),
    extensoes: z.array(z.string()).default([]),
  }),
  cache: z.object({
    nome: z.string().regex(/^[a-z][a-z0-9_-]*$/),
    container: z.string().min(1),
    credencial: z.string().startsWith('/'),
    prefixo: z.string().min(1),
  }),
  ambiente: z.record(z.string(), z.union([z.string(), z.number()])),
  backup: z.object({
    pasta_local: z.string().min(1),
    modo: z.enum(['fresco', 'servidor']),
    pasta_servidor: z.string().startsWith('/'),
    retencao_dias: z.number().int().min(1).max(3650),
    minimo_guardado: z.number().int().min(1).max(1000),
    cron: z.string().min(9),
  }),
  deploy: z.object({
    cache: z.string().min(1),
    passos: z.array(z.enum(['migrate', 'seed', 'seed-dados', 'ciclo'])),
  }),
})

export type Parametros = z.infer<typeof esquema>

/** Mescla rasa por seção: o arquivo local sobrepõe chave por chave. */
function mesclar(base: Record<string, unknown>, extra: Record<string, unknown>) {
  const saida = { ...base }
  for (const [k, v] of Object.entries(extra)) {
    const atual = saida[k]
    saida[k] =
      atual && v && typeof atual === 'object' && typeof v === 'object' && !Array.isArray(v)
        ? { ...(atual as object), ...(v as object) }
        : v
  }
  return saida
}

export function carregarParametros(caminho = 'infra/deploy.yml'): Parametros {
  const principal = resolve(RAIZ, caminho)
  if (!existsSync(principal)) erro(`parâmetros não encontrados: ${principal}`)

  let bruto = Bun.YAML.parse(readFileSync(principal, 'utf8')) as Record<string, unknown>

  const local = resolve(RAIZ, 'infra/deploy.local.yml')
  if (existsSync(local)) {
    bruto = mesclar(bruto, Bun.YAML.parse(readFileSync(local, 'utf8')) as Record<string, unknown>)
    aviso('aplicando sobrescritas de infra/deploy.local.yml')
  }

  const r = esquema.safeParse(bruto)
  if (!r.success) {
    const linhas = r.error.issues.map((i) => `  ${i.path.join('.') || '(raiz)'}: ${i.message}`)
    erro(`infra/deploy.yml inválido:\n${linhas.join('\n')}`)
  }
  return r.data
}

// ─────────────────────────────────────────────────────────────
// Saída
// ─────────────────────────────────────────────────────────────

const cor = process.stdout.isTTY && !process.env.NO_COLOR
const c = (n: number, s: string) => (cor ? `\x1b[${n}m${s}\x1b[0m` : s)
export const negrito = (s: string) => c(1, s)
export const apagado = (s: string) => c(90, s)

let t0 = Date.now()
export function etapa(titulo: string) {
  t0 = Date.now()
  console.log(`\n${negrito(`▸ ${titulo}`)}`)
}
export const ok = (m: string) => console.log(`  ${c(32, '✓')} ${m}`)
export const info = (m: string) => console.log(`  ${apagado(m)}`)
export const aviso = (m: string) => console.log(`  ${c(33, '⚠')} ${m}`)
export const tempo = () => info(`${((Date.now() - t0) / 1000).toFixed(1)}s`)

export function erro(m: string): never {
  console.error(`\n${c(31, '✗')} ${m}\n`)
  process.exit(1)
}

export const seco = Bun.argv.includes('--dry-run')

/** Confirmação explícita para o que não dá para desfazer. */
export function exigirConfirmacao(esperado: string, oQue: string): void {
  const arg = Bun.argv.find((a) => a.startsWith('--confirmar'))
  const valor = arg?.includes('=') ? arg.split('=')[1] : undefined
  if (valor === esperado) return
  erro(
    `${oQue}\n  Isto sobrescreve dado que não volta. Para confirmar, repita o alvo:\n` +
      `      --confirmar=${esperado}`,
  )
}

// ─────────────────────────────────────────────────────────────
// Servidor
// ─────────────────────────────────────────────────────────────

export type Resultado = { codigo: number; saida: string; erroSaida: string }

export class Servidor {
  private readonly alvo: string
  private readonly opcoes: string[]

  constructor(private readonly p: Parametros) {
    this.alvo = `${p.servidor.usuario}@${p.servidor.host}`
    this.opcoes = [
      '-p',
      String(p.servidor.porta),
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      // Uma autenticação para todos os comandos do script. Um deploy dispara
      // umas vinte chamadas; sem isto são vinte handshakes.
      '-o',
      'ControlMaster=auto',
      '-o',
      `ControlPath=/tmp/.bolao-ssh-%r@%h:%p`,
      '-o',
      'ControlPersist=120',
      ...(p.servidor.chave ? ['-i', p.servidor.chave] : []),
    ]
  }

  get endereco() {
    return this.alvo
  }

  private async executar(
    comando: string,
    entrada?: string | Buffer,
    saidaCrua = false,
  ): Promise<Resultado & { bruto: Buffer }> {
    const proc = Bun.spawn(['ssh', ...this.opcoes, this.alvo, comando], {
      stdin: entrada === undefined ? 'ignore' : Buffer.from(entrada),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const bruto = Buffer.from(await new Response(proc.stdout).arrayBuffer())
    const erroSaida = await new Response(proc.stderr).text()
    const codigo = await proc.exited
    return { codigo, saida: saidaCrua ? '' : bruto.toString('utf8').trim(), erroSaida, bruto }
  }

  /** Leitura: roda sempre, inclusive em `--dry-run`. */
  async ler(comando: string): Promise<string> {
    const r = await this.executar(comando)
    if (r.codigo !== 0)
      erro(`comando remoto falhou (${r.codigo}):\n  ${comando}\n  ${r.erroSaida.trim()}`)
    return r.saida
  }

  /** Leitura tolerante: devolve o código em vez de abortar. */
  async tentar(comando: string): Promise<Resultado> {
    const r = await this.executar(comando)
    return { codigo: r.codigo, saida: r.saida, erroSaida: r.erroSaida }
  }

  /**
   * Roda um comando remoto alimentando a entrada padrão com bytes.
   *
   * É como um dump chega ao `pg_restore` sem passar pelo disco do servidor.
   * Devolve o código em vez de abortar: o pg_restore usa código 1 tanto para
   * falha real quanto para aviso ignorável, e quem chama precisa distinguir.
   */
  async tentarComEntrada(comando: string, entrada: Buffer): Promise<Resultado> {
    if (seco) {
      console.log(`  ${apagado('[seco]')} ${comando} (${entrada.length} bytes na entrada)`)
      return { codigo: 0, saida: '', erroSaida: '' }
    }
    const r = await this.executar(comando, entrada)
    return { codigo: r.codigo, saida: r.saida, erroSaida: r.erroSaida }
  }

  /** Escrita: respeita `--dry-run`. */
  async rodar(comando: string, descricao?: string): Promise<string> {
    if (seco) {
      console.log(`  ${apagado('[seco]')} ${descricao ?? comando}`)
      return ''
    }
    const r = await this.executar(comando)
    if (r.codigo !== 0)
      erro(
        `comando remoto falhou (${r.codigo}):\n  ${comando}\n  ${
          r.erroSaida.trim() || r.saida.trim()
        }`,
      )
    if (descricao) ok(descricao)
    return r.saida
  }

  /** Escreve um arquivo no servidor pela entrada padrão — nada toca o disco daqui. */
  async escreverArquivo(destino: string, conteudo: string, modo = '600'): Promise<void> {
    if (seco) {
      console.log(`  ${apagado('[seco]')} escreveria ${destino} (${conteudo.length} bytes)`)
      return
    }
    const r = await this.executar(`umask 077; cat > ${destino} && chmod ${modo} ${destino}`, conteudo)
    if (r.codigo !== 0) erro(`não consegui escrever ${destino}: ${r.erroSaida.trim()}`)
    ok(`${destino} (modo ${modo})`)
  }

  /**
   * Roda um comando remoto e devolve a saída binária intacta.
   *
   * Existe separado de `ler()` porque aquele decodifica como UTF-8 e recorta
   * espaços — o que estraga um dump do pg_dump em três bytes.
   */
  async capturarBytes(comando: string): Promise<Buffer> {
    const r = await this.executar(comando, undefined, true)
    if (r.codigo !== 0) erro(`comando remoto falhou (${r.codigo}):\n  ${comando}\n  ${r.erroSaida.trim()}`)
    return r.bruto
  }

  /** Baixa um arquivo do servidor. Devolve os bytes. */
  baixarBytes(remoto: string): Promise<Buffer> {
    return this.capturarBytes(`cat ${remoto}`)
  }

  /**
   * Envia um arquivo grande com rsync.
   *
   * `--inplace --no-whole-file` é o que torna o envio da imagem viável: o tar
   * muda pouco entre deploys, então o rsync manda só os blocos diferentes em
   * vez dos 400 MB inteiros.
   */
  async rsyncEnviar(local: string, remoto: string, extras: string[] = []): Promise<void> {
    const ssh = ['ssh', ...this.opcoes].join(' ')
    const args = [
      '-az',
      '--partial',
      '--inplace',
      '--no-whole-file',
      '--info=progress2',
      '-e',
      ssh,
      ...extras,
      local,
      `${this.alvo}:${remoto}`,
    ]
    if (seco) {
      console.log(`  ${apagado('[seco]')} rsync ${local} → ${remoto}`)
      return
    }
    const proc = Bun.spawn(['rsync', ...args], { stdout: 'inherit', stderr: 'inherit' })
    if ((await proc.exited) !== 0) erro(`rsync falhou: ${local} → ${remoto}`)
  }

  fechar(): void {
    // Encerra o canal multiplexado; sem isto o processo pode ficar preso
    // esperando o ControlPersist expirar.
    Bun.spawnSync(['ssh', ...this.opcoes, '-O', 'exit', this.alvo], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
  }
}

// ─────────────────────────────────────────────────────────────
// Local
// ─────────────────────────────────────────────────────────────

export async function local(
  comando: string[],
  opcoes: { cwd?: string; entrada?: string; silencioso?: boolean; aoVivo?: boolean } = {},
): Promise<string> {
  // `aoVivo` deixa o erro padrão passar direto: o BuildKit e o rsync escrevem o
  // progresso ali, e um deploy que fica minutos calado parece travado.
  const proc = Bun.spawn(comando, {
    cwd: opcoes.cwd ?? RAIZ,
    stdin: opcoes.entrada === undefined ? 'ignore' : Buffer.from(opcoes.entrada),
    stdout: opcoes.silencioso ? 'pipe' : 'inherit',
    stderr: opcoes.aoVivo ? 'inherit' : 'pipe',
  })
  const saida = opcoes.silencioso ? await new Response(proc.stdout).text() : ''
  const erroSaida = opcoes.aoVivo ? '' : await new Response(proc.stderr).text()
  const codigo = await proc.exited
  if (codigo !== 0)
    erro(`falhou (${codigo}): ${comando.join(' ')}${erroSaida ? `\n  ${erroSaida.trim()}` : ''}`)
  return saida.trim()
}

/** Igual, mas sem abortar: para checagens. */
export async function localTentar(comando: string[], cwd = RAIZ): Promise<Resultado> {
  const proc = Bun.spawn(comando, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const saida = await new Response(proc.stdout).text()
  const erroSaida = await new Response(proc.stderr).text()
  return { codigo: await proc.exited, saida: saida.trim(), erroSaida }
}

/** Lê um arquivo no formato `.env` para um mapa. Não valida — só transporta. */
export function lerEnv(caminho: string): Map<string, string> {
  const mapa = new Map<string, string>()
  if (!existsSync(caminho)) return mapa
  for (const linha of readFileSync(caminho, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha)
    if (!m) continue
    mapa.set(m[1]!, m[2]!.trim().replace(/^["'](.*)["']$/, '$1'))
  }
  return mapa
}

export const agora = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

export const tamanho = (bytes: number) => {
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}
