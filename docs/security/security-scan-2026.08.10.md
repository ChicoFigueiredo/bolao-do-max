# Security Review: bolao.maxmat1.com.br

## Scope

Entire repository Deep scan; canonical threat model synthesized from terminal discovery worker models.

- Scan mode: deep_repository
- Target kind: git_revision
- Target ID: target_sha256_476f2e9787e15d80439d9a29934b50ee59de962500ce896c9323a744de96830d
- Revision: 8b6d1fa924d5a741f7fd05a21839c83e40f6260f
- Inventory strategy: repository
- Included paths: .
- Excluded paths: none
- Runtime or test status: not recorded
- Artifacts reviewed: artifacts/deep_discovery/coordinator-manifest.json, artifacts/02_discovery/in_scope_files.txt, artifacts/02_discovery/candidate_ledger.jsonl

Limitations and exclusions:
- Offline static validation; no network, credential, or live-service testing.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable DSS findings | 3 |
| Report instances | 3 |
| Report severity mix | medium: 3 |
| Report confidence mix | medium: 3 |
| Coverage | partial |
| Validation mode | centralized compact Deep candidate validation |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

The public Next.js API cache-fallback paths, external provider ingestion, data stores, privileged operational tooling, and archived deployment material are the key surfaces.

### Assets

- ranking integrity
- service availability
- provider and infrastructure credentials

### Trust Boundaries

- anonymous HTTP to Next.js
- web/worker to Redis and PostgreSQL
- worker to external providers
- operator tooling to production infrastructure

### Attacker Capabilities

- anonymous request concurrency
- repository/workspace read access where granted

### Assumptions

- Current production uses the non-legacy Compose topology.
- Redis is normally derived cache and PostgreSQL the source of truth.

## Findings

