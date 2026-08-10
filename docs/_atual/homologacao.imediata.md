# Homologação imediata — Bolão do Max novo

Como subir a pilha nova em localhost e o que conferir.

> **Nada em produção é tocado.** O bolão atual continua rodando em
> `bolao.maxmat1.com.br` no servidor, intacto, e `bolao-max-server/` segue no
> repositório sem uma linha alterada. Tudo aqui roda na sua máquina.

Este roteiro foi percorrido inteiro, do banco vazio ao navegador, em 10/08/2026.

---

## 1. Pré-requisitos

| | |
|---|---|
| Bun | ≥ 1.3 (`bun --version`) |
| Docker | com Compose v2 |
| `.env` na raiz | já preenchido, com as duas chaves de API |

As portas locais são **55432** (Postgres) e **56379** (Redis) — 5432 e 6379 já
estão ocupadas por outros projetos nesta máquina.

---

## 2. Subir do zero

Cinco comandos, na ordem. Tempo total: cerca de dois minutos.

```bash
bun install

bun run infra:up        # Postgres 17 + Redis 8 locais, espelhando produção
bun run db:migrate      # 14 tabelas
bun run db:seed         # 9 temporadas de apostas
bun run worker:ciclo    # primeiro ciclo: ingere as 380 partidas e publica o cache
```

Saída esperada de cada passo:

```
db:migrate    ✓ banco em dia

db:seed       ✓ 34 clubes
              ✓ 45 competidores · 21 apelidos
              ✓ 9 temporadas
              ✓ 1080 apostas do Clássico · 720 palpites de Posição

worker:ciclo  partidas    380 novas · 0 atualizadas · 0 inalteradas
              snapshot    gravado #1
              cache       publicado
              pré-render  60 detalhes · 6 séries
```

Para ter as trajetórias da aba Evolução desde o começo do campeonato, rode
também:

```bash
bun run snapshots:replay   # reconstrói ~146 snapshots das 380 partidas
bun run worker:ciclo       # re-publica o cache com as séries completas
```

> O primeiro ciclo num banco vazio faz a varredura completa das 38 rodadas —
> é a única vez. Depois disso ele busca só as rodadas de interesse, tipicamente
> duas ou três.

## 3. A interface

```bash
bun run web
```

### 👉 http://localhost:3000

Deixe rodando. Para acompanhar a atualização automática, abra outro terminal:

```bash
bun run worker      # daemon: cadência decidida pelo calendário
```

---

## 4. O que conferir na tela

### Os três temas
Menu sanduíche (canto superior direito) → **Tema** → Ocre, Claro, Escuro.

- [ ] Os três são legíveis e coerentes
- [ ] A bola do cabeçalho acompanha o tema — ela usa as variáveis de cor, não
      cor fixa, então inverte no escuro
- [ ] A escolha sobrevive a um F5
- [ ] **Não há piscada** ao recarregar — o tema é aplicado antes da primeira pintura

### As abas
- [ ] **Clássico**, **Por Posição** e **Evolução** trocam sem recarregar
- [ ] A aba escolhida sobrevive a um F5
- [ ] Setas ← → navegam entre as três pelo teclado

### A aba Evolução
- [ ] As três janelas funcionam: 48 horas, 30 dias e Campeonato (por semana)
- [ ] Trocar de janela ou tocar um nome responde de imediato — o worker
      pré-renderiza tudo no Redis, então a tela só lê chave
- [ ] A curva em destaque é a sua, se você se marcou no menu
- [ ] Tocar num nome da lista traz a curva dele para o gráfico grande
- [ ] Os blocos de quem subiu e caiu batem com as setas nas outras abas

### Premiação
- [ ] Quem é premiado tem **★** ao lado do nome — inclusive o último colocado
- [ ] O valor aparece na coluna Prêmio (desktop) e no `title` da estrela

### O detalhamento
Clique em qualquer linha.

- [ ] No Clássico: os 4 clubes com campanha completa — jogos, vitórias,
      empates, derrotas, gols e aproveitamento
- [ ] Em Por Posição: os 8 palpites num eixo de 1º a 20º — círculo vazado é o
      chute, cheio é onde o clube está hoje — com a distância em texto
