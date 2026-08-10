'use client'

import { BotaoFechar, Folha, Rotulo, usarDialogo } from './ui'

export type Tema = 'ocre' | 'claro' | 'escuro'

const TEMAS: { id: Tema; rot: string; nota: string; amostra: string }[] = [
  { id: 'ocre', rot: 'Ocre', nota: 'padrão', amostra: '#EFE3CC' },
  { id: 'claro', rot: 'Claro', nota: 'sob sol', amostra: '#F6F5F3' },
  { id: 'escuro', rot: 'Escuro', nota: 'madrugada', amostra: '#141210' },
]

/** Gaveta lateral, como no protótipo — não folha inferior. */
export function Menu({
  tema,
  eu,
  nomes,
  atualizado,
  fontes,
  origemLeitura,
  onTema,
  onEu,
  onRegras,
  onFechar,
}: {
  tema: Tema
  eu: string | null
  nomes: string[]
  atualizado: string
  fontes: string[]
  origemLeitura: string
  onTema: (t: Tema) => void
  onEu: (n: string | null) => void
  onRegras: () => void
  onFechar: () => void
}) {
  const painel = usarDialogo(true, onFechar)

  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(20,14,4,.5)',
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'surge .16s ease-out',
      }}
    >
      <aside
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(340px,88vw)',
          height: '100%',
          background: 'var(--bg)',
          boxShadow: 'var(--shadow)',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 16,
            borderBottom: '1px solid var(--line)',
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
            }}
          >
            Menu
          </span>
          <BotaoFechar rotulo="Fechar menu" onClick={onFechar} />
        </div>

        <div style={{ padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <Rotulo>Tema</Rotulo>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TEMAS.map((t) => {
                const sel = tema === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => onTema(t.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      minHeight: 48,
                      padding: '8px 12px',
                      border: `1px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
                      borderRadius: 12,
                      background: sel ? 'var(--accent-soft)' : 'var(--surf)',
                    }}
                  >
                    <span
                      style={{
                        flex: 'none',
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        border: '1px solid var(--line)',
                        background: t.amostra,
                      }}
                    />
                    <span style={{ flex: 1, fontSize: 15, fontWeight: sel ? 700 : 500 }}>{t.rot}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{t.nota}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <Rotulo>Meu nome</Rotulo>
            <select
              value={eu ?? ''}
              onChange={(e) => onEu(e.target.value || null)}
              aria-label="Marcar meu nome nas tabelas"
              style={{
                width: '100%',
                minHeight: 46,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--surf)',
                fontSize: 15,
              }}
            >
              <option value="">— ninguém —</option>
              {nomes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.45 }}>
              Destaca sua linha nas abas e mostra suas posições no topo. Guardado só neste navegador.
            </p>
          </div>

          <div>
            <Rotulo>Sobre</Rotulo>
            <button
              type="button"
              onClick={onRegras}
              style={{
                width: '100%',
                minHeight: 48,
                padding: '10px 12px',
                border: '1px solid var(--line)',
                borderRadius: 12,
                background: 'var(--surf)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 15,
              }}
            >
              <span style={{ flex: 1 }}>Regras do bolão</span>
              <span style={{ color: 'var(--ink-3)' }}>→</span>
            </button>
          </div>

          <div
            style={{
              borderTop: '1px solid var(--line)',
              paddingTop: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Atualizado em {atualizado}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              {nomes.length} apostadores · fontes: {fontes.join(', ')}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>leitura via {origemLeitura}</span>
          </div>
        </div>
      </aside>
    </div>
  )
}

/**
 * Regras do bolão.
 *
 * A estrutura segue o protótipo, mas o texto do desempate NÃO: o protótipo diz
 * que o saldo de gols é o único critério, e o cálculo aplica cinco em cascata.
 * Copiar a afirmação errada seria publicar informação falsa sobre as regras.
 */
export function Regras({ temporada, onFechar }: { temporada: number; onFechar: () => void }) {
  return (
    <Folha
      aria="Regras do bolão"
      onFechar={onFechar}
      zIndex={80}
      cabecalho={
        <h2 style={{ flex: 1, margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-.02em' }}>
          Regras {temporada}
        </h2>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            padding: '12px 14px',
            border: '1px solid var(--line-soft)',
            borderRadius: 14,
            background: 'var(--surf)',
          }}
        >
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            A aposta custa <b>R$ 155,00</b> por pessoa e deve ser paga antes do fim do campeonato. O
            valor é dividido em dois bolões independentes e uma aposta na Mega da Virada.
          </p>
        </div>

        <div>
          <Rotulo cor="var(--accent)">Bolão Clássico</Rotulo>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <li>Você concorre com a soma dos pontos dos quatro clubes do seu conjunto (GP1 a GP4).</li>
            <li>
              O desempate é em cascata: saldo de gols do conjunto, depois gols pró, depois gols
              contra e por fim ordem alfabética. Empatados na mesma posição premiada dividem o
              prêmio.
            </li>
            <li>Premiação: 1º R$ 2.000,00 · 2º R$ 650,00 · 3º R$ 350,00 · último R$ 120,00.</li>
          </ul>
        </div>

        <div>
          <Rotulo cor="var(--accent)">Bolão por Posição</Rotulo>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            <li>
              Cada apostador escolhe os quatro primeiros (G4) e os quatro últimos (Z4) da tabela
              final, com as posições exatas.
            </li>
            <li>
              Clube certo na faixa, posição errada: <b>1 ponto</b>.
            </li>
            <li>
              Clube certo na posição exata: <b>4 pontos</b>.
            </li>
            <li>
              O desempate é por clubes acertados na faixa, depois acertos no G4, depois no Z4.
              Pontuação igual em todos os critérios é empate de verdade e divide a posição.
            </li>
            <li>Premiação: 1º R$ 1.000,00, dividido em caso de empate.</li>
          </ul>
        </div>

        <div>
          <Rotulo cor="var(--accent)">Mega da Virada</Rotulo>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            Com os R$ 530,00 restantes sai a aposta de 9 dezenas na Mega Sena da Virada.
          </p>
        </div>
      </div>
    </Folha>
  )
}
