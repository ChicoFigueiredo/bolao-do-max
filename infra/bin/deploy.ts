#!/usr/bin/env bun
/**
 * Deploy do Bolão do Max: constrói aqui, envia o que mudou, sobe lá.
 *
 *   bun run deploy --dry-run      mostra o plano inteiro sem tocar em nada
 *   bun run deploy                constrói, envia, migra, semeia, sobe
 *   bun run deploy --sem-imagem   só reaplica configuração e passos
 *   bun run deploy --versoes      lista o que está carregado no servidor
 *   bun run deploy --reverter     volta para a versão anterior
 *
 * Três decisões que moldam este script:
 *
 * **A imagem é construída aqui.** O servidor tem 2 vCPU e 2,8 GB livres com
 * oito containers; `next build` lá competiria com os vizinhos. O que viaja é
 * imagem pronta — e viaja por rsync sobre o mesmo arquivo tar de sempre, então
 * do segundo deploy em diante sobem só os blocos que mudaram, não 400 MB.
 *
 * **As credenciais nascem no servidor.** Banco e cache são compartilhados e têm
 * scripts próprios (`/opt/banco/scripts/novo-banco.sh`, `novo-cache.sh`) que
 * criam database, role e usuário ACL e guardam a senha em modo 600. Este script
 * chama esses scripts e LÊ o resultado; nunca inventa senha nem a versiona.
 *
 * **Nada do bolão atual é tocado.** Pasta, rede, porta, domínio e Redis são
 * outros. Antes da virada do nginx, voltar atrás é não fazer nada.
 */
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  RAIZ,
  Servidor,
  apagado,
  aviso,
  carregarParametros,
  erro,
  etapa,
  info,
  lerEnv,
  local,
  localTentar,
  negrito,
  ok,
  seco,
  tamanho,
  tempo,
} from './comum.ts'

const p = carregarParametros()
const s = new Servidor(p)
const PASTA = p.servidor.pasta
const compose = (args: string) => `cd ${PASTA} && docker compose ${args}`

const arg = (nome: string) => {
  const a = Bun.argv.find((x) => x === `--${nome}` || x.startsWith(`--${nome}=`))
  if (!a) return undefined
  return a.includes('=') ? a.split('=').slice(1).join('=') : ''
}

const ZONA_LIMITES = '/etc/nginx/conf.d/bolao-limites.conf'
const CONTEUDO_ZONA = `# Escrito por infra/bin/deploy.ts --limites.
#
# Declarar a zona não limita nada sozinho: só passa a valer no vhost que a
# referencia com \`limit_req\`. Enquanto nenhum referenciar, este arquivo é
# inerte para os outros vhosts da máquina.
limit_req_zone $binary_remote_addr zone=bolao:10m rate=20r/s;
`
const REGRA_LIMITES = [
  '\t\tlimit_req zone=bolao burst=40 nodelay;',
  '\t\tlimit_req_status 429;',
].join('\n')

try {
  if (arg('versoes') !== undefined) await listarVersoes()
  else if (arg('reverter') !== undefined) await reverter(arg('reverter') || undefined)
  else await deployar()
} finally {
  s.fechar()
}

// ─────────────────────────────────────────────────────────────

async function versoesNoServidor(): Promise<string[]> {
  const saida = await s.ler(
    `docker images --format '{{.Tag}}\t{{.CreatedAt}}' ${p.aplicacao.imagem} 2>/dev/null || true`,
  )
  return saida
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t')[0]!)
    .filter((t) => t && t !== '<none>')
}

async function versaoNoAr(): Promise<string | null> {
  const r = await s.tentar(`grep -m1 '^BOLAO_VERSAO=' ${PASTA}/.env 2>/dev/null || true`)
  return r.saida.split('=')[1]?.trim() || null
}

async function listarVersoes() {
  etapa(`versões em ${p.servidor.host}`)
  const noAr = await versaoNoAr()
  const versoes = await versoesNoServidor()
  if (!versoes.length) return info('nenhuma imagem carregada ainda')
  for (const v of versoes) console.log(`  ${v === noAr ? negrito(`${v}  ← no ar`) : v}`)
}

