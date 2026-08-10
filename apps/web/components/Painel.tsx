'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Movimento } from '../lib/dados'
import { Detalhe } from './Detalhe'
import { Evolucao } from './Evolucao'
import { Identificacao } from './Identificacao'
import { Logo } from './Logo'
import { Menu, Regras, type Tema } from './Menu'
import { brl, ord, setaCor, setaTxt, sinal } from './ui'

type Aba = 'classico' | 'posicao' | 'evolucao'

/** Resumo: o que a lista precisa. O detalhe vem de /api/competidor. */
export type ResumoClassico = {
  nome: string
  posicao: number
  pontos: number
  saldoGols: number
  premioCentavos: number
  clubes: { clube: string; coracao: boolean }[]
}

/** Um ponto por palpite, na ordem G4 (1–4) e Z4 (17–20). */
export type MarcaPalpite = { exato: boolean; naFaixa: boolean; titulo: string }

export type ResumoPosicao = {
  nome: string
  posicao: number
  pontos: number
  acertosFaixa: number
  acertosG4: number
  acertosZ4: number
  exatos: number
  premioCentavos: number
  g4: MarcaPalpite[]
  z4: MarcaPalpite[]
}

export type DadosPainel = {
  temporada: number
  atualizadoEm: string
  rodada: number | null
  classico: ResumoClassico[]
  posicao: ResumoPosicao[]
  movimento: Movimento
  fontes: string[]
  origemLeitura: string
}

const ABAS: { id: Aba; titulo: string; sub: string }[] = [
  { id: 'classico', titulo: 'Clássico', sub: 'soma dos 4 clubes' },
  { id: 'posicao', titulo: 'Por Posição', sub: 'G4 e Z4' },
  { id: 'evolucao', titulo: 'Evolução', sub: 'trajetórias' },
]