- [ ] Nas duas abas: quatro tiles de estatística e o gráfico de trajetória
- [ ] Fecha com **Esc** e com toque fora
- [ ] O foco volta para a linha de origem ao fechar

### Primeira visita
Abra numa janela anônima, ou limpe o `localStorage` do site.

- [ ] Aparece o diálogo **"Quem é você?"** com a lista dos 30 apostadores
- [ ] O botão de confirmar fica bloqueado até escolher um nome
- [ ] Esc e clique fora **não** fecham — a escolha é obrigatória
- [ ] "Não aposto, só estou olhando" dispensa o diálogo para sempre
- [ ] Recarregar depois de escolher não pede de novo
- [ ] Escolher "— ninguém —" no menu também não faz o diálogo voltar

### Marcador VOCÊ
Menu → **Meu nome** → escolha seu nome.

- [ ] Aparece um cartão destacado no topo
- [ ] Sua linha ganha borda de destaque

### Mobile
DevTools → 360 px de largura.

- [ ] Sem scroll horizontal
- [ ] As linhas viram cartão com os clubes em uma linha de texto
- [ ] Alvos de toque confortáveis

### Busca
- [ ] Digitar um nome filtra as duas abas

### Regras
- [ ] Botão no **fim de qualquer aba** abre as regras
- [ ] O menu também tem o acesso

---

## 5. O que conferir nos números

O que mais importa homologar é se **o cálculo está certo**.

```bash
bun run provider:doctor     # as fontes respondem?
bun run worker:ciclo --forcar   # força a conferência com as APIs
```

Na saída do ciclo, a linha que interessa:

```
conferência ge + footballdata · 0 divergências de fato · 4 de ordenação · fatos conferem ✓
```

- **`0 divergências de fato`** é o que precisa estar zerado. Significa que a
  tabela que o sistema calcula das partidas concorda com o que as fontes
  informam, clube por clube.
- **`4 de ordenação`** é esperado e não é defeito. A football-data.org desempata
  por saldo de gols antes de vitórias — critério europeu — enquanto o
  Brasileirão desempata por vitórias primeiro. Times empatados em pontos saem em
  ordem diferente sem que nenhum número esteja errado.

### Comparar com a produção atual

```bash
curl -s https://bolao.maxmat1.com.br/resultados | jq '.Competidores[0]'
curl -s http://localhost:3000/api/resultados     | jq '.Competidores[0]'
```

O contrato de campos é o mesmo — `Nome`, `Pontos`, `Saldo_Gols`, `Posicao`,
`Premio`, `Clubes`, `PalpitesPosicao` — de propósito: o endpoint atual tem CORS
aberto e pode ter consumidores que ninguém mapeou.

**Os prêmios de 2º e 3º vão divergir, e isso é a correção que você aprovou:**

| | Produção atual | Local |
|---|---|---|
| 2º lugar | R$ 600,00 | **R$ 650,00** |
| 3º lugar | R$ 300,00 | **R$ 350,00** |

Com os valores corrigidos a arrecadação fecha exatamente nos R$ 530,00 da Mega
da Virada; com os antigos sobrariam R$ 630,00.

**Empates agora colapsam.** No Bolão por Posição você vai ver `1º, 2º, 2º, 4º,
4º, 6º`. Três competidores podem ter os mesmos pontos em posições diferentes —
não é defeito: quem tem pontos iguais mas perde num critério de desempate fica
atrás. Vale conferir se essa leitura te agrada na tela.

## 6. O histórico

```bash
bun run historico
```

Quatro temporadas que nunca tiveram resultado salvo em lugar nenhum:

```
2022  ✓  campeão do Clássico: Daiane   262 pts
2023  ✓✓ campeão do Clássico: Daiane   240 pts
2024  ✓✓ campeão do Clássico: Renato   241 pts
2025  ✓  campeão do Clássico: Alan     260 pts
```

`✓✓` = conferido contra duas fontes independentes.

> **Um ponto que precisa da sua decisão.** O comando avisa que os 8 palpites do
> Chico em 2024 reproduzem a tabela final exata. Acertar 8 de 8 não acontece
> como previsão — a aposta foi provavelmente preenchida depois do encerramento,
> ao testar o Bolão por Posição, que estreou naquele ano. Se você lembrar da
> aposta original, corrija `seeds/apostas/2024.json` e rode `bun run db:seed`
> seguido de `bun run historico`.
>
> **2018 a 2021 não têm resultado.** Nenhuma fonte gratuita cobre essas
> temporadas (ver §0 de [`cfg.fornecedores.md`](cfg.fornecedores.md)). As
> apostas estão importadas; só a classificação final falta.