async function reverter(alvo?: string) {
  etapa('retorno para a versão anterior')
  const noAr = await versaoNoAr()
  const versoes = await versoesNoServidor()
  if (!versoes.length) erro('nenhuma imagem carregada no servidor — nada para onde voltar')

  // `docker images` já devolve da mais nova para a mais antiga.
  const escolhida = alvo ?? versoes.find((v) => v !== noAr)
  if (!escolhida) erro(`só existe a versão ${noAr} no servidor — nada para onde voltar`)
  if (!versoes.includes(escolhida))
    erro(`versão ${escolhida} não está carregada no servidor. Disponíveis: ${versoes.join(', ')}`)

  info(`no ar: ${noAr ?? '(nenhuma)'} → voltando para ${escolhida}`)
  await s.rodar(
    `cd ${PASTA} && sed -i 's|^BOLAO_VERSAO=.*|BOLAO_VERSAO=${escolhida}|' .env`,
    `.env aponta para ${escolhida}`,
  )
  await s.rodar(compose('up -d'), 'containers recriados')
  await esperarSaude()
  ok(`de volta em ${escolhida}`)
  info('o dado no banco não foi tocado — só a imagem que o lê')
}

// ─────────────────────────────────────────────────────────────

async function deployar() {
  const versao = arg('versao') || (await calcularVersao())

  etapa('verificação prévia')
  await verificar()

  etapa('banco e cache do projeto')
  const credenciais = await prepararDependencias()

  etapa(`configuração de produção · versão ${versao}`)
  const ambiente = await montarAmbiente(credenciais, versao)
  await s.rodar(`mkdir -p ${PASTA}`, `${PASTA} pronta`)
  await s.escreverArquivo(`${PASTA}/.env`, ambiente)
  await s.rsyncEnviar(resolve(RAIZ, 'infra/compose.prod.yml'), `${PASTA}/compose.yml`)
  if (!seco) ok(`${PASTA}/compose.yml`)

  if (arg('sem-imagem') === undefined) {
    etapa(`construção da imagem ${p.aplicacao.imagem}:${versao}`)
    await construir(versao)
    tempo()

    etapa('envio para o servidor')
    await enviar(versao)
    tempo()
  } else {
    aviso('--sem-imagem: usando a imagem que já está no servidor')
    const versoes = await versoesNoServidor()
    if (!versoes.includes(versao))
      erro(`a imagem ${p.aplicacao.imagem}:${versao} não está no servidor. Rode sem --sem-imagem.`)
  }

  etapa('banco de dados e dado inicial')
  await passos()

  etapa('subindo')
  await s.rodar(compose('up -d --remove-orphans'), 'web e worker no ar')
  await esperarSaude()

  etapa('nginx e TLS')
  await publicarVhost()

  etapa('limites de requisição')
  await aplicarLimites()

  etapa('conferência')
  await conferir()

  etapa('limpeza')
  await limparVersoes(versao)

  resumo(versao)
}

async function calcularVersao(): Promise<string> {
  const sha = await local(['git', 'rev-parse', '--short', 'HEAD'], { silencioso: true })
  const sujo = await localTentar(['git', 'status', '--porcelain'])
  const marca = sujo.saida.trim() ? '-sujo' : ''
  return `${sha}${marca}`
}