export function Painel(d: DadosPainel) {
  const [aba, setAba] = useState<Aba>('classico')
  const [tema, setTema] = useState<Tema>('ocre')
  const [busca, setBusca] = useState('')
  const [eu, setEu] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [regras, setRegras] = useState(false)
  const [detalhe, setDetalhe] = useState<{ nome: string; tipo: 'classico' | 'posicao' } | null>(null)
  // `pronto` evita que o diálogo de identificação pisque antes de sabermos se a
  // pessoa já se identificou numa visita anterior.
  const [pronto, setPronto] = useState(false)
  const [visitante, setVisitante] = useState(false)
  const tabs = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const a = localStorage.getItem('bolao:aba')
      if (a === 'classico' || a === 'posicao' || a === 'evolucao') setAba(a)
      const t = document.documentElement.getAttribute('data-tema') as Tema | null
      if (t) setTema(t)
      setEu(localStorage.getItem('bolao:eu'))
      setVisitante(localStorage.getItem('bolao:visitante') === '1')
    } catch {
      /* localStorage bloqueado — segue nos padrões */
    } finally {
      setPronto(true)
    }
  }, [])

  const guardar = (chave: string, valor: string | null) => {
    try {
      if (valor === null) localStorage.removeItem(chave)
      else localStorage.setItem(chave, valor)
    } catch {}
  }

  const trocarAba = useCallback((a: Aba) => {
    setAba(a)
    guardar('bolao:aba', a)
  }, [])

  const trocarTema = useCallback((t: Tema) => {
    setTema(t)
    document.documentElement.setAttribute('data-tema', t)
    guardar('bolao:tema', t)
  }, [])

  const definirEu = useCallback((n: string | null) => {
    setEu(n)
    guardar('bolao:eu', n)
    // Escolher "— ninguém —" no menu é uma decisão consciente, não a ausência
    // de uma: sem marcar isso, o diálogo de primeira visita voltaria a
    // aparecer no próximo carregamento.
    setVisitante(!n)
    guardar('bolao:visitante', n ? null : '1')
  }, [])

  const marcarVisitante = useCallback(() => {
    setVisitante(true)
    guardar('bolao:visitante', '1')
  }, [])

  // Primeira visita: ninguém escolhido e ninguém declarou-se visitante.
  const pedirIdentificacao = pronto && !eu && !visitante

  const q = busca.trim().toLowerCase()
  const linhasC = useMemo(
    () => (q ? d.classico.filter((x) => x.nome.toLowerCase().includes(q)) : d.classico),
    [d.classico, q],
  )
  const linhasP = useMemo(
    () => (q ? d.posicao.filter((x) => x.nome.toLowerCase().includes(q)) : d.posicao),
    [d.posicao, q],
  )

  const naveTabs = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = ABAS.findIndex((x) => x.id === aba)
    const prox = ABAS[(i + (e.key === 'ArrowRight' ? 1 : ABAS.length - 1)) % ABAS.length]!
    trocarAba(prox.id)
    tabs.current?.querySelector<HTMLButtonElement>(`#tab-${prox.id}`)?.focus()
  }

  const meuC = eu ? d.classico.find((l) => l.nome === eu) : undefined
  const meuP = eu ? d.posicao.find((l) => l.nome === eu) : undefined

  /**
   * Nomes em ordem alfabética para as listas de escolha.
   *
   * `d.classico` vem em ordem de classificação, que é o certo para a tabela e o
   * errado para procurar o próprio nome numa lista de trinta. `localeCompare`
   * com 'pt-BR' porque acento tem lugar definido no alfabeto: Júnior vem depois
   * de Jane, e a ordenação binária mandaria os acentuados todos para o fim.
   */
  const nomes = useMemo(
    () => d.classico.map((l) => l.nome).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [d.classico],
  )
  const atualizado = new Date(d.atualizadoEm).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 30,
          background: 'var(--bg)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max)',
            margin: '0 auto',
            padding: '12px var(--gutter) 0',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <Logo />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                fontSize: 'clamp(18px,4.6vw,26px)',
                fontWeight: 800,
                letterSpacing: '-.025em',
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              Bolão do Max
            </h1>
            <p
              style={{
                margin: '3px 0 0',
                fontSize: 'clamp(11.5px,2.8vw,13px)',
                color: 'var(--ink-2)',
                lineHeight: 1.3,
              }}
            >
              Brasileirão {d.temporada}
              {d.rodada ? ` · ${d.rodada}ª rodada` : ''} · atualizado {atualizado}
            </p>
          </div>
          <button
            type="button"
            aria-label="Abrir menu"
            aria-haspopup="dialog"
            onClick={() => setMenu(true)}
            style={{
              flex: 'none',
              width: 44,
              height: 44,
              marginTop: -4,
              border: '1px solid var(--line)',
              borderRadius: 12,
              background: 'var(--surf)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{ display: 'block', width: 18, height: 2, background: 'var(--ink)', borderRadius: 2 }}
              />
            ))}
          </button>
        </div>

        <div
          ref={tabs}
          role="tablist"
          aria-label="Bolões"
          onKeyDown={naveTabs}
          style={{
            maxWidth: 'var(--max)',
            margin: '0 auto',
            padding: '10px var(--gutter) 0',
            display: 'flex',
            gap: 6,
          }}
        >
          {ABAS.map((t) => {
            const sel = aba === t.id
            return (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={sel}
                aria-controls={`painel-${t.id}`}
                tabIndex={sel ? 0 : -1}
                onClick={() => trocarAba(t.id)}
                style={{
                  flex: 1,
                  minHeight: 44,
                  padding: '9px 12px 11px',
                  borderRadius: '12px 12px 0 0',
                  border: '1px solid var(--line)',
                  borderBottom: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  background: sel ? 'var(--surf)' : 'transparent',
                  color: sel ? 'var(--ink)' : 'var(--ink-2)',
                }}
              >
                <span
                  style={{
                    fontSize: 'clamp(12.5px,3.2vw,15px)',
                    fontWeight: sel ? 700 : 500,
                    letterSpacing: '-.01em',
                  }}
                >
                  {t.titulo}
                </span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.2 }}>{t.sub}</span>
              </button>
            )
          })}
        </div>
      </header>

      <main style={{ maxWidth: 'var(--max)', margin: '0 auto', padding: '0 0 60px' }}>
        {aba !== 'evolucao' && (meuC || meuP) && (
          <div style={{ padding: '12px var(--gutter) 0' }}>
            <button
              type="button"
              onClick={() => setDetalhe({ nome: eu!, tipo: aba === 'posicao' ? 'posicao' : 'classico' })}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '11px 14px',
                border: '1px solid var(--accent)',
                borderRadius: 14,
                background: 'var(--accent-soft)',
              }}
            >
              <span
                style={{
                  flex: 'none',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '.14em',
                  color: 'var(--accent)',
                }}
              >
                VOCÊ
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700 }}>{eu}</span>
              {/*
                Os dois bolões de uma vez, como no protótipo, e não só o da aba
                aberta: a pergunta de quem chega é "como eu estou", e a resposta
                são duas posições. Mostrar uma obriga a trocar de aba para ver a
                outra.
              */}
              <span className="mono" style={{ flex: 'none', fontSize: 12.5, color: 'var(--ink-2)' }}>
                {[
                  meuC ? `${ord(meuC.posicao)} clássico` : null,
                  meuP ? `${ord(meuP.posicao)} posição` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          </div>
        )}

        {aba !== 'evolucao' && (
          <div style={{ padding: '12px var(--gutter) 0' }}>
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar nome"
              aria-label="Buscar competidor pelo nome"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '10px 14px',
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--surf)',
                fontSize: 15,
              }}
            />
          </div>
        )}

        <section role="tabpanel" id="painel-classico" aria-labelledby="tab-classico" tabIndex={0} hidden={aba !== 'classico'}>
          <Cabecalho colunas="var(--cols-c)" itens={['Pos', 'Nome', 'Pts', 'SG', 'Prêmio', 'GP1', 'GP2', 'GP3', 'GP4']} />
          <Lista vazio={linhasC.length === 0}>
            {linhasC.map((l) => (
              <LinhaC
                key={l.nome}
                l={l}
                eu={eu === l.nome}
                mov={d.movimento[l.nome]?.classico ?? null}
                onAbrir={() => setDetalhe({ nome: l.nome, tipo: 'classico' })}
              />
            ))}
          </Lista>
        </section>

        <section role="tabpanel" id="painel-posicao" aria-labelledby="tab-posicao" tabIndex={0} hidden={aba !== 'posicao'}>
          <Cabecalho colunas="var(--cols-p)" itens={['Pos', 'Nome', 'Pts', 'Palpites (G4 · Z4)', 'Prêmio']} />
          <Lista vazio={linhasP.length === 0}>
            {linhasP.map((l) => (
              <LinhaP
                key={l.nome}
                l={l}
                eu={eu === l.nome}
                mov={d.movimento[l.nome]?.posicao ?? null}
                onAbrir={() => setDetalhe({ nome: l.nome, tipo: 'posicao' })}
              />
            ))}
          </Lista>
          <Legenda />
        </section>

        <section role="tabpanel" id="painel-evolucao" aria-labelledby="tab-evolucao" tabIndex={0} hidden={aba !== 'evolucao'}>
          {aba === 'evolucao' && <Evolucao eu={eu} />}
        </section>

        {/* Acesso rápido às regras no fim de qualquer aba: quem rolou até aqui
            provavelmente está tentando entender a pontuação. */}
        <div style={{ padding: '24px var(--gutter) 0' }}>
          <button
            type="button"
            onClick={() => setRegras(true)}
            style={{
              width: '100%',
              minHeight: 52,
              padding: '10px 16px',
              border: '1px solid var(--line)',
              borderRadius: 14,
              background: 'var(--surf)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            <span style={{ flex: 1 }}>Regras do bolão {d.temporada}</span>
            <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>
              como a pontuação funciona →
            </span>
          </button>
        </div>
      </main>

      {pedirIdentificacao && (
        <Identificacao
          nomes={nomes}
          onEscolher={(n) => definirEu(n)}
          onVisitante={marcarVisitante}
        />
      )}

      {menu && (
        <Menu
          tema={tema}
          eu={eu}
          nomes={nomes}
          atualizado={atualizado}
          fontes={d.fontes}
          origemLeitura={d.origemLeitura}
          onTema={trocarTema}
          onEu={definirEu}
          onRegras={() => {
            setMenu(false)
            setRegras(true)
          }}
          onFechar={() => setMenu(false)}
        />
      )}

      {regras && <Regras temporada={d.temporada} onFechar={() => setRegras(false)} />}

      {detalhe && (
        <Detalhe
          nome={detalhe.nome}
          tipo={detalhe.tipo}
          totalCompetidores={d.classico.length}
          onFechar={() => setDetalhe(null)}
        />
      )}
    </div>
  )
}

