CREATE TYPE "public"."grupo_aposta" AS ENUM('GP1', 'GP2', 'GP3', 'GP4');--> statement-breakpoint
CREATE TYPE "public"."status_partida" AS ENUM('agendada', 'em_andamento', 'encerrada', 'adiada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_alias" AS ENUM('id_externo', 'nome');--> statement-breakpoint
CREATE TYPE "public"."tipo_divergencia" AS ENUM('tabela_calculada_vs_fonte', 'fonte_vs_fonte', 'clube_nao_resolvido', 'payload_invalido');--> statement-breakpoint
CREATE TABLE "aposta_classico" (
	"id" serial PRIMARY KEY NOT NULL,
	"temporada_id" integer NOT NULL,
	"competidor_id" integer NOT NULL,
	"grupo" "grupo_aposta" NOT NULL,
	"clube_id" integer NOT NULL,
	"coracao" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aposta_posicao" (
	"id" serial PRIMARY KEY NOT NULL,
	"temporada_id" integer NOT NULL,
	"competidor_id" integer NOT NULL,
	"posicao" smallint NOT NULL,
	"clube_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clube" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"sigla" text,
	"escudo_url" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clube_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"clube_id" integer NOT NULL,
	"fonte" text NOT NULL,
	"tipo" "tipo_alias" NOT NULL,
	"chave" text NOT NULL,
	"temporada_ano" integer
);
--> statement-breakpoint
CREATE TABLE "competidor" (
	"id" serial PRIMARY KEY NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competidor_alias" (
	"id" serial PRIMARY KEY NOT NULL,
	"competidor_id" integer NOT NULL,
	"nome" text NOT NULL,
	"temporada_ano" integer
);
--> statement-breakpoint
CREATE TABLE "divergencia" (
	"id" serial PRIMARY KEY NOT NULL,
	"temporada_id" integer,
	"tipo" "tipo_divergencia" NOT NULL,
	"detalhe" jsonb NOT NULL,
	"resolvido_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fonte_chamada" (
	"id" serial PRIMARY KEY NOT NULL,
	"fonte" text NOT NULL,
	"operacao" text NOT NULL,
	"sucesso" boolean NOT NULL,
	"http_status" smallint,
	"duracao_ms" integer,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partida" (
	"id" serial PRIMARY KEY NOT NULL,
	"temporada_id" integer NOT NULL,
	"rodada" smallint NOT NULL,
	"externo_id" text,
	"mandante_id" integer NOT NULL,
	"visitante_id" integer NOT NULL,
	"inicio_previsto" timestamp with time zone,
	"inicio_confirmado" boolean DEFAULT false NOT NULL,
	"estadio" text,
	"status" "status_partida" DEFAULT 'agendada' NOT NULL,
	"gols_mandante" smallint,
	"gols_visitante" smallint,
	"fonte" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partida_alteracao" (
	"id" serial PRIMARY KEY NOT NULL,
	"partida_id" integer NOT NULL,
	"campo" text NOT NULL,
	"de" text,
	"para" text,
	"fonte" text,
	"observado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"temporada_id" integer NOT NULL,
	"hash" text NOT NULL,
	"origem" text NOT NULL,
	"rodada" smallint,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshot_clube" (
	"snapshot_id" integer NOT NULL,
	"clube_id" integer NOT NULL,
	"posicao" smallint NOT NULL,
	"pontos" smallint NOT NULL,
	"jogos" smallint NOT NULL,
	"vitorias" smallint NOT NULL,
	"empates" smallint NOT NULL,
	"derrotas" smallint NOT NULL,
	"gols_pro" smallint NOT NULL,
	"gols_contra" smallint NOT NULL,
	"saldo_gols" smallint NOT NULL,
	"aproveitamento" integer
);
--> statement-breakpoint
CREATE TABLE "snapshot_competidor" (
	"snapshot_id" integer NOT NULL,
	"competidor_id" integer NOT NULL,
	"classico_pontos" smallint,
	"classico_saldo_gols" smallint,
	"classico_gols_pro" smallint,
	"classico_gols_contra" smallint,
	"classico_posicao" smallint,
	"classico_premio_centavos" integer DEFAULT 0 NOT NULL,
	"posicao_pontos" smallint,
	"posicao_acertos_faixa" smallint,
	"posicao_acertos_g4" smallint,
	"posicao_acertos_z4" smallint,
	"posicao_posicao" smallint,
	"posicao_premio_centavos" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "temporada" (
	"id" serial PRIMARY KEY NOT NULL,
	"ano" integer NOT NULL,
	"serie" text DEFAULT 'A' NOT NULL,
	"tem_classico" boolean DEFAULT true NOT NULL,
	"tem_posicao" boolean DEFAULT false NOT NULL,
	"total_rodadas" smallint DEFAULT 38 NOT NULL,
	"total_clubes" smallint DEFAULT 20 NOT NULL,
	"inicio" date,
	"fim" date,
	"encerrada" boolean DEFAULT false NOT NULL,
	"regras" jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aposta_classico" ADD CONSTRAINT "aposta_classico_temporada_id_temporada_id_fk" FOREIGN KEY ("temporada_id") REFERENCES "public"."temporada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aposta_classico" ADD CONSTRAINT "aposta_classico_competidor_id_competidor_id_fk" FOREIGN KEY ("competidor_id") REFERENCES "public"."competidor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aposta_classico" ADD CONSTRAINT "aposta_classico_clube_id_clube_id_fk" FOREIGN KEY ("clube_id") REFERENCES "public"."clube"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aposta_posicao" ADD CONSTRAINT "aposta_posicao_temporada_id_temporada_id_fk" FOREIGN KEY ("temporada_id") REFERENCES "public"."temporada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aposta_posicao" ADD CONSTRAINT "aposta_posicao_competidor_id_competidor_id_fk" FOREIGN KEY ("competidor_id") REFERENCES "public"."competidor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aposta_posicao" ADD CONSTRAINT "aposta_posicao_clube_id_clube_id_fk" FOREIGN KEY ("clube_id") REFERENCES "public"."clube"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clube_alias" ADD CONSTRAINT "clube_alias_clube_id_clube_id_fk" FOREIGN KEY ("clube_id") REFERENCES "public"."clube"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competidor_alias" ADD CONSTRAINT "competidor_alias_competidor_id_competidor_id_fk" FOREIGN KEY ("competidor_id") REFERENCES "public"."competidor"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "divergencia" ADD CONSTRAINT "divergencia_temporada_id_temporada_id_fk" FOREIGN KEY ("temporada_id") REFERENCES "public"."temporada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida" ADD CONSTRAINT "partida_temporada_id_temporada_id_fk" FOREIGN KEY ("temporada_id") REFERENCES "public"."temporada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida" ADD CONSTRAINT "partida_mandante_id_clube_id_fk" FOREIGN KEY ("mandante_id") REFERENCES "public"."clube"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida" ADD CONSTRAINT "partida_visitante_id_clube_id_fk" FOREIGN KEY ("visitante_id") REFERENCES "public"."clube"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida_alteracao" ADD CONSTRAINT "partida_alteracao_partida_id_partida_id_fk" FOREIGN KEY ("partida_id") REFERENCES "public"."partida"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot" ADD CONSTRAINT "snapshot_temporada_id_temporada_id_fk" FOREIGN KEY ("temporada_id") REFERENCES "public"."temporada"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_clube" ADD CONSTRAINT "snapshot_clube_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_clube" ADD CONSTRAINT "snapshot_clube_clube_id_clube_id_fk" FOREIGN KEY ("clube_id") REFERENCES "public"."clube"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_competidor" ADD CONSTRAINT "snapshot_competidor_snapshot_id_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_competidor" ADD CONSTRAINT "snapshot_competidor_competidor_id_competidor_id_fk" FOREIGN KEY ("competidor_id") REFERENCES "public"."competidor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aposta_classico_uq" ON "aposta_classico" USING btree ("temporada_id","competidor_id","grupo");--> statement-breakpoint
CREATE INDEX "aposta_classico_temp_ix" ON "aposta_classico" USING btree ("temporada_id");--> statement-breakpoint
CREATE UNIQUE INDEX "aposta_posicao_uq" ON "aposta_posicao" USING btree ("temporada_id","competidor_id","posicao");--> statement-breakpoint
CREATE INDEX "aposta_posicao_temp_ix" ON "aposta_posicao" USING btree ("temporada_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clube_nome_uq" ON "clube" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "clube_alias_uq" ON "clube_alias" USING btree ("fonte","tipo","chave","temporada_ano");--> statement-breakpoint
CREATE INDEX "clube_alias_clube_ix" ON "clube_alias" USING btree ("clube_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competidor_nome_uq" ON "competidor" USING btree ("nome");--> statement-breakpoint
CREATE UNIQUE INDEX "competidor_alias_uq" ON "competidor_alias" USING btree ("nome","temporada_ano");--> statement-breakpoint
CREATE INDEX "competidor_alias_comp_ix" ON "competidor_alias" USING btree ("competidor_id");--> statement-breakpoint
CREATE INDEX "divergencia_temp_criado_ix" ON "divergencia" USING btree ("temporada_id","criado_em");--> statement-breakpoint
CREATE INDEX "fonte_chamada_fonte_criado_ix" ON "fonte_chamada" USING btree ("fonte","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "partida_uq" ON "partida" USING btree ("temporada_id","rodada","mandante_id","visitante_id");--> statement-breakpoint
CREATE INDEX "partida_temp_rodada_ix" ON "partida" USING btree ("temporada_id","rodada");--> statement-breakpoint
CREATE INDEX "partida_inicio_ix" ON "partida" USING btree ("inicio_previsto");--> statement-breakpoint
CREATE INDEX "partida_status_ix" ON "partida" USING btree ("status");--> statement-breakpoint
CREATE INDEX "partida_alteracao_partida_ix" ON "partida_alteracao" USING btree ("partida_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_uq" ON "snapshot" USING btree ("temporada_id","hash");--> statement-breakpoint
CREATE INDEX "snapshot_temp_criado_ix" ON "snapshot" USING btree ("temporada_id","criado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_clube_uq" ON "snapshot_clube" USING btree ("snapshot_id","clube_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_competidor_uq" ON "snapshot_competidor" USING btree ("snapshot_id","competidor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "temporada_ano_serie_uq" ON "temporada" USING btree ("ano","serie");