async function verificar() {
  // Local
  if (!existsSync(resolve(RAIZ, '.env')))
    erro('.env não existe na raiz — é de lá que saem as chaves das APIs de futebol')
  const docker = await localTentar(['docker', 'info', '--format', '{{.ServerVersion}}'])
  if (docker.codigo !== 0) erro('docker não respondeu nesta máquina — a imagem é construída aqui')
  ok(`docker local ${docker.saida}`)

  const sujo = await localTentar(['git', 'status', '--porcelain'])
  if (sujo.saida.trim())
    aviso(
      `árvore de trabalho suja (${sujo.saida.trim().split('\n').length} arquivos) — ` +
        `a versão sai marcada como -sujo`,
    )

  // Servidor
  const versaoDocker = await s.ler('docker version --format "{{.Server.Version}}"')
  ok(`ssh e docker no servidor ${versaoDocker}`)

  for (const rede of p.aplicacao.redes_externas) {
    const r = await s.tentar(`docker network inspect ${rede} --format '{{.Name}}'`)
    if (r.codigo !== 0)
      erro(`a rede externa ${rede} não existe no servidor — o compose não sobe sem ela`)
  }
  ok(`redes ${p.aplicacao.redes_externas.join(', ')}`)

  for (const nome of [p.banco.container, p.cache.container]) {
    const r = await s.tentar(`docker inspect -f '{{.State.Running}}' ${nome}`)
    if (r.saida !== 'true') erro(`o container compartilhado ${nome} não está rodando`)
  }
  ok(`containers ${p.banco.container} e ${p.cache.container} de pé`)

  // A porta pode estar tomada por outro projeto; descobrir agora é melhor que
  // descobrir no `up`.
  const porta = await s.tentar(
    `ss -ltn 2>/dev/null | grep -q '127.0.0.1:${p.aplicacao.porta_publicada} ' && echo tomada || echo livre`,
  )
  const jaNossa = await s.tentar(
    `docker ps --format '{{.Names}} {{.Ports}}' | grep ':${p.aplicacao.porta_publicada}->' | grep -c bolao-do-max || true`,
  )
  if (porta.saida === 'tomada' && jaNossa.saida.trim() === '0')
    erro(`a porta ${p.aplicacao.porta_publicada} do servidor já está em uso por outro projeto`)
  ok(`porta ${p.aplicacao.porta_publicada} ${porta.saida === 'tomada' ? '(já é nossa)' : 'livre'}`)

  const livre = await s.ler(`df -BG --output=avail / | tail -1 | tr -dc '0-9'`)
  if (Number(livre) < 5) erro(`só ${livre} GB livres no servidor — a imagem precisa de folga`)
  info(`${livre} GB livres no servidor`)

  const antigo = await s.tentar(`docker inspect -f '{{.State.Running}}' bolao.maxmat1.com.br`)
  if (antigo.saida === 'true') info('o bolão atual continua no ar, intocado (porta 5001)')
}

/**
 * Cria — se ainda não existirem — o database e o usuário de cache do projeto,
 * e devolve as credenciais que o próprio servidor gerou.
 *
 * Os dois scripts são idempotentes por decisão da máquina: se já existe, saem
 * com 0 e apontam o arquivo de credencial. Chamar em todo deploy é de graça e
 * remove um passo manual do runbook.
 */
async function prepararDependencias(): Promise<{ DATABASE_URL: string; REDIS_URL: string }> {
  const extensoes = p.banco.extensoes.join(' ')
  await s.rodar(
    `/opt/banco/scripts/novo-banco.sh ${p.banco.nome} ${extensoes} 2>&1 | tail -2 || true`,
    `database e role '${p.banco.nome}' garantidos`,
  )
  await s.rodar(
    `/opt/cache/scripts/novo-cache.sh ${p.cache.nome} >/dev/null 2>&1 || true`,
    `usuário ACL de cache '${p.cache.nome}' garantido`,
  )

  if (seco) {
    info('[seco] credenciais seriam lidas de:')
    info(`  ${p.banco.credencial}`)
    info(`  ${p.cache.credencial}`)
    return { DATABASE_URL: 'postgres://seco', REDIS_URL: 'redis://seco' }
  }

  const doBanco = lerEnvRemoto(await s.baixarBytes(p.banco.credencial))
  const doCache = lerEnvRemoto(await s.baixarBytes(p.cache.credencial))
  const DATABASE_URL = doBanco.get('DATABASE_URL')
  const REDIS_URL = doCache.get('REDIS_URL')
  if (!DATABASE_URL) erro(`${p.banco.credencial} não tem DATABASE_URL`)
  if (!REDIS_URL) erro(`${p.cache.credencial} não tem REDIS_URL`)

  // Endereço e usuário, nunca a senha.
  ok(`DATABASE_URL → ${DATABASE_URL.replace(/:[^:@/]*@/, ':***@')}`)
  ok(`REDIS_URL → ${REDIS_URL.replace(/:[^:@/]*@/, ':***@')}`)

  // A ACL do cache só libera chaves com o prefixo do projeto. Um prefixo
  // divergente daria erro de permissão em toda escrita, e só em produção.
  if (!p.cache.prefixo.startsWith(`${p.cache.nome}:`))
    erro(
      `o prefixo '${p.cache.prefixo}' não começa com '${p.cache.nome}:' — ` +
        `a ACL do Redis compartilhado recusaria toda escrita`,
    )
  return { DATABASE_URL, REDIS_URL }
}