---

## 7. Verificação técnica

```bash
bun run test        # 39 testes, 539 asserções
bun run typecheck   # worker, pacotes e web
bun run web:build   # build de produção sob Bun
```

> **Não rode `web:build` com o `bun run web` no ar.** Os dois escrevem em
> `apps/web/.next`, e o build sobrescreve os chunks que o servidor de
> desenvolvimento está servindo — o navegador passa a pedir um `main-app.js`
> que não existe mais e a página quebra com 404 no console. Se acontecer: pare
> o servidor, `rm -rf apps/web/.next` e suba de novo.

O teste que mais vale conhecer é o **teste de ouro**: ele reproduz a captura da
produção de 09/08/2026 campo a campo — incluindo os prêmios errados e os
empates não colapsados — antes de qualquer correção entrar. É o que garante que
a reescrita não mudou resultado por acidente.

---

## 8. Tabela de referência

| Comando | O que faz |
|---|---|
| `bun run infra:up` | sobe Postgres e Redis locais |
| `bun run infra:down` | derruba, preservando os dados |
| `bun run infra:reset` | derruba **apagando os volumes** e sobe limpo |
| `bun run db:migrate` | aplica migrations (idempotente) |
| `bun run db:seed` | carrega `seeds/` no banco (idempotente) |
| `bun run worker:ciclo` | um ciclo e relatório |
| `bun run snapshots:replay` | reconstrói a série histórica das partidas |
| `bun run worker:ciclo --forcar` | idem, forçando a conferência com as APIs |
| `bun run worker` | daemon com cadência automática |
| `bun run web` | interface em http://localhost:3000 |
| `bun run provider:doctor` | diagnóstico das fontes |
| `bun run historico` | recalcula as temporadas encerradas |
| `bun run sync:partidas` | ressincroniza o calendário completo |
| `bun run seeds:apostas` | reextrai as apostas dos arquivos legados |
| `bun run seeds:tabelas` | rebusca as tabelas finais das APIs |
| `bun run seeds:alias` | regera o mapa de nomes de clube por fonte |

### Rotas

| Rota | Conteúdo |
|---|---|
| `/` | a interface |
| `/api/resultados` | contrato compatível com o `/resultados` atual |
| `/api/competidor?nome=Alan` | detalhamento de um competidor, sob demanda |

### Consultar o banco direto

```bash
docker exec -it bolao-dev-postgres psql -U bolao -d bolao
```

```sql
select ano, tem_posicao, encerrada from temporada order by ano;
select status, count(*) from partida group by status;
select criado_em, rodada, origem from snapshot order by criado_em desc limit 5;
select fonte, count(*), max(criado_em) from fonte_chamada group by fonte;
select tipo, criado_em, detalhe from divergencia order by criado_em desc limit 5;
```

---

## 9. Ainda não feito

Para não haver surpresa na homologação:

- **Deploy.** Nada foi ao servidor. As fases de deploy e virada (10 e 11 do
  [plano](../plan/plan-refactor-bolao.md)) não foram executadas e dependem da
  sua aprovação. Os scripts já existem e estão verificados até onde é possível
  sem enviar nada: [deploy, backup e restore](deploy.e.backup.md).
- ~~**Sparklines de trajetória.**~~ Estava listado aqui por engano: a mini-curva
  por competidor existe, nas linhas da aba Evolução, com a mesma escala do
  protótipo. As abas Clássico e Posição não têm coluna de gráfico — no protótipo
  também não têm.
- **Páginas de temporada encerrada e hall da fama.** O cálculo existe e roda por
  CLI; as rotas `/t/[ano]` e `/historico` não foram criadas.
- **Simulador.** Fora do escopo desta entrega. O modelo de dados o viabiliza —
  as 380 partidas com horário estão em banco e `calcularTabela` aceita placares
  hipotéticos —, mas não há interface.
- **2018 a 2021 sem resultado**, conforme §6.