// ── peças ────────────────────────────────────────────────────

function Cabecalho({ colunas, itens }: { colunas: string; itens: string[] }) {
  return (
    <div
      style={{
        display: 'var(--dt)',
        padding: '16px var(--gutter) 6px',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '.09em',
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
      }}
    >
      <span
        style={{
          display: 'grid',
          gridTemplateColumns: colunas,
          gap: 8,
          width: '100%',
          alignItems: 'end',
          padding: '0 13px',
        }}
      >
        {itens.map((t, i) => (
          <span key={t} style={{ textAlign: i === 0 ? 'center' : undefined }}>
            {t}
          </span>
        ))}
      </span>
    </div>
  )
}

function Lista({ children, vazio }: { children: React.ReactNode; vazio: boolean }) {
  if (vazio)
    return (
      <p style={{ padding: '28px var(--gutter)', color: 'var(--ink-3)', fontSize: 14 }}>
        Nenhum competidor com esse nome.
      </p>
    )
  return (
    <ol
      style={{
        listStyle: 'none',
        margin: 0,
        padding: '8px var(--gutter) 0',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {children}
    </ol>
  )
}

/**
 * Marca de premiado.
 *
 * A coluna Prêmio já mostra o valor no desktop, então repetir a quantia ao lado
 * do nome era redundância. No mobile essa coluna não existe, e por isso o valor
 * vai no `title` e no rótulo acessível da linha — a estrela sinaliza, e a
 * quantia continua alcançável.
 */
function Estrela({ premio }: { premio: number }) {
  return (
    <span
      title={`Premiado: ${brl(premio)}`}
      aria-hidden="true"
      style={{ flex: 'none', fontSize: 13, lineHeight: 1, color: 'var(--accent)' }}
    >
      ★
    </span>
  )
}

function Seta({ mov }: { mov: number | null }) {
  if (mov === null || mov === 0) return null
  return (
    <span
      className="mono"
      title="Movimento nas últimas 24 horas"
      style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: setaCor(mov) }}
    >
      {setaTxt(mov)}
    </span>
  )
}