function lerEnvRemoto(bytes: Buffer): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const linha of bytes.toString('utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(linha)
    if (m) mapa.set(m[1]!, m[2]!.trim())
  }
  return mapa
}

/**
 * Monta o `.env` de produção em memória.
 *
 * Camadas, da base ao topo: o `.env` local (de onde vêm as chaves das APIs), o
 * bloco `ambiente` do YAML, as credenciais que o servidor gerou, e por último
 * o `.env.producao` local, se existir. O resultado passa pela MESMA validação
 * que a aplicação faz no boot — descobrir que falta variável aqui custa
 * segundos; descobrir em produção custa um container em laço de reinício.
 */
async function montarAmbiente(
  cred: { DATABASE_URL: string; REDIS_URL: string },
  versao: string,
): Promise<string> {
  const base = lerEnv(resolve(RAIZ, '.env'))
  const mapa = new Map(base)

  for (const [k, v] of Object.entries(p.ambiente)) {
    if (k === 'arquivo_extra') continue
    mapa.set(k, String(v))
  }

  mapa.set('DATABASE_URL', cred.DATABASE_URL)
  mapa.set('REDIS_URL', cred.REDIS_URL)
  mapa.set('REDIS_PREFIX', p.cache.prefixo)

  const extra = p.ambiente.arquivo_extra ? lerEnv(resolve(RAIZ, String(p.ambiente.arquivo_extra))) : new Map()
  for (const [k, v] of extra) mapa.set(k, v)
  if (extra.size) ok(`${extra.size} variáveis de ${p.ambiente.arquivo_extra}: ${[...extra.keys()].join(', ')}`)

  // Interpolação do compose. É aqui que fica registrado o que está no ar.
  const doCompose = {
    BOLAO_IMAGEM: p.aplicacao.imagem,
    BOLAO_VERSAO: versao,
    BOLAO_PORTA: String(p.aplicacao.porta_publicada),
    BOLAO_MEM_WEB: p.aplicacao.memoria_web,
    BOLAO_MEM_WORKER: p.aplicacao.memoria_worker,
  }

  const vazias = [...mapa].filter(([k, v]) => k.endsWith('_KEY') && !v).map(([k]) => k)
  if (vazias.length) aviso(`sem valor: ${vazias.join(', ')} — a fonte correspondente ficará fora`)

  await validarAmbiente(mapa)

  const corpo = [
    `# Gerado por infra/bin/deploy.ts — não edite à mão.`,
    `# Versão no ar e parâmetros do compose ficam nas linhas BOLAO_*.`,
    `# Segredos: modo 600, fora do git, gerados pelo próprio servidor.`,
    ``,
    ...Object.entries(doCompose).map(([k, v]) => `${k}=${v}`),
    ``,
    ...[...mapa].map(([k, v]) => `${k}=${v}`),
    ``,
  ].join('\n')

  info(`${mapa.size} variáveis de aplicação + ${Object.keys(doCompose).length} do compose`)
  return corpo
}

