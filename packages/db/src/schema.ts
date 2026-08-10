/**
 * Esquema do Bolão do Max.
 *
 * Três princípios que explicam o formato:
 *
 * 1. Identidade estável. Clubes e competidores mudam de nome entre temporadas
 *    e entre fontes (`Chico 'Virus'` × `Chico`; `Athletico-PR` × outra grafia).
 *    Casar por string exata é o que hoje zera pontos em silêncio, então cada
 *    entidade tem apelidos por fonte e por temporada.
 *
 * 2. Partidas são o centro. Com todos os jogos em banco, a classificação é
 *    calculada e não buscada — o que dá independência de fonte, verificação
 *    cruzada e a base do simulador.
 *
 * 3. Dinheiro em centavos. Inteiro, nunca ponto flutuante.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────

export const statusPartida = pgEnum('status_partida', [
  'agendada',
  'em_andamento',
  'encerrada',
  'adiada',
  'cancelada',
])

export const grupoAposta = pgEnum('grupo_aposta', ['GP1', 'GP2', 'GP3', 'GP4'])

export const tipoAlias = pgEnum('tipo_alias', ['id_externo', 'nome'])

export const tipoDivergencia = pgEnum('tipo_divergencia', [
  'tabela_calculada_vs_fonte',
  'fonte_vs_fonte',
  'clube_nao_resolvido',
  'payload_invalido',
])

// ─────────────────────────────────────────────────────────────
// Temporada — inclui as regras vigentes na época
// ─────────────────────────────────────────────────────────────

/**
 * `regras` guarda a premiação e os parâmetros daquele ano. Ficam aqui, e não
 * no código, porque é o que permite recalcular 2018 com as regras de 2018.
 */
export type RegrasTemporada = {
  valorAposta: number // centavos
  classico: {
    premios: { posicao: number; centavos: number }[]
    premioLanternaCentavos: number
  }
  posicao: {
    premioPrimeiroCentavos: number
    pontosFaixa: number
    pontosPosicaoExata: number
  }
  megaSenaCentavos: number
}

export const temporada = pgTable(
  'temporada',
  {
    id: serial('id').primaryKey(),
    ano: integer('ano').notNull(),
    serie: text('serie').notNull().default('A'),
    temClassico: boolean('tem_classico').notNull().default(true),
    /** O Bolão por Posição só passou a existir em 2024. */
    temPosicao: boolean('tem_posicao').notNull().default(false),
    totalRodadas: smallint('total_rodadas').notNull().default(38),
    totalClubes: smallint('total_clubes').notNull().default(20),
    inicio: date('inicio'),
    fim: date('fim'),
    encerrada: boolean('encerrada').notNull().default(false),
    regras: jsonb('regras').$type<RegrasTemporada>().notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('temporada_ano_serie_uq').on(t.ano, t.serie)],
)

// ─────────────────────────────────────────────────────────────
// Clube e seus apelidos por fonte
// ─────────────────────────────────────────────────────────────