| Findings | Reports | Severity | Confidence | Detailed write-up |
| --- | --- | --- | --- | --- |
| Public evolution endpoint recomputes complete history during cache outages | [occ_584847ddae1e8df3d973f270](#finding-1) | medium | medium | occ_584847ddae1e8df3d973f270: inline below |
| Public results API recomputes rankings for each cache-miss request | [occ_682800828a527316bf18e627](#finding-2) | medium | medium | occ_682800828a527316bf18e627: inline below |
| Competitor-detail fallback computes rankings before rejecting arbitrary names | [occ_82135c54123a5c452fc9f233](#finding-3) | medium | medium | occ_82135c54123a5c452fc9f233: inline below |

### Confidence Scale

| Label | Meaning |
| --- | --- |
| high | Direct evidence supports the finding with no material unresolved blocker. |
| medium | Evidence supports a plausible issue, but material runtime or reachability proof remains. |
| low | Evidence is incomplete and the item is retained only for explicit follow-up. |

<a id="finding-1"></a>

### [1] Public evolution endpoint recomputes complete history during cache outages

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Static source traces establish the entrypoint-to-computation path, but no production capacity or proxy-rate-limit evidence was available. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400 |
| Affected lines | apps/web/app/api/evolucao/route.ts:15-40, apps/worker/src/casos/series.ts:58-83 |

#### Summary

Anonymous `/api/evolucao` requests fall back from Redis to season-wide history calculation with no application-level rate limit, request coalescing, circuit breaker, or response cache.

#### Root Cause

Cache failure directly invokes global history work and returns it with no-store semantics.

**Redis failure reaches history fallback** — `apps/web/app/api/evolucao/route.ts:27-40`

A public request reaches global history computation whenever the cache value is missing or Redis fails.

```typescript
try {\n  const pronta = await cacheCompartilhado(cfg).lerEvolucao(...)\n  if (pronta) return Response.json(pronta, { headers: { 'Cache-Control': 'no-store' } })\n} catch { /* Redis fora do ar — calcula */ }\nconst h = await calcularHistorico()
```

**History reads current-season snapshots** — `apps/worker/src/casos/series.ts:58-83`

Each fallback obtains season-wide history before it resamples the response in memory.

```typescript
const linhas = await db.select(...).from(snapshotCompetidor)\n  .innerJoin(snapshot, eq(snapshot.id, snapshotCompetidor.snapshotId))\n  .innerJoin(competidor, eq(competidor.id, snapshotCompetidor.competidorId))\n  .where(eq(snapshot.temporadaId, t.id))\n  .orderBy(asc(snapshot.criadoEm))
```

#### Validation

Confirmed anonymous cache miss/error path to season-wide query and resampling.

Validation method: static source trace

#### Dataflow

The canonical finding records the affected path at apps/web/app/api/evolucao/route.ts:15-40, apps/worker/src/casos/series.ts:58-83, but no expanded source-to-sink narrative was recorded.

- **Source:** public GET /api/evolucao

- **Sink:** PostgreSQL snapshot history query and in-memory resampling

- **Outcome:** amplified CPU and database load

**Redis failure reaches history fallback** — `apps/web/app/api/evolucao/route.ts:27-40`

A public request reaches global history computation whenever the cache value is missing or Redis fails.

```typescript
try {\n  const pronta = await cacheCompartilhado(cfg).lerEvolucao(...)\n  if (pronta) return Response.json(pronta, { headers: { 'Cache-Control': 'no-store' } })\n} catch { /* Redis fora do ar — calcula */ }\nconst h = await calcularHistorico()
```

**History reads current-season snapshots** — `apps/worker/src/casos/series.ts:58-83`

Each fallback obtains season-wide history before it resamples the response in memory.

```typescript
const linhas = await db.select(...).from(snapshotCompetidor)\n  .innerJoin(snapshot, eq(snapshot.id, snapshotCompetidor.snapshotId))\n  .innerJoin(competidor, eq(competidor.id, snapshotCompetidor.competidorId))\n  .where(eq(snapshot.temporadaId, t.id))\n  .orderBy(asc(snapshot.criadoEm))
```

#### Reachability

Public route; Redis miss/error is the precondition.

#### Severity

**Medium** — A public cache-degradation path can multiply PostgreSQL and CPU work through concurrent anonymous requests; production capacity and upstream throttling are not available.

A demonstrated effective upstream rate limit or bounded degraded-mode cache would lower the practical risk; runtime saturation measurements could raise it.

#### Remediation

Coalesce history calculation per window, add a short degraded-mode TTL, and rate-limit fallback requests.

Tests:
- Concurrent cache-miss requests should share one history calculation.

Preventive controls:
- Use shared single-flight and degraded-mode response caching for public cache-backed API fallbacks.

<a id="finding-2"></a>

### [2] Public results API recomputes rankings for each cache-miss request

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Static source traces establish the entrypoint-to-computation path, but no production capacity or proxy-rate-limit evidence was available. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400 |
| Affected lines | apps/web/app/api/resultados/route.ts:13-68, apps/web/lib/dados.ts:30-65 |

#### Summary

Every anonymous `/api/resultados` request calls the shared result loader, which recomputes rankings from PostgreSQL on a Redis miss or error without application-level fallback caching, coalescing, or rate limiting.

#### Root Cause

Availability fallback has no control that shares or bounds repeated public computation.

**Public results always load result** — `apps/web/app/api/resultados/route.ts:13-68`

Every public results request enters the cache-backed global result loader and response caching is disabled.

```typescript
export async function GET() {\n  const r = await lerResultado()\n  // serialize complete public standings\n  return Response.json(legado, { headers: cors() })\n}\nconst cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
```

**Loader falls back to ranking calculation** — `apps/web/lib/dados.ts:30-65`

On an absent cache value or Redis error, each caller starts PostgreSQL-backed ranking work.

```typescript
try {\n  const doCache = await c.lerResultado()\n  if (doCache) return { ...doCache, origemLeitura: 'cache' }\n} catch { /* Redis fora do ar — segue para o banco */ }\nconst r = await calcularRankings(db, t.id)
```

#### Validation

Confirmed public entrypoint and direct cache-miss/error ranking fallback.

Validation method: static source trace

#### Dataflow

The canonical finding records the affected path at apps/web/app/api/resultados/route.ts:13-68, apps/web/lib/dados.ts:30-65, but no expanded source-to-sink narrative was recorded.

- **Source:** public GET /api/resultados

- **Sink:** PostgreSQL calcularRankings

- **Outcome:** amplified compute and database load

**Public results always load result** — `apps/web/app/api/resultados/route.ts:13-68`

Every public results request enters the cache-backed global result loader and response caching is disabled.

```typescript
export async function GET() {\n  const r = await lerResultado()\n  // serialize complete public standings\n  return Response.json(legado, { headers: cors() })\n}\nconst cors = () => ({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' })
```

**Loader falls back to ranking calculation** — `apps/web/lib/dados.ts:30-65`

On an absent cache value or Redis error, each caller starts PostgreSQL-backed ranking work.

```typescript
try {\n  const doCache = await c.lerResultado()\n  if (doCache) return { ...doCache, origemLeitura: 'cache' }\n} catch { /* Redis fora do ar — segue para o banco */ }\nconst r = await calcularRankings(db, t.id)
```

#### Reachability

Public route; Redis miss or outage is the precondition.

#### Severity

**Medium** — A public cache-degradation path can multiply PostgreSQL and CPU work through concurrent anonymous requests; production capacity and upstream throttling are not available.

A demonstrated effective upstream rate limit or bounded degraded-mode cache would lower the practical risk; runtime saturation measurements could raise it.

#### Remediation

Use a single-flight result recomputation with a short fallback TTL and rate-limit public results requests during cache outage.

Tests:
- Concurrent result-cache misses should invoke only one ranking calculation.

Preventive controls:
- Use shared single-flight and degraded-mode response caching for public cache-backed API fallbacks.

<a id="finding-3"></a>

### [3] Competitor-detail fallback computes rankings before rejecting arbitrary names

| Field | Value |
| --- | --- |
| Severity | medium |
| Confidence | medium |
| Confidence rationale | Static source traces establish the entrypoint-to-computation path, but no production capacity or proxy-rate-limit evidence was available. |
| Category | Uncontrolled resource consumption |
| CWE | CWE-400 |
| Affected lines | apps/web/app/api/competidor/route.ts:17-49, apps/web/lib/dados.ts:30-65 |

#### Summary

A public competitor-detail request calls the global result fallback after a detail-cache miss before checking whether the requested `nome` is valid. Invalid names can therefore trigger full ranking computation during Redis degradation.

#### Root Cause

The route computes global results before it verifies that the requested competitor exists.

**Name lookup follows fallback** — `apps/web/app/api/competidor/route.ts:25-43`

Any cache-miss name causes result loading before the route can return 404.

```typescript
const pronto = await cacheCompartilhado(cfg).lerDetalhe(..., nome)\nif (pronto) return Response.json(pronto, { headers: cabecalhos('cache') })\n// Redis error also reaches this path\nconst r = await lerResultado()\n// requested name is checked only afterwards
```

**Result miss recalculates rankings** — `apps/web/lib/dados.ts:30-65`

Missing result cache or a Redis error transfers work to PostgreSQL ranking computation.

```typescript
try {\n  const doCache = await c.lerResultado()\n  if (doCache) return { ...doCache, origemLeitura: 'cache' }\n} catch { /* Redis fora do ar — segue para o banco */ }\nconst { db, fechar } = abrirBanco()\nconst r = await calcularRankings(db, t.id)
```

#### Validation

Confirmed cache-miss call order and database ranking fallback.

Validation method: static source trace

#### Dataflow

The canonical finding records the affected path at apps/web/app/api/competidor/route.ts:17-49, apps/web/lib/dados.ts:30-65, but no expanded source-to-sink narrative was recorded.

- **Source:** public nome parameter

- **Sink:** calcularRankings via lerResultado

- **Outcome:** repeated global database work

**Name lookup follows fallback** — `apps/web/app/api/competidor/route.ts:25-43`

Any cache-miss name causes result loading before the route can return 404.

```typescript
const pronto = await cacheCompartilhado(cfg).lerDetalhe(..., nome)\nif (pronto) return Response.json(pronto, { headers: cabecalhos('cache') })\n// Redis error also reaches this path\nconst r = await lerResultado()\n// requested name is checked only afterwards
```

**Result miss recalculates rankings** — `apps/web/lib/dados.ts:30-65`

Missing result cache or a Redis error transfers work to PostgreSQL ranking computation.

```typescript
try {\n  const doCache = await c.lerResultado()\n  if (doCache) return { ...doCache, origemLeitura: 'cache' }\n} catch { /* Redis fora do ar — segue para o banco */ }\nconst { db, fechar } = abrirBanco()\nconst r = await calcularRankings(db, t.id)
```

#### Reachability

The route is anonymous; cache degradation is required.

#### Severity

**Medium** — A public cache-degradation path can multiply PostgreSQL and CPU work through concurrent anonymous requests; production capacity and upstream throttling are not available.

A demonstrated effective upstream rate limit or bounded degraded-mode cache would lower the practical risk; runtime saturation measurements could raise it.

#### Remediation

Reject or bound unknown names before global calculation; coalesce and cache the shared result fallback.

Tests:
- An invalid cache-miss name must not invoke global ranking calculation.
- Concurrent fallbacks should share one result calculation.

Preventive controls:
- Use shared single-flight and degraded-mode response caching for public cache-backed API fallbacks.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Public cache-backed API fallbacks | Availability | Reported | Three independently reachable cache-miss computation paths reported. |
| External provider ingestion | Integrity | Not applicable | No in-scope attacker-controlled provider boundary was established. |
| Archived root legacy Redis Compose | Network exposure and secret management | Needs follow-up | Static configuration risk exists; live deployment facts are absent. |
| Archived local legacy Redis Compose | Network exposure and secret management | Needs follow-up | Static configuration risk exists; current execution facts are absent. |
| Workspace .env provider keys | Secret management | Not applicable | File is ignored and untracked; no repository-source disclosure path found. |
| Coordinator inventory | Repository coverage | No issue found | Terminal discovery covered 15,189 canonical review items. |

## Open Questions And Follow Up

- Whether reverse-proxy controls bound public request concurrency.
- Database and CPU capacity under concurrent fallback load.
- Archived legacy Redis Compose exposure needs deployment, reachability, and credential-reuse evidence.
  - Follow-up prompt: Review deferred unit candidate-c46e879656cf563e and close its stated proof gap.
- Archived local legacy Redis exposure needs current execution and network-policy evidence.
  - Follow-up prompt: Review deferred unit candidate-4e55e652e5184a5e and close its stated proof gap.