/** Roda a validação real de `@bolao/config` contra o ambiente montado. */
async function validarAmbiente(mapa: Map<string, string>) {
  // cwd numa pasta sem `.env`: o Bun carrega o `.env` do diretório corrente
  // automaticamente, e isso mascararia justamente a variável que falta.
  const vazia = resolve(RAIZ, 'infra/.cache/validacao')
  mkdirSync(vazia, { recursive: true })

  const proc = Bun.spawn(
    ['bun', '--env-file=/dev/null', '-e', 'import {carregarConfig} from "@bolao/config"; carregarConfig()'],
    {
      cwd: vazia,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...Object.fromEntries(mapa) },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const saidaErro = await new Response(proc.stderr).text()
  if ((await proc.exited) !== 0)
    erro(`o .env de produção não passa na validação da aplicação:\n${saidaErro.trim()}`)
  ok('configuração validada pelo mesmo zod que roda no boot')
}

async function construir(versao: string) {
  const cmd = [
    'docker',
    'build',
    '-f',
    'infra/Dockerfile',
    '-t',
    `${p.aplicacao.imagem}:${versao}`,
    '-t',
    `${p.aplicacao.imagem}:mais-recente`,
    '.',
  ]
  if (seco) return info(`[seco] ${cmd.join(' ')}`)

  await local(cmd, { aoVivo: true })
  const tam = await local(
    ['docker', 'image', 'inspect', `${p.aplicacao.imagem}:${versao}`, '--format', '{{.Size}}'],
    { silencioso: true },
  )
  ok(`imagem construída · ${tamanho(Number(tam))}`)
}

/**
 * Envia a imagem por rsync sobre o mesmo tar de sempre.
 *
 * `docker save | ssh docker load` manda a imagem inteira toda vez. Gravando
 * sempre no mesmo arquivo e deixando uma cópia nas duas pontas, o rsync compara
 * blocos e manda só a diferença — que entre dois deploys da mesma base é uma
 * fração dos 400 MB.
 */
async function enviar(versao: string) {
  const cache = resolve(RAIZ, p.deploy.cache)
  mkdirSync(cache, { recursive: true })
  const tar = resolve(cache, `${p.aplicacao.imagem}.tar`)

  if (seco) {
    info(`[seco] docker save → ${tar}, rsync → ${PASTA}/imagem.tar, docker load`)
  } else {
    await local(['docker', 'save', '-o', tar, `${p.aplicacao.imagem}:${versao}`], { aoVivo: true })
    info(`tar local ${tamanho(statSync(tar).size)}`)
  }

  await s.rodar(`mkdir -p ${PASTA}`)
  await s.rsyncEnviar(tar, `${PASTA}/imagem.tar`)
  await s.rodar(`docker load -i ${PASTA}/imagem.tar`, 'imagem carregada no servidor')

  if (!seco) {
    const confere = await s.tentar(
      `docker image inspect ${p.aplicacao.imagem}:${versao} --format '{{.Id}}'`,
    )
    if (confere.codigo !== 0) erro(`a imagem ${versao} não apareceu no servidor depois do load`)
    ok(`${p.aplicacao.imagem}:${versao} conferida no servidor`)
  }
}

/**
 * Migração e dado inicial ANTES de subir os serviços.
 *
 * Se o worker subisse primeiro, o primeiro ciclo dele bateria num banco sem
 * tabela, falharia e só tentaria de novo minutos depois. Rodando aqui, quando a
 * web abre já existe cache e pré-renderização — o primeiro visitante não paga
 * pela partida fria.
 */
async function passos() {
  const cli: Record<string, string> = {
    migrate: 'bun run packages/db/src/cli/migrate.ts',
    seed: 'bun run packages/db/src/cli/seed.ts',
    'seed-dados': 'bun run packages/db/src/cli/seed-dados.ts',
    ciclo: 'bun run apps/worker/src/cli/ciclo.ts',
  }
  for (const passo of p.deploy.passos) {
    const saida = await s.rodar(
      compose(`run --rm --no-deps -T worker ${cli[passo]}`),
      `${passo} executado`,
    )
    for (const linha of saida.split('\n').filter(Boolean).slice(-6)) info(linha)
  }
}

async function esperarSaude() {
  if (seco) return info('[seco] esperaria o healthcheck da web')
  for (let i = 0; i < 30; i++) {
    const r = await s.tentar(`docker inspect -f '{{.State.Health.Status}}' bolao-do-max-web`)
    if (r.saida === 'healthy') return ok('healthcheck da web: healthy')
    if (r.saida === 'unhealthy') break
    await Bun.sleep(2000)
  }
  const log = await s.tentar(compose('logs --tail 30 web'))
  erro(`a web não ficou saudável. Últimas linhas:\n${log.saida}`)
}

/**
 * Publica o vhost do domínio de convivência e emite o certificado.
 *
 * Existe porque sem ele o site só abre por túnel SSH, e o ponto do primeiro
 * deploy é justamente olhar no celular. O que este passo NÃO faz é a virada: o
 * vhost de bolao.maxmat1.com.br não é lido nem escrito aqui.
 *
 * A trava que importa é a ordem: `nginx -t` ANTES do reload, e se reprovar o
 * link simbólico sai antes de qualquer coisa recarregar. Uma configuração
 * inválida ativada derruba os nove vhosts da máquina, não só o nosso.
 */
async function publicarVhost() {
  if (!p.nginx.habilitado || arg('sem-nginx') !== undefined)
    return info('nginx desligado nos parâmetros — só o túnel SSH alcança o site')

  const dominio = p.aplicacao.dominio
  const disponivel = `${p.nginx.sites_available}/${dominio}`
  const ativo = `${p.nginx.sites_enabled}/${dominio}`

  const temNginx = await s.tentar('command -v nginx >/dev/null && echo sim')
  if (temNginx.saida.trim() !== 'sim') return aviso('nginx não instalado no servidor — pulando')

  // DNS antes de tudo. O certbot precisa alcançar este domínio de fora; sem o
  // apontamento ele falha com um erro de validação que não explica a causa.
  const ip = await s.ler('curl -s -4 --max-time 10 ifconfig.me || true')
  const aponta = await s.tentar(`getent hosts ${dominio} | head -1 | cut -d' ' -f1`)
  if (!aponta.saida.trim()) erro(`${dominio} não resolve — crie o registro DNS antes`)
  if (ip && aponta.saida.trim() !== ip)
    erro(
      `${dominio} aponta para ${aponta.saida.trim()} e o servidor é ${ip}.\n` +
        `  O certbot não conseguiria validar o domínio.`,
    )
  ok(`${dominio} → ${ip}`)

  const existe = await s.tentar(`test -f ${disponivel} && echo sim`)
  if (existe.saida.trim() === 'sim' && arg('refazer-vhost') === undefined) {
    info(`${disponivel} já existe — preservado (o certbot escreve nele)`)
  } else {
    const modelo = readFileSync(resolve(RAIZ, 'infra/nginx/vhost.conf.template'), 'utf8')
      .replaceAll('{{DOMINIO}}', dominio)
      .replaceAll('{{PORTA}}', String(p.aplicacao.porta_publicada))
      .replaceAll('{{UPSTREAM}}', p.nginx.upstream)
    if (existe.saida.trim() === 'sim')
      await s.rodar(`cp ${disponivel} ${disponivel}.antes-do-deploy`, 'vhost anterior guardado')
    await s.escreverArquivo(disponivel, modelo, '644')
  }

  const jaAtivo = await s.tentar(`test -L ${ativo} && echo sim`)
  const criouLink = jaAtivo.saida.trim() !== 'sim'
  if (criouLink) await s.rodar(`ln -s ${disponivel} ${ativo}`, `${ativo} ativado`)
  else info(`${ativo} já estava ativo`)

  const teste = await s.tentar('nginx -t 2>&1')
  if (teste.codigo !== 0) {
    // Desfaz antes de reclamar: o objetivo é o nginx continuar servindo os
    // vizinhos exatamente como estava um minuto atrás.
    if (criouLink) await s.rodar(`rm -f ${ativo}`, 'link removido — configuração restaurada')
    const depois = await s.tentar('nginx -t 2>&1')
    erro(
      `nginx -t reprovou a configuração:\n  ${teste.erroSaida || teste.saida}\n` +
        `  Estado atual: ${depois.codigo === 0 ? 'válido, nada foi ativado' : 'AINDA INVÁLIDO — confira à mão'}`,
    )
  }
  ok('nginx -t aprovado')
  await s.rodar('systemctl reload nginx', 'nginx recarregado')

  if (!p.nginx.certbot) return info('certbot desligado nos parâmetros — só http')

  const temCert = await s.tentar(
    `certbot certificates 2>/dev/null | grep -q "Domains: ${dominio}$" && echo sim`,
  )
  if (temCert.saida.trim() === 'sim') {
    info('certificado já existe para este domínio')
  } else {
    await s.rodar(
      `certbot --nginx -d ${dominio} --non-interactive --agree-tos --redirect ` +
        `--keep-until-expiring --no-eff-email 2>&1 | tail -5`,
      `certificado emitido para ${dominio}`,
    )
  }
}

/**
 * Teto de requisições por IP, no nginx.
 *
 * A aplicação já limita o **custo** de cada requisição — coalescência e janela
 * de TTL fazem N requisições simultâneas custarem um cálculo. Isto limita a
 * **quantidade**, que é a outra metade. Defesa em profundidade para os achados
 * de CWE-400 de 10/08/2026.
 *
 * Fica atrás de `--limites` e fora do caminho padrão do deploy, de propósito:
 * é a única etapa que encosta em configuração compartilhada, e precisa poder
 * ser revertida sozinha sem desfazer a aplicação.
 *
 * O risco está bem localizado e é tratado em duas medidas:
 *
 *   a zona   vai para um arquivo NOVO em conf.d/. `limit_req_zone` só vale no
 *            bloco http, que é compartilhado — mas declarar uma zona que
 *            nenhum vhost referencia não muda o comportamento de ninguém. É
 *            aditivo, e seguro por construção.
 *   a regra  vai para o vhost do bolão, que pertence ao certbot. Cópia antes,
 *            `nginx -t` depois, e **desfaz antes de reclamar** se reprovar —
 *            a mesma ordem de publicarVhost(), pelo mesmo motivo: uma
 *            configuração inválida ativada derruba os nove vhosts da máquina.
 *
 * Sobre os números: uma visita humana dispara a página mais três chamadas de
 * API. 20 r/s com rajada de 40 é folgado para uma pessoa e para operadora
 * móvel que compartilha IP por NAT, e é teto duro para uma inundação. O falso
 * positivo aqui é usuário real vendo 429, então começar generoso é o certo.
 */
async function aplicarLimites() {
  if (arg('limites') === undefined)
    return info('sem --limites — teto de requisições não alterado nesta passada')

  const dominio = arg('limites-dominio') || p.aplicacao.dominio
  const vhost = `${p.nginx.sites_available}/${dominio}`

  if (seco) return info(`[seco] declararia a zona em ${ZONA_LIMITES} e limitaria ${dominio}`)

  const temNginx = await s.tentar('command -v nginx >/dev/null && echo sim')
  if (temNginx.saida.trim() !== 'sim') return aviso('nginx não instalado no servidor — pulando')

  // Sem este include a zona ficaria escrita e nunca lida, e o `limit_req` do
  // vhost referenciaria uma zona inexistente — que é justamente o erro que
  // reprova a configuração inteira.
  const inclui = await s.tentar(
    `grep -qE '^\\s*include\\s+/etc/nginx/conf\\.d/\\*\\.conf;' /etc/nginx/nginx.conf && echo sim`,
  )
  if (inclui.saida.trim() !== 'sim')
    erro(
      `/etc/nginx/nginx.conf não inclui conf.d/*.conf.\n` +
        `  A zona precisa do bloco http e não há onde declará-la sem editar\n` +
        `  arquivo compartilhado. Confira à mão antes de insistir.`,
    )

  const temVhost = await s.tentar(`test -f ${vhost} && echo sim`)
  if (temVhost.saida.trim() !== 'sim')
    erro(`${vhost} não existe — rode o deploy sem --limites primeiro, ou passe --limites-dominio=`)

  const jaTem = await s.tentar(`grep -q 'zone=bolao' ${vhost} && echo sim`)
  if (jaTem.saida.trim() === 'sim') {
    await s.escreverArquivo(ZONA_LIMITES, CONTEUDO_ZONA, '644')
    return ok(`${dominio} já tem o teto — zona reescrita, vhost intacto`)
  }

  await s.escreverArquivo(ZONA_LIMITES, CONTEUDO_ZONA, '644')
  await s.rodar(`cp ${vhost} ${vhost}.antes-do-limite`, 'vhost guardado')

  // Entra em todo `location /` do arquivo: depois do certbot passar, o vhost
  // tem dois blocos server, e limitar só o :80 deixaria o :443 — que é por
  // onde todo mundo entra — sem teto nenhum.
  const insercao = REGRA_LIMITES.replaceAll('\t', '\\t').replaceAll('\n', '\\n')
  await s.rodar(
    `sed -i 's|^\\(\\s*\\)location / {|&\\n${insercao}|' ${vhost}`,
    'limit_req inserido nos blocos location /',
  )

  const quantos = await s.ler(`grep -c 'zone=bolao' ${vhost} || true`)
  if (Number(quantos.trim()) < 1) {
    await s.rodar(`mv ${vhost}.antes-do-limite ${vhost}`, 'vhost restaurado')
    erro(`o sed não encontrou nenhum 'location / {' em ${vhost} — nada foi alterado`)
  }

  const teste = await s.tentar('nginx -t 2>&1')
  if (teste.codigo !== 0) {
    // Desfaz antes de reclamar. Nada foi recarregado ainda, então o nginx em
    // execução segue com a configuração antiga — restaurar o arquivo fecha o
    // ciclo sem que ninguém tenha sentido nada.
    await s.rodar(`mv ${vhost}.antes-do-limite ${vhost}`, 'vhost restaurado')
    await s.rodar(`rm -f ${ZONA_LIMITES}`, 'zona removida')
    const depois = await s.tentar('nginx -t 2>&1')
    erro(
      `nginx -t reprovou a configuração com o limite:\n  ${teste.erroSaida || teste.saida}\n` +
        `  Estado atual: ${depois.codigo === 0 ? 'válido, nada foi ativado' : 'AINDA INVÁLIDO — confira à mão'}`,
    )
  }
  ok('nginx -t aprovado')
  await s.rodar('systemctl reload nginx', 'nginx recarregado')
  ok(`${dominio}: 20 r/s por IP, rajada de 40, excedente recebe 429`)
  info(`para desfazer: mv ${vhost}.antes-do-limite ${vhost} && rm -f ${ZONA_LIMITES} && nginx -t && systemctl reload nginx`)
}

async function conferir() {
  if (seco) return info('[seco] conferiria HTTP e o log do worker')

  const alvo = `http://127.0.0.1:${p.aplicacao.porta_publicada}`
  const codigo = await s.ler(
    `curl -s -o /dev/null -w '%{http_code}' ${alvo}/ || echo erro`,
  )
  if (codigo !== '200') erro(`GET / respondeu ${codigo}`)
  ok(`GET ${alvo}/ → 200`)

  // O corpo inteiro, sem `head -c`: cortar JSON e depois interpretar é um jeito
  // garantido de falhar na conferência com o deploy perfeitamente bom.
  const api = await s.ler(`curl -s ${alvo}/api/resultados`)
  const dados = JSON.parse(api) as { ano?: number; Competidores?: unknown[] }
  ok(`/api/resultados → temporada ${dados.ano}, ${dados.Competidores?.length ?? '?'} competidores`)

  // De fora, como quem vai abrir no celular: prova o vhost, o TLS e o DNS de
  // uma vez. Feito do servidor por simplicidade — o caminho público é o mesmo.
  const publico = await s.tentar(
    `curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://${p.aplicacao.dominio}/`,
  )
  if (publico.saida.trim() === '200') ok(`https://${p.aplicacao.dominio}/ → 200`)
  else aviso(`https://${p.aplicacao.dominio}/ respondeu ${publico.saida.trim() || 'nada'}`)

  const logWorker = await s.tentar(compose('logs --tail 5 worker'))
  for (const l of logWorker.saida.split('\n').filter(Boolean)) info(l)
}

async function limparVersoes(atual: string) {
  const versoes = await versoesNoServidor()
  const guardar = new Set([atual, 'mais-recente', ...versoes.slice(0, p.aplicacao.versoes_guardadas)])
  const apagar = versoes.filter((v) => !guardar.has(v))
  if (!apagar.length) return info(`${versoes.length} versões no servidor, nenhuma para apagar`)
  await s.rodar(
    apagar.map((v) => `docker rmi ${p.aplicacao.imagem}:${v}`).join('; ') + ' || true',
    `${apagar.length} versões antigas removidas (${apagar.join(', ')})`,
  )
}

function resumo(versao: string) {
  console.log(`\n${negrito('no ar')} — ${p.aplicacao.imagem}:${versao}`)
  console.log(`  ${negrito(`https://${p.aplicacao.dominio}`)}  ← abre no celular`)
  console.log(`  servidor  ${s.endereco}:${PASTA}`)
  console.log(`  interno   http://127.0.0.1:${p.aplicacao.porta_publicada}`)
  console.log(
    `\n${negrito('o bolão atual continua no ar, intocado')} — bolao.maxmat1.com.br, porta 5001, ` +
      `Redis e dado próprios.`,
  )
  console.log(
    apagado(
      `\nA virada é um passo separado, e é uma linha: no vhost de ` +
        `bolao.maxmat1.com.br,\no \`upstream maxmat1\` passa de 5001 para ` +
        `${p.aplicacao.porta_publicada}. Voltar é a mesma linha ao contrário.\nMe peça quando quiser.`,
    ),
  )
  console.log(apagado(`\nRetorno da versão:  bun run deploy --reverter`))
}
