#!/usr/bin/env bun
/**
 * Túnel SSH até o PostgreSQL de produção.
 *
 *   bun run tunel                 audita, abre 127.0.0.1:35132 e fica de pé
 *   bun run tunel --verificar     só audita a exposição, não abre nada
 *   bun run tunel --credencial    grava a senha num arquivo 600 para colar
 *   bun run tunel --fechar --confirmar=firewall   remove regra que abra a porta
 *
 * A ideia é que o banco **não tenha** porta na internet, e que o único caminho
 * até ele seja este túnel. Isso já vale hoje por duas razões independentes, e a
 * redundância é de propósito:
 *
 *   1. o docker publica em `127.0.0.1:5432`, então a regra de DNAT só casa com
 *      tráfego destinado ao loopback — não existe caminho pela rede pública
 *   2. o ufw está ativo com `default deny (incoming)` e libera só 22, 80 e 443
 *
 * Por isso este script **audita antes de abrir**, e audita de fora para dentro:
 * ler a configuração prova que a intenção está certa; tentar conectar na porta
 * pela internet prova o resultado. As duas coisas são diferentes, e é a segunda
 * que importa.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RAIZ,
  Servidor,
  apagado,
  aviso,
  carregarParametros,
  erro,
  etapa,
  exigirConfirmacao,
  info,
  localTentar,
  negrito,
  ok,
} from './comum.ts'

const p = carregarParametros()
const s = new Servidor(p)
const t = p.tunel
const tem = (f: string) => Bun.argv.includes(`--${f}`)

// ─────────────────────────────────────────────────────────────
// Auditoria
// ─────────────────────────────────────────────────────────────

/**
 * Tenta abrir a porta pela internet. Três respostas possíveis, e só uma é boa:
 *
 *   sem resposta  o pacote foi descartado — ninguém confirma que há algo ali
 *   recusado      alguém respondeu "não", o que já revela que a máquina existe
 *   aberto        problema
 */
async function daInternet(ip: string, porta: number): Promise<'aberto' | 'recusado' | 'descartado'> {
  return Promise.race([
    Bun.connect({
      hostname: ip,
      port: porta,
      socket: {
        data() {},
        open(c) {
          c.end()
        },
      },
    })
      .then(() => 'aberto' as const)
      .catch(() => 'recusado' as const),
    Bun.sleep(6000).then(() => 'descartado' as const),
  ])
}

type Achado = { grave: boolean; texto: string }

async function auditar(): Promise<Achado[]> {
  const achados: Achado[] = []
  etapa('exposição do banco')

  const ip = await s.ler('curl -s -4 --max-time 10 ifconfig.me || true')
  info(`servidor ${p.servidor.host} · ${ip}`)

  // 1. Publicação no loopback.
  const escuta = await s.ler(`ss -ltn | grep ':${t.alvo_porta} ' || true`)
  if (escuta.includes('127.0.0.1')) ok(`docker publica ${t.alvo_porta} só em 127.0.0.1`)
  else
    achados.push({
      grave: true,
      texto: `a porta ${t.alvo_porta} não está limitada ao loopback: ${escuta || '(ninguém escutando)'}`,
    })

  // 2. ufw com política de negar entrada.
  const ufw = await s.tentar('ufw status verbose 2>/dev/null || true')
  const ativo = /Status: active/.test(ufw.saida)
  const nega = /Default: deny \(incoming\)/.test(ufw.saida)
  if (ativo && nega) ok('ufw ativo, entrada negada por padrão')
  else achados.push({ grave: true, texto: `ufw ${ativo ? 'ativo mas sem deny por padrão' : 'inativo'}` })

  // 3. Nenhuma regra liberando as portas que devem ficar fechadas.
  const liberadas = t.portas_fechadas.filter((porta) =>
    new RegExp(`^${porta}(/tcp)?\\s+ALLOW`, 'm').test(ufw.saida),
  )
  if (!liberadas.length) ok(`nenhuma regra libera ${t.portas_fechadas.join(', ')}`)
  else achados.push({ grave: true, texto: `o ufw libera ${liberadas.join(', ')} — precisa sair` })

  // 4. A prova: tentar de fora, desta máquina.
  etapa('tentativa pela internet, daqui')
  for (const porta of t.portas_fechadas) {
    const r = await daInternet(ip, porta)
    if (r === 'aberto') achados.push({ grave: true, texto: `a porta ${porta} responde da internet` })
    else ok(`${porta} ${r === 'descartado' ? 'sem resposta (descartada)' : 'recusada'}`)
  }
  // Um controle positivo: se 22 também aparecesse fechada, o teste estaria
  // medindo a saída da minha rede e não a entrada do servidor.
  const ssh = await daInternet(ip, p.servidor.porta)
  if (ssh === 'aberto') info(`${p.servidor.porta} aberta, como tem de ser — o teste sabe distinguir`)
  else
    achados.push({
      grave: false,
      texto: `a porta ${p.servidor.porta} também não respondeu: o teste pode estar bloqueado na saída daqui, e o resultado acima não vale`,
    })

  return achados
}

