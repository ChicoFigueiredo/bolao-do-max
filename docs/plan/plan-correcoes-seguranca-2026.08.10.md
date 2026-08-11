# Plano — Correções do relatório de segurança de 10/08/2026

Fechamento dos três achados reportados e dos dois que a varredura não viu, com a causa comum tratada uma vez só.

| | |
|---|---|
| **Escrito em** | 10/08/2026 |
| **Branch** | `feat/nova-interface` |
| **Relatório de origem** | [`docs/security/security-scan-2026.08.10.md`](../security/security-scan-2026.08.10.md) |
| **Revisão auditada** | `8b6d1fa924d5a741f7fd05a21839c83e40f6260f` |
| **Escopo aprovado** | 3 achados do relatório + 2 achados adicionais |
| **Estratégia de defesa** | Aplicação **e** nginx |

---

## 1. O que o relatório encontrou

Três achados, todos `medium`/`medium`, todos a mesma classe: **CWE-400, consumo de recurso não controlado**.

| # | Rota | Fallback que dispara | Arquivos |
|---|---|---|---|
| 1 | `GET /api/evolucao` | `calcularHistorico()` — temporada inteira | [`route.ts:38`](../../apps/web/app/api/evolucao/route.ts#L38), [`series.ts:58-83`](../../apps/worker/src/casos/series.ts#L58-L83) |
| 2 | `GET /api/resultados` | `calcularRankings()` no Postgres | [`route.ts:14`](../../apps/web/app/api/resultados/route.ts#L14), [`dados.ts:30-67`](../../apps/web/lib/dados.ts#L30-L67) |
| 3 | `GET /api/competidor?nome=` | idem, **antes** de saber se o nome existe | [`route.ts:36-42`](../../apps/web/app/api/competidor/route.ts#L36-L42) |

Os três são reais. Verifiquei cada trecho citado contra o código na revisão auditada e as linhas conferem.

## 2. O que o relatório não viu

A varredura descreveu o sintoma — "recalcula por requisição" — e parou antes da causa. Ela está uma camada abaixo.

### 2.1 A web abre um pool de conexões por requisição

[`packages/db/src/index.ts:16-26`](../../packages/db/src/index.ts#L16-L26) — `abrirBanco()` chama `postgres(url, { max: cfg.DATABASE_POOL_MAX })`. Cada chamada instancia um pool novo. `DATABASE_POOL_MAX` tem default **8** ([`config`](../../packages/config/src/index.ts)).

Na web, `abrirBanco()` é chamado **por requisição**, em três lugares: [`dados.ts:44`](../../apps/web/lib/dados.ts#L44), [`dados.ts:79`](../../apps/web/lib/dados.ts#L79) e dentro de `calcularHistorico()` quando a rota de evolução não passa um banco ([`series.ts:60`](../../apps/worker/src/casos/series.ts#L60)).

Isso muda a aritmética do ataque. Com o Redis fora, N requisições anônimas simultâneas não custam N cálculos — custam **N pools × 8 conexões**. O Postgres esgota `max_connections` muito antes de a CPU sofrer, e quando esgota derruba também o worker e qualquer outro inquilino da instância. O relatório calculou o custo em CPU e I/O; o custo real é em conexões, e é uma ordem de grandeza pior.

Vale notar que o projeto **já aprendeu essa lição** — e só a aplicou ao Redis. O comentário em [`dados.ts:11-17`](../../apps/web/lib/dados.ts#L11-L17) explica, com todas as letras, por que o cliente de cache é um por processo e não um por requisição. O mesmo raciocínio nunca chegou ao Postgres.

### 2.2 A home paga Postgres em toda visita, com Redis saudável ou não

[`apps/web/app/page.tsx:8`](../../apps/web/app/page.tsx#L8):

```tsx
const [r, movimento] = await Promise.all([lerResultado(), lerMovimento24h()])
```

`lerResultado()` tem caminho de cache. `lerMovimento24h()` **não tem nenhum** — vai direto ao Postgres, sempre, abrindo pool próprio: três consultas, duas delas com `innerJoin` sobre `snapshotCompetidor` ([`dados.ts:77-130`](../../apps/web/lib/dados.ts#L77-L130)).

Isso não é um caminho degradado. É o caminho comum. Toda visita à home custa um pool e três consultas mesmo com tudo funcionando, e o único freio é quanta gente abre o site. Na prática é o maior consumidor dos três achados somados, e não aparece no relatório porque a varredura procurou fallbacks de cache — e este código nunca teve cache para falhar.

Contradiz explicitamente o desenho declarado em [`cache.ts:53-58`](../../apps/worker/src/cache.ts#L53-L58): *"nenhuma requisição de usuário chega ao Postgres no caminho comum"*. Chega.

### 2.3 `nome` sem limite de tamanho

[`competidor/route.ts:19-30`](../../apps/web/app/api/competidor/route.ts#L19-L30) — o parâmetro vai cru para a chave do Redis. Não há injeção: o client do Bun fala RESP e trata o valor como argumento, não como texto de comando. Mas é cardinalidade e tamanho de chave vindos do público, sem teto. É correção de uma linha e entra junto.

## 3. O que não vai mudar, e por quê

Registrado para que ninguém "conserte" isso depois lendo o relatório sem contexto.

| Item | Decisão | Motivo |
|---|---|---|
| `Access-Control-Allow-Origin: *` em `/api/resultados` | Mantido | Contrato legado deliberado, documentado em [`route.ts:5-12`](../../apps/web/app/api/resultados/route.ts#L5-L12). Dado público de leitura; fechar CORS quebra consumidores não mapeados sem ganhar nada. |
| `Cache-Control: no-store` nas rotas | Mantido | A idade do dado é informação de primeira classe no desenho. Cache de borda esconderia o atraso do worker, que a interface mostra de propósito. |
| Set de nomes válidos pré-publicado no Redis | Fora de escopo | A coalescência da fase 3 já limita o trabalho a um cálculo por janela de TTL, independentemente de quantos nomes inválidos cheguem. A propriedade de segurança sai satisfeita sem estado novo no worker. |
| Compose legado de Redis em `z_legado/` | Fora de escopo | O relatório o marcou como "needs follow-up" por falta de prova de deploy. A stack legada foi derrubada na virada de 10/08. É pergunta de operação, não de código — e a resposta é que não está no ar. |

## 4. Desenho da correção

Três mecanismos, aplicados uma vez, resolvendo os cinco problemas.

```
                   ┌─────────────────────────────────────────┐
  requisição ──►   │  nginx: limit_req (fase 5)              │  ← teto de volume por IP
  anônima          └────────────────────┬────────────────────┘
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │  Redis — caminho comum, inalterado      │  ← acerto sai daqui
                   └────────────────────┬────────────────────┘
                                        ▼ (falha ou ausência)
                   ┌─────────────────────────────────────────┐
                   │  cache efêmero + coalescência (fase 2)  │  ← N requisições, 1 cálculo
                   └────────────────────┬────────────────────┘
                                        ▼
                   ┌─────────────────────────────────────────┐
                   │  pool único do processo (fase 1)        │  ← 8 conexões no total, não 8 por requisição
                   └─────────────────────────────────────────┘
```

**Pool único** tira a amplificação de conexões. **Coalescência** faz N requisições simultâneas compartilharem um cálculo. **TTL curto** faz as requisições seguintes, dentro da janela, não recalcularem nada. Os três juntos transformam "cada requisição custa um cálculo e um pool" em "cada janela de TTL custa um cálculo, sobre um pool que já existia".

O TTL fica **só no caminho de exceção**, depois da tentativa no Redis. Com o Redis saudável nada muda: o acerto de cache continua sendo a primeira coisa que acontece, e quando o Redis volta a primeira requisição já lê dado fresco dele. Zero risco de servir dado velho no caminho comum.

---

## Fase 1 — Pool único na web

**Problema:** §2.1.

**Arquivo:** [`apps/web/lib/dados.ts`](../../apps/web/lib/dados.ts)

Espelhar o padrão que já existe ali para o Redis, com a mesma justificativa escrita:

```ts
let conexaoBanco: ReturnType<typeof abrirBanco> | undefined
export function bancoCompartilhado() {
  if (!conexaoBanco) conexaoBanco = abrirBanco()
  return conexaoBanco.db
}
```

Trocar os dois `abrirBanco()` de `dados.ts` por `bancoCompartilhado()` e **remover os `finally { await fechar() }`** correspondentes — um pool de processo não se fecha por requisição, é exatamente o erro que se está corrigindo.

Em `apps/web/app/api/evolucao/route.ts`, passar o banco compartilhado: `calcularHistorico(bancoCompartilhado())`. `calcularHistorico` já aceita o parâmetro opcional ([`series.ts:58-61`](../../apps/worker/src/casos/series.ts#L58-L61)) e só abre conexão própria quando não recebe um — nenhuma mudança no worker.

Guardar o singleton em `globalThis` para o hot-reload do `next dev` não acumular pools entre recompilações. O singleton do Redis tem hoje o mesmo problema em desenvolvimento; aplicar a guarda aos dois de uma vez, já que é a mesma linha.

**Verificação:** `bun run typecheck`. Nenhum `abrirBanco(` restante em `apps/web/`.

---

## Fase 2 — Coalescência e cache efêmero

**Problema:** base para os achados 1, 2 e 3.

**Arquivo novo:** `apps/web/lib/um-de-cada-vez.ts`

Um módulo, um propósito, sem dependência nova. Duas garantias:

1. **Coalescência** — chamadas concorrentes com a mesma chave compartilham uma execução.
2. **TTL** — o resultado fica em memória por uma janela curta; dentro dela não há execução nova.

```ts
export function umDeCadaVez<T>(chave: string, ttlMs: number, calcular: () => Promise<T>): Promise<T>
```

Regras que os testes vão fixar:

- Rejeição **não** entra no cache e libera a chave em voo. Um erro transitório não pode envenenar a janela inteira.
- A entrada expirada é recalculada, não servida.
- Chaves diferentes não interferem entre si.
- O mapa de valores tem teto de entradas — as chaves são fixas e poucas, mas um teto explícito impede que um erro futuro transforme isto no problema que ele existe para resolver.

**Testes:** `apps/web/test/um-de-cada-vez.test.ts`, com `bun test`. Sem infra: relógio injetado, função contadora.

- N chamadas simultâneas → `calcular` executa **uma** vez, todas recebem o mesmo valor
- Segunda chamada dentro do TTL → nenhuma execução nova
- Chamada após o TTL → executa de novo
- Rejeição → propaga a todos os aguardantes, e a chamada seguinte tenta de novo
- Chaves distintas → execuções independentes

**Verificação:** `bun test` passa antes de qualquer coisa da fase 3 encostar nas rotas.

---

## Fase 3 — Aplicar nos três caminhos de exceção

**Problema:** achados 1, 2 e 3 do relatório, mais §2.3.

Janelas propostas — curtas o bastante para não esconder a recuperação do Redis, longas o bastante para absorver uma rajada:

| Caminho | Chave | TTL |
|---|---|---|
| `lerResultado()` fallback | `resultado` | 15 s |
| `calcularHistorico()` fallback | `historico` | 60 s |
| `lerMovimento24h()` | `movimento` | 60 s |

**`dados.ts`** — envolver o bloco de Postgres de `lerResultado` em `umDeCadaVez('resultado', 15_000, …)`, **depois** do `try` do Redis, sem tocar no caminho de acerto. Mesmo tratamento para `lerMovimento24h`, que passa a ter cache onde não tinha nenhum.

**`evolucao/route.ts`** — `umDeCadaVez('historico', 60_000, () => calcularHistorico(bancoCompartilhado()))`. A validação de `janela` e `bolao` já acontece antes de tudo ([`route.ts:20-23`](../../apps/web/app/api/evolucao/route.ts#L20-L23)) e está correta — nada a fazer ali.

**`competidor/route.ts`** — duas mudanças:

- Teto de tamanho em `nome` antes de qualquer I/O: acima de 80 caracteres, `400`. Nome de competidor não chega perto disso.
- O `lerResultado()` da linha 36 passa a ser coalescido pela mudança em `dados.ts`, sem alteração local. É o que fecha o achado 3: mil nomes inválidos simultâneos custam um cálculo, não mil. A ordem "calcula depois checa" deixa de importar quando o cálculo é compartilhado — e inverter a ordem exigiria estado novo que a §3 descarta.

**Teste:** `nome` de 500 caracteres devolve `400` sem chamar nenhum carregador.

**Verificação:** `bun test`, `bun run typecheck`. Manual com `docker compose -f compose.dev.yml stop cache`: `/`, `/api/resultados`, `/api/evolucao`, `/api/competidor` respondem, e o cabeçalho `X-Origem` mostra `calculado`. Vinte requisições simultâneas com o Redis parado produzem **uma** rodada de consultas no log do Postgres.

---

## Fase 4 — Movimento 24 h pré-renderizado

**Problema:** §2.2 — o custo fixo da home, que a fase 3 reduz mas não elimina.

A fase 3 coloca um TTL de 60 s em `lerMovimento24h`, o que já derruba o custo em duas ordens de grandeza. Esta fase tira o Postgres do caminho comum de vez, que é o que o desenho do projeto promete.

**`apps/worker/src/casos/prerender.ts`** — publicar o movimento no Redis a cada ciclo, ao lado do detalhe e das séries que ele já pré-renderiza. Chave `movimento:<temporada>`, sob o prefixo existente.

**`apps/worker/src/cache.ts`** — `publicarMovimento` / `lerMovimento`, no mesmo formato dos pares que já existem no arquivo.

**`dados.ts`** — `lerMovimento24h` ganha a mesma forma dos outros: tenta o Redis, e só cai no Postgres coalescido se a chave não estiver lá.

O cálculo vive hoje na web ([`dados.ts:77-130`](../../apps/web/lib/dados.ts#L77-L130)) e o worker vai precisar dele. Mover a função para o worker, junto de `series.ts`, que é onde mora o resto da leitura de snapshots; a web importa de lá, como já faz com `calcularRankings` e `calcularHistorico`.

**Verificação:** `bun run worker:ciclo` popula a chave; a home responde com o Redis ativo sem nenhuma consulta ao Postgres no log.

---

## Fase 5 — Teto de volume no nginx

**Problema:** limita a rajada anônima antes de ela chegar na aplicação. Defesa em profundidade — as fases 1 a 4 já limitam o *custo por requisição*; esta limita a *quantidade*.

**A restrição que molda esta fase:** `limit_req_zone` só é válido no bloco `http`, que na máquina é arquivo compartilhado — e o vhost do bolão pertence ao certbot, que o reescreve. Nove sites dependem dessa configuração ([`vhost.conf.template:10-16`](../../infra/nginx/vhost.conf.template#L10-L16)). Editar errado ali não derruba o bolão: derruba os nove.

Duas medidas para que o risco fique perto de zero:

1. **A zona entra em arquivo novo**, `/etc/nginx/conf.d/bolao-limites.conf`, incluído pelo `http` do nginx.conf padrão do Ubuntu. Arquivo novo, aditivo, sem editar nada de ninguém. Declarar uma zona que nenhum vhost referencia não muda comportamento algum — é seguro por construção. **Confirmar no servidor**, antes de escrever, que o `nginx.conf` de lá de fato tem o `include /etc/nginx/conf.d/*.conf;`.
2. **A diretiva `limit_req` entra no vhost do bolão** com a disciplina que o `deploy.ts` já pratica ([`deploy.ts:460-517`](../../infra/bin/deploy.ts#L460-L517)): cópia `.antes-do-limite`, edição, `nginx -t`, e **desfaz antes de reclamar** se reprovar. Nunca `reload` sem `-t` aprovado.

```nginx
# /etc/nginx/conf.d/bolao-limites.conf
limit_req_zone $binary_remote_addr zone=bolao:10m rate=20r/s;

# no location / do vhost do bolão
limit_req zone=bolao burst=40 nodelay;
limit_req_status 429;
```

**Sobre os números:** uma visita humana à home dispara a página mais três chamadas de API. 20 r/s com rajada de 40 é folgado para uma pessoa e para operadoras móveis que compartilham IP por NAT — e é um teto duro para uma inundação. Se algum dia apertar, o número sobe; começar generoso é o certo, porque o falso positivo aqui é um usuário real vendo `429`.

**Etapa nova no deploy:** `etapa('limites de requisição')`, atrás de flag explícita (`--limites`), idempotente — se a linha já está no vhost, não faz nada. Fora do caminho padrão do deploy, para poder ser revertida sozinha sem desfazer a aplicação.

**Verificação:** `nginx -t` aprovado; `for i in $(seq 1 100); do curl -so /dev/null -w '%{http_code} ' https://…/api/resultados; done` mostra `200` até a rajada e `429` depois; navegação normal no celular não vê `429` nenhum.

---

## Fase 6 — Fechamento

- `bun test` e `bun run typecheck` limpos.
- Ensaio completo em desenvolvimento com o Redis parado e com ele no ar.
- Anotar em [`docs/security/security-scan-2026.08.10.md`](../security/security-scan-2026.08.10.md) o estado de cada achado, com o commit que o fecha — o relatório é o registro, e um registro sem desfecho não serve para a próxima varredura.
- Registrar as duas perguntas abertas que o relatório levantou e que **continuam abertas**, porque são de operação e não de código: capacidade real do Postgres sob carga, e o que o proxy compartilhado faz com concorrência hoje.

---

## Resumo do impacto

| Achado | Origem | Fase que fecha |
|---|---|---|
| 1 — evolução recalcula na queda do cache | Relatório | 2, 3 |
| 2 — resultados recalcula por requisição | Relatório | 2, 3 |
| 3 — competidor calcula antes de validar nome | Relatório | 2, 3 |
| Pool de conexões por requisição | Esta análise | 1 |
| Home consulta o Postgres em toda visita | Esta análise | 3, 4 |
| `nome` sem teto de tamanho | Esta análise | 3 |
| Concorrência anônima sem teto | Relatório (§follow-up) | 5 |

Nenhuma dependência nova. Nenhuma mudança de contrato de API. Nenhum arquivo do `z_legado/` tocado.

**Ordem de execução:** 1 → 2 → 3 → 4 → 5 → 6. As fases 1 a 3 são o núcleo e fecham os três achados do relatório; 4 e 5 são ganho real mas podem ser cortadas sem invalidar o resto.