const linhaBase = (eu: boolean, colunas: string): React.CSSProperties => ({
  width: '100%',
  minHeight: 'var(--row-min)',
  display: 'grid',
  gridTemplateColumns: colunas,
  gap: 8,
  alignItems: 'center',
  padding: '8px 12px',
  border: '1px solid var(--line-soft)',
  borderRadius: 14,
  background: 'var(--surf)',
  boxShadow: eu ? 'inset 0 0 0 2px var(--accent)' : 'none',
})

function LinhaC({
  l,
  eu,
  mov,
  onAbrir,
}: {
  l: ResumoClassico
  eu: boolean
  mov: number | null
  onAbrir: () => void
}) {
  const podio = l.posicao <= 3
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${l.nome}, ${ord(l.posicao)} lugar, ${l.pontos} pontos${
          l.premioCentavos ? `, prêmio de ${brl(l.premioCentavos)}` : ''
        }. Ver detalhamento.`}
        style={linhaBase(eu, 'var(--cols-c)')}
      >
        <span
          className="mono"
          style={{
            fontSize: podio ? 17 : 14,
            fontWeight: 600,
            color: podio ? 'var(--accent)' : 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          {l.posicao}
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 'var(--fs-nome)',
                fontWeight: 600,
                letterSpacing: '-.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {l.nome}
            </span>
            {l.premioCentavos > 0 && <Estrela premio={l.premioCentavos} />}
            <Seta mov={mov} />
          </span>
          <span
            style={{
              display: 'var(--mb)',
              fontSize: 12,
              color: 'var(--ink-3)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {l.clubes.map((c) => `${c.clube}${c.coracao ? ' ❤️' : ''}`).join(' · ')}
          </span>
        </span>
        <span style={{ display: 'var(--mb)', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.05 }}>
          <span className="mono" style={{ fontSize: 19, fontWeight: 600 }}>
            {l.pontos}
          </span>
          <span className="mono" style={{ fontSize: 11.5, color: l.saldoGols < 0 ? 'var(--neg)' : 'var(--ink-2)' }}>
            {sinal(l.saldoGols)}
          </span>
        </span>
        <span className="mono" style={{ display: 'var(--dt)', justifyContent: 'flex-end', fontSize: 16, fontWeight: 600 }}>
          {l.pontos}
        </span>
        <span
          className="mono"
          style={{
            display: 'var(--dt)',
            justifyContent: 'flex-end',
            fontSize: 13,
            color: l.saldoGols < 0 ? 'var(--neg)' : 'var(--ink-2)',
          }}
        >
          {sinal(l.saldoGols)}
        </span>
        <span
          className="mono"
          style={{ display: 'var(--dt)', fontSize: 12.5, color: l.premioCentavos ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          {l.premioCentavos ? brl(l.premioCentavos) : '—'}
        </span>
        {l.clubes.map((c) => (
          <span
            key={c.clube}
            style={{
              display: 'var(--dt)',
              fontSize: 12.5,
              color: 'var(--ink-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.clube}
            {c.coracao ? ' ❤️' : ''}
          </span>
        ))}
      </button>
    </li>
  )
}

/**
 * Um ponto por palpite: cheio = posição exata, contorno = faixa, apagado = nada.
 *
 * Classe em vez de estilo inline: são 240 na página, e inline custava 60 KB.
 */
function Ponto({ m }: { m: MarcaPalpite }) {
  return <span title={m.titulo} className={`pt${m.exato ? ' exato' : m.naFaixa ? ' faixa' : ''}`} />
}

function LinhaP({
  l,
  eu,
  mov,
  onAbrir,
}: {
  l: ResumoPosicao
  eu: boolean
  mov: number | null
  onAbrir: () => void
}) {
  const podio = l.posicao <= 3
  return (
    <li>
      <button
        type="button"
        onClick={onAbrir}
        aria-label={`${l.nome}, ${ord(l.posicao)} lugar, ${l.pontos} pontos, ${l.exatos} palpites na mosca${
          l.premioCentavos ? `, prêmio de ${brl(l.premioCentavos)}` : ''
        }. Ver palpites.`}
        style={linhaBase(eu, 'var(--cols-p)')}
      >
        <span
          className="mono"
          style={{
            fontSize: podio ? 17 : 14,
            fontWeight: 600,
            color: podio ? 'var(--accent)' : 'var(--ink-3)',
            textAlign: 'center',
          }}
        >
          {l.posicao}
        </span>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 'var(--fs-nome)',
                fontWeight: 600,
                letterSpacing: '-.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {l.nome}
            </span>
            {l.premioCentavos > 0 && <Estrela premio={l.premioCentavos} />}
            <Seta mov={mov} />
          </span>
          <span style={{ display: 'var(--mb)', fontSize: 12, color: 'var(--ink-3)' }}>
            {l.exatos} na mosca · {l.acertosFaixa} de 8 clubes
          </span>
        </span>
        <span className="mono" style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 19, fontWeight: 600 }}>
          {l.pontos}
        </span>
        <span
          style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 7 }}
          aria-hidden="true"
        >
          <span className="pts">
            {l.g4.map((m, i) => (
              <Ponto key={`g${i}`} m={m} />
            ))}
          </span>
          <span className="pts">
            {l.z4.map((m, i) => (
              <Ponto key={`z${i}`} m={m} />
            ))}
          </span>
        </span>
        <span
          className="mono"
          style={{ display: 'var(--dt)', fontSize: 12.5, color: l.premioCentavos ? 'var(--ink)' : 'var(--ink-3)' }}
        >
          {l.premioCentavos ? brl(l.premioCentavos) : '—'}
        </span>
      </button>
    </li>
  )
}

function Legenda() {
  const itens = [
    { cls: 'leg exato', txt: 'Posição exata — 4 pontos' },
    { cls: 'leg faixa', txt: 'Clube no G4 ou Z4 — 1 ponto' },
    { cls: 'leg', txt: 'Sem pontos' },
  ]
  return (
    <div
      style={{
        margin: '20px var(--gutter) 0',
        padding: '14px 16px',
        border: '1px solid var(--line-soft)',
        borderRadius: 14,
        background: 'var(--surf)',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '14px 22px',
      }}
    >
      {itens.map((i) => (
        <span key={i.txt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-2)' }}>
          <span className={i.cls} />
          {i.txt}
        </span>
      ))}
    </div>
  )
}