async function fecharFirewall() {
  exigirConfirmacao('firewall', 'remoção de regras do ufw no servidor.')
  const ufw = await s.ler('ufw status numbered 2>/dev/null || true')
  const alvos = t.portas_fechadas.filter((x) => !t.intocaveis.includes(x))
  let removidas = 0
  for (const porta of alvos) {
    // Percorre de baixo para cima: apagar por número renumera o resto.
    const linhas = ufw
      .split('\n')
      .filter((l) => new RegExp(`\\b${porta}\\b`).test(l) && /ALLOW/.test(l))
      .map((l) => Number(/\[\s*(\d+)\]/.exec(l)?.[1]))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a)
    for (const n of linhas) {
      await s.rodar(`ufw --force delete ${n}`, `regra ${n} (porta ${porta}) removida`)
      removidas++
    }
  }
  if (!removidas) info('nenhuma regra a remover — o firewall já não libera essas portas')
  info(`${t.intocaveis.join(', ')} nunca são tocadas por este script`)
}

// ─────────────────────────────────────────────────────────────
// Túnel
// ─────────────────────────────────────────────────────────────

async function credencialDoServidor(): Promise<{ url: string; usuario: string; banco: string }> {
  const bruto = (await s.baixarBytes(p.banco.credencial)).toString('utf8')
  const linha = /^DATABASE_URL_LOCAL=(.+)$/m.exec(bruto)?.[1]?.trim()
  if (!linha) erro(`${p.banco.credencial} não tem DATABASE_URL_LOCAL`)
  // A credencial do servidor aponta para a porta de lá; aqui vale a daqui.
  const url = linha.replace(`:${t.alvo_porta}/`, `:${t.porta_local}/`)
  const m = /\/\/([^:]+):[^@]+@[^/]+\/(.+)$/.exec(url)
  return { url, usuario: m?.[1] ?? 'bolao', banco: m?.[2] ?? p.banco.nome }
}

const mascarar = (url: string) => url.replace(/:([^:@/]+)@/, ':***@')