export const clube = pgTable(
  'clube',
  {
    id: serial('id').primaryKey(),
    nome: text('nome').notNull(),
    sigla: text('sigla'),
    escudoUrl: text('escudo_url'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('clube_nome_uq').on(t.nome)],
)

/**
 * Resolve o que cada fonte chama de cada clube. Aceita tanto id externo
 * (a API do GE devolve `equipe_id` inteiro e estável) quanto nome literal
 * (as planilhas só têm o nome).
 */
export const clubeAlias = pgTable(
  'clube_alias',
  {
    id: serial('id').primaryKey(),
    clubeId: integer('clube_id')
      .notNull()
      .references(() => clube.id, { onDelete: 'cascade' }),
    fonte: text('fonte').notNull(),
    tipo: tipoAlias('tipo').notNull(),
    chave: text('chave').notNull(),
    /** Nulo = vale para qualquer temporada. */
    temporadaAno: integer('temporada_ano'),
  },
  (t) => [
    uniqueIndex('clube_alias_uq').on(t.fonte, t.tipo, t.chave, t.temporadaAno),
    index('clube_alias_clube_ix').on(t.clubeId),
  ],
)

// ─────────────────────────────────────────────────────────────
// Competidor e seus apelidos por temporada
// ─────────────────────────────────────────────────────────────

export const competidor = pgTable(
  'competidor',
  {
    id: serial('id').primaryKey(),
    nome: text('nome').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('competidor_nome_uq').on(t.nome)],
)

export const competidorAlias = pgTable(
  'competidor_alias',
  {
    id: serial('id').primaryKey(),
    competidorId: integer('competidor_id')
      .notNull()
      .references(() => competidor.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    temporadaAno: integer('temporada_ano'),
  },
  (t) => [
    uniqueIndex('competidor_alias_uq').on(t.nome, t.temporadaAno),
    index('competidor_alias_comp_ix').on(t.competidorId),
  ],
)

// ─────────────────────────────────────────────────────────────
// Apostas
// ─────────────────────────────────────────────────────────────

export const apostaClassico = pgTable(
  'aposta_classico',
  {
    id: serial('id').primaryKey(),
    temporadaId: integer('temporada_id')
      .notNull()
      .references(() => temporada.id, { onDelete: 'cascade' }),
    competidorId: integer('competidor_id')
      .notNull()
      .references(() => competidor.id, { onDelete: 'cascade' }),
    grupo: grupoAposta('grupo').notNull(),
    clubeId: integer('clube_id')
      .notNull()
      .references(() => clube.id),
    /** Time do coração — renderizado com ❤️ ao lado do clube. */
    coracao: boolean('coracao').notNull().default(false),
  },
  (t) => [
    uniqueIndex('aposta_classico_uq').on(t.temporadaId, t.competidorId, t.grupo),
    index('aposta_classico_temp_ix').on(t.temporadaId),
  ],
)

export const apostaPosicao = pgTable(
  'aposta_posicao',
  {
    id: serial('id').primaryKey(),
    temporadaId: integer('temporada_id')
      .notNull()
      .references(() => temporada.id, { onDelete: 'cascade' }),
    competidorId: integer('competidor_id')
      .notNull()
      .references(() => competidor.id, { onDelete: 'cascade' }),
    /** 1–4 no G4, 17–20 no Z4. */
    posicao: smallint('posicao').notNull(),
    clubeId: integer('clube_id')
      .notNull()
      .references(() => clube.id),
  },
  (t) => [
    uniqueIndex('aposta_posicao_uq').on(t.temporadaId, t.competidorId, t.posicao),
    index('aposta_posicao_temp_ix').on(t.temporadaId),
  ],
)

// ─────────────────────────────────────────────────────────────
// Partidas — o centro do modelo
// ─────────────────────────────────────────────────────────────

export const partida = pgTable(
  'partida',
  {
    id: serial('id').primaryKey(),
    temporadaId: integer('temporada_id')
      .notNull()
      .references(() => temporada.id, { onDelete: 'cascade' }),
    rodada: smallint('rodada').notNull(),
    /** Id da partida na fonte primária. Estável no GE. */
    externoId: text('externo_id'),
    mandanteId: integer('mandante_id')
      .notNull()
      .references(() => clube.id),
    visitanteId: integer('visitante_id')
      .notNull()
      .references(() => clube.id),
    /**
     * Pode ser nulo: jogo adiado sem nova data. Confirmado em testes contra
     * o GE — rodada 21 de 2026 traz Botafogo × Grêmio com data nula.
     */
    inicioPrevisto: timestamp('inicio_previsto', { withTimezone: true }),
    /**
     * Jogos distantes vêm com horário provisório (T12:00). Só vira `true`
     * quando a fonte confirma o horário real.
     */
    inicioConfirmado: boolean('inicio_confirmado').notNull().default(false),
    estadio: text('estadio'),
    status: statusPartida('status').notNull().default('agendada'),
    golsMandante: smallint('gols_mandante'),
    golsVisitante: smallint('gols_visitante'),
    fonte: text('fonte'),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('partida_uq').on(t.temporadaId, t.rodada, t.mandanteId, t.visitanteId),
    index('partida_temp_rodada_ix').on(t.temporadaId, t.rodada),
    index('partida_inicio_ix').on(t.inicioPrevisto),
    index('partida_status_ix').on(t.status),
  ],
)

/** Histórico de remarcação. "Sempre pode mudar" fica registrado. */
export const partidaAlteracao = pgTable(
  'partida_alteracao',
  {
    id: serial('id').primaryKey(),
    partidaId: integer('partida_id')
      .notNull()
      .references(() => partida.id, { onDelete: 'cascade' }),
    campo: text('campo').notNull(),
    de: text('de'),
    para: text('para'),
    fonte: text('fonte'),
    observadoEm: timestamp('observado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('partida_alteracao_partida_ix').on(t.partidaId)],
)

// ─────────────────────────────────────────────────────────────
// Snapshots — série temporal, gravada só quando a tabela muda
// ─────────────────────────────────────────────────────────────

export const snapshot = pgTable(
  'snapshot',
  {
    id: serial('id').primaryKey(),
    temporadaId: integer('temporada_id')
      .notNull()
      .references(() => temporada.id, { onDelete: 'cascade' }),
    /** Hash da classificação. A unicidade é o que evita gravar repetido. */
    hash: text('hash').notNull(),
    origem: text('origem').notNull(),
    rodada: smallint('rodada'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('snapshot_uq').on(t.temporadaId, t.hash),
    index('snapshot_temp_criado_ix').on(t.temporadaId, t.criadoEm),
  ],
)

export const snapshotClube = pgTable(
  'snapshot_clube',
  {
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => snapshot.id, { onDelete: 'cascade' }),
    clubeId: integer('clube_id')
      .notNull()
      .references(() => clube.id),
    posicao: smallint('posicao').notNull(),
    pontos: smallint('pontos').notNull(),
    jogos: smallint('jogos').notNull(),
    vitorias: smallint('vitorias').notNull(),
    empates: smallint('empates').notNull(),
    derrotas: smallint('derrotas').notNull(),
    golsPro: smallint('gols_pro').notNull(),
    golsContra: smallint('gols_contra').notNull(),
    saldoGols: smallint('saldo_gols').notNull(),
    aproveitamento: integer('aproveitamento'),
  },
  (t) => [uniqueIndex('snapshot_clube_uq').on(t.snapshotId, t.clubeId)],
)

export const snapshotCompetidor = pgTable(
  'snapshot_competidor',
  {
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => snapshot.id, { onDelete: 'cascade' }),
    competidorId: integer('competidor_id')
      .notNull()
      .references(() => competidor.id),

    classicoPontos: smallint('classico_pontos'),
    classicoSaldoGols: smallint('classico_saldo_gols'),
    classicoGolsPro: smallint('classico_gols_pro'),
    classicoGolsContra: smallint('classico_gols_contra'),
    classicoPosicao: smallint('classico_posicao'),
    classicoPremioCentavos: integer('classico_premio_centavos').notNull().default(0),

    posicaoPontos: smallint('posicao_pontos'),
    posicaoAcertosFaixa: smallint('posicao_acertos_faixa'),
    posicaoAcertosG4: smallint('posicao_acertos_g4'),
    posicaoAcertosZ4: smallint('posicao_acertos_z4'),
    posicaoPosicao: smallint('posicao_posicao'),
    posicaoPremioCentavos: integer('posicao_premio_centavos').notNull().default(0),
  },
  (t) => [uniqueIndex('snapshot_competidor_uq').on(t.snapshotId, t.competidorId)],
)

// ─────────────────────────────────────────────────────────────
// Governo de fontes
// ─────────────────────────────────────────────────────────────

export const fonteChamada = pgTable(
  'fonte_chamada',
  {
    id: serial('id').primaryKey(),
    fonte: text('fonte').notNull(),
    operacao: text('operacao').notNull(),
    sucesso: boolean('sucesso').notNull(),
    httpStatus: smallint('http_status'),
    duracaoMs: integer('duracao_ms'),
    erro: text('erro'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('fonte_chamada_fonte_criado_ix').on(t.fonte, t.criadoEm)],
)

export const divergencia = pgTable(
  'divergencia',
  {
    id: serial('id').primaryKey(),
    temporadaId: integer('temporada_id').references(() => temporada.id, { onDelete: 'cascade' }),
    tipo: tipoDivergencia('tipo').notNull(),
    detalhe: jsonb('detalhe').notNull(),
    resolvidoPor: text('resolvido_por'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('divergencia_temp_criado_ix').on(t.temporadaId, t.criadoEm)],
)

export const esquema = {
  temporada,
  clube,
  clubeAlias,
  competidor,
  competidorAlias,
  apostaClassico,
  apostaPosicao,
  partida,
  partidaAlteracao,
  snapshot,
  snapshotClube,
  snapshotCompetidor,
  fonteChamada,
  divergencia,
}