async function abrirTunel() {
  // Porta livre? Sem isto o ssh sobe e o encaminhamento falha em silêncio —
  // daí o ExitOnForwardFailure logo abaixo, que é a rede de segurança.
  const ocupada = await localTentar(['sh', '-c', `ss -ltn | grep -c ':${t.porta_local} ' || true`])
  if (ocupada.saida.trim() !== '0')
    erro(
      `a porta ${t.porta_local} já está em uso nesta máquina.\n` +
        `  Se for um túnel seu de antes: pkill -f 'ssh -N -L ${t.porta_local}:'`,
    )

  const cred = await credencialDoServidor()

  etapa(`túnel 127.0.0.1:${t.porta_local} → ${t.alvo_host}:${t.alvo_porta}`)
  const args = [
    '-N',
    // Falha alto se o encaminhamento não subir, em vez de fingir que subiu.
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'BatchMode=yes',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-p',
    String(p.servidor.porta),
    // Amarrado ao loopback de propósito: um túnel em 0.0.0.0 republicaria o
    // banco de produção para a rede local, que é o oposto do objetivo.
    '-L',
    `127.0.0.1:${t.porta_local}:${t.alvo_host}:${t.alvo_porta}`,
    ...(p.servidor.chave ? ['-i', p.servidor.chave] : []),
    `${p.servidor.usuario}@${p.servidor.host}`,
  ]

  const proc = Bun.spawn(['ssh', ...args], { stdout: 'inherit', stderr: 'inherit' })

  // Espera o encaminhamento aceitar conexão antes de dizer que está pronto.
  let pronto = false
  for (let i = 0; i < 30 && !pronto; i++) {
    await Bun.sleep(200)
    pronto = await Bun.connect({
      hostname: '127.0.0.1',
      port: t.porta_local,
      socket: {
        data() {},
        open(c) {
          c.end()
        },
      },
    })
      .then(() => true)
      .catch(() => false)
  }
  if (!pronto) {
    proc.kill()
    erro('o túnel não passou a aceitar conexão — veja a mensagem do ssh acima')
  }
  ok('túnel aberto')

  // Prova de vida do outro lado: uma consulta de verdade, não um TCP que abriu.
  const postgres = (await import('postgres')).default
  const sql = postgres(cred.url, { max: 1, idle_timeout: 5, onnotice: () => {} })
  try {
    const [linha] = await sql<
      { versao: string; banco: string; snapshots: number }[]
    >`select version() as versao, current_database() as banco,
             (select count(*)::int from snapshot) as snapshots`
    ok(`${linha!.banco} respondeu · ${linha!.snapshots} snapshots`)
    info(linha!.versao.split(' on ')[0]!)
  } catch (e) {
    proc.kill()
    erro(`o túnel abriu mas o banco não respondeu: ${e instanceof Error ? e.message : e}`)
  } finally {
    await sql.end({ timeout: 5 })
  }

  etapa('para colar no cliente')
  console.log(`  host      127.0.0.1`)
  console.log(`  porta     ${t.porta_local}`)
  console.log(`  banco     ${cred.banco}`)
  console.log(`  usuário   ${cred.usuario}`)
  console.log(`  senha     ${apagado('em arquivo — ver abaixo')}`)
  console.log(`\n  ${apagado(mascarar(cred.url))}`)

  /*
   * A senha vai para arquivo, nunca para a tela.
   *
   * A primeira versão deste script tinha `--credencial` que imprimia a senha no
   * terminal. Rodei uma vez para conferir e a senha do banco de produção foi
   * parar no histórico do terminal e num arquivo de log — que é exatamente o
   * modo como segredo escapa. Arquivo em modo 600 numa pasta gitignored dá para
   * copiar e colar sem deixar rastro em scrollback nem em log de terminal.
   */
  if (tem('credencial')) {
    mkdirSync(resolve(RAIZ, p.deploy.cache), { recursive: true })
    const alvo = resolve(RAIZ, p.deploy.cache, 'conexao.txt')
    writeFileSync(alvo, `${cred.url}\n`, { mode: 0o600 })
    ok(`credencial em ${alvo} (modo 600, pasta gitignored)`)
    if (await temPsql()) info(`psql "$(cat ${alvo})"`)
    info('apague quando não precisar mais: rm ' + alvo)
  } else {
    info('--credencial grava a senha num arquivo 600 para copiar')
  }

  console.log(`\n${negrito('o túnel fica aberto enquanto este processo viver')} — Ctrl-C encerra.`)

  const encerrar = () => {
    console.log('\nencerrando o túnel')
    proc.kill()
    s.fechar()
    process.exit(0)
  }
  process.on('SIGINT', encerrar)
  process.on('SIGTERM', encerrar)

  const codigo = await proc.exited
  if (codigo !== 0) erro(`o ssh encerrou com código ${codigo}`)
}

const temPsql = async () => (await localTentar(['sh', '-c', 'command -v psql'])).codigo === 0

/** Deixa rastro de quando o banco de produção foi alcançado, e por quem. */
function registrar(texto: string) {
  try {
    appendFileSync(
      `${p.backup.pasta_local}/tunel.log`,
      `${new Date().toISOString()} ${texto}\n`,
    )
  } catch {
    /* pasta pode não existir ainda — o log é conveniência, não requisito */
  }
}

// ─────────────────────────────────────────────────────────────

try {
  if (tem('fechar')) {
    await fecharFirewall()
  } else {
    const achados = await auditar()
    const graves = achados.filter((a) => a.grave)
    for (const a of achados) aviso(a.texto)

    if (graves.length && !tem('mesmo-assim'))
      erro(
        `${graves.length} problema(s) de exposição — o túnel existe justamente para a porta ficar fechada.\n` +
          `  Corrigir:  bun run tunel --fechar --confirmar=firewall\n` +
          `  Ignorar:   bun run tunel --mesmo-assim`,
      )

    if (tem('verificar')) {
      console.log(`\n${negrito('nada aberto para a internet')} — o único caminho é este túnel.`)
    } else {
      registrar(`túnel aberto em 127.0.0.1:${t.porta_local}`)
      await abrirTunel()
    }
  }
} finally {
  s.fechar()
}
