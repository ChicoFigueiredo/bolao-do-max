# Especificação — Bolão do Max

Especificação funcional e técnica do sistema em produção em https://bolao.maxmat1.com.br

| | |
|---|---|
| **Aplicação** | `bolao-max-server` |
| **Domínio** | bolao.maxmat1.com.br |
| **Temporada ativa** | Brasileirão Série A 2026 |
| **Competidores** | 30 |
| **Levantado em** | 09/08/2026 |
| **Método** | Leitura do código-fonte + captura do HTML renderizado e do endpoint `/resultados` em produção + execução dos handlers de clique contra os dados reais |

Todos os exemplos de dados neste documento vêm da captura de produção de **09/ago/2026 18:45:03**.

---

## 1. O que o sistema é

Um placar em tempo quase-real de dois bolões paralelos sobre o Campeonato Brasileiro Série A, disputados pelo mesmo grupo de 30 apostadores com uma única aposta de R$155,00.

O sistema **não recebe apostas**. As apostas são fechadas antes do campeonato e ficam versionadas em um arquivo JSON. O que o sistema faz é, de minuto em minuto, buscar a classificação atualizada do Brasileirão, recalcular a pontuação de todo mundo segundo duas regras diferentes, ordenar os dois rankings, atribuir prêmios e publicar o resultado numa página única.

É read-only para o usuário final: não há login, formulário, sessão, cookie funcional ou qualquer escrita originada do navegador.

### Os três bolões

| Bolão | Mecânica | Prêmio total | Onde vive |
|---|---|---|---|
| **Clássico** | Soma dos pontos de 4 clubes fixos | R$ 3.120,00 | Calculado e exibido |
| **Por Posição** | Acerto do G4 e do Z4 e suas posições | R$ 1.000,00 | Calculado e exibido |
| **Mega Sena da Virada** | Aposta de 9 dezenas com o troco | R$ 530,00 | Só texto — não há código |

Fechamento da conta: 30 × R$155,00 = **R$ 4.650,00**; R$ 3.120 (Clássico) + R$ 1.000 (Posição) + R$ 530 (Mega Sena) = R$ 4.650,00.

> ⚠️ Os valores de 2º e 3º lugar do Clássico **divergem** entre o texto exibido e o código que calcula. Ver [§10.1](#101-prêmios-do-clássico-divergem-entre-texto-e-cálculo).

---

## 2. Arquitetura

```
globoesporte.globo.com/futebol/brasileirao-serie-a
        │
        │  HTTP GET + regex sobre o HTML  (helper/campeonato-brasileiro-modificado-chico.js)
        ▼
  classificação [20 clubes]
        │
        │  + json/bolao.json  (as 30 apostas, imutáveis)
        │
        ▼
  helper/regras.bolao.js  ── calcula pontos, ordena, atribui prêmios
        │
        ▼
  Redis  chave `bolao_mem`  (JSON completo, ~112 KB)
        │
        ├──► GET /            → views/index.pug   → HTML ~220 KB
        └──► GET /resultados  → JSON puro (CORS liberado)
```

O Redis **não é opcional**. É o único lugar onde o resultado calculado existe. As rotas leem exclusivamente do cache — nenhuma rota recalcula sob demanda. Sem Redis populado, a rota `/` quebra.

### Stack

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js 14 (fixado no `Dockerfile`) |
| Framework | Express 4.16 |
| Templates | Pug 2.0.0-beta11 |
| Cache | Redis 7.2 (client `redis` ^4.6.11) |
| Agendamento | `node-cron` ^3.0.3 |
| Datas | `moment` + `moment-timezone`, locale `pt-br`, TZ `America/Sao_Paulo` |
| HTTP externo | `request` (deprecado) |
| CSS/JS cliente | Estáticos, sem build step |
| CDN | Bootstrap 4.0.0, jQuery 3.2.1 slim, Popper 1.12.9, Google Fonts (Sunflower) |

Não há bundler, transpilador, TypeScript, testes automatizados nem linter. Todo o código é CommonJS.

---

## 3. Ingestão de dados externos

**Arquivo:** [`helper/campeonato-brasileiro-modificado-chico.js`](../../helper/campeonato-brasileiro-modificado-chico.js)

Monkey-patch sobre o pacote npm `campeonato-brasileiro`, substituindo o método `tabela(serie)`.

1. `GET https://globoesporte.globo.com/futebol/brasileirao-serie-<serie>` com User-Agent falsificado de Chrome 41 no Windows 7.
2. Aplica a regex `/const classificacao = (.*?);\n/gmi` sobre o HTML bruto.
3. `JSON.parse` do grupo capturado e leitura de `.classificacao`.
4. Mapeia cada clube para o formato interno.

A série é fixada em `'a'` em [`atualiza-redis.js:5`](../../atualiza-redis.js#L5) e [`routes/index.js:9`](../../routes/index.js#L9).

### Formato de cada clube após o mapeamento

| Campo interno | Origem no JSON do Globo | Tipo |
|---|---|---|
| `nome` | `nome_popular` | string |
| `pontos` | `pontos` | number |
| `jogos` | `jogos` | number |
| `vitorias` | `vitorias` | number |
| `empates` | `empates` | number |
| `derrotas` | `derrotas` | number |
| `golsPro` | `gols_pro` | number |
| `golsContra` | `gols_contra` | number |
| `saldoGols` | `saldo_gols` | number |
| `percentual` | `aproveitamento` | number |

A `posicao` **não** vem da fonte: é atribuída em [`regras.bolao.js:5-6`](../../helper/regras.bolao.js#L5-L6) pela ordem do array recebido (1 a 20).

### Fragilidades da ingestão

- Depende de o Globo Esporte embutir `const classificacao = {...};` no HTML. Qualquer mudança de front-end quebra o scraping.
- O casamento entre aposta e clube é por **string exata** de `nome_popular` (`t.Clube === posicaoAtual.nome`). Uma renomeação na fonte (ex.: "Athletico-PR" → "Athletico Paranaense") zera silenciosamente os pontos daquele clube.
- Falhas são engolidas: quando a regex não casa, a Promise **nunca resolve nem rejeita** — fica pendente para sempre e o cache simplesmente não é atualizado, mantendo o valor antigo sem nenhum aviso na tela.
- No branch de erro do `request`, a variável `error` do callback sombreia o `error` do `reject` da Promise ([linhas 13 e 42](../../helper/campeonato-brasileiro-modificado-chico.js#L42)) — a chamada `error({...})` invoca o objeto de erro, não o reject, lançando `TypeError`.

---

## 4. Modelo de dados

### 4.1 Entrada — `json/bolao.json`

Base de dados ativa das apostas. Estrutura: um único objeto com a chave `Competidores` (array de 30).

```jsonc
{
  "Competidores": [
    {
      "Nome": "Alan",
      "Pontos": 0,          // zerado na origem; recalculado a cada ciclo
      "Saldo_Gols": 0,      // idem
      "golsPro": 0,         // idem
      "Posicao": 0,         // idem
      "Premio": 1,          // idem (note: number na origem, string na saída)
      "PontosG4Z4": 0,      // idem
      "PosicaoG4Z4": 1,     // idem
      "Clubes": [           // BOLÃO CLÁSSICO — exatamente 4, um por grupo
        {
          "Grupo": "GP1",
          "Clube": "Flamengo",
          "pontos": "9",    // valores da temporada anterior, sobrescritos
          "jogos": "8",
          "Coracao": false  // marca "time do coração"
          // ... demais estatísticas
        }
      ],
      "PalpitesPosicao": [  // BOLÃO POR POSIÇÃO — exatamente 8
        { "Clube": "Palmeiras", "posicao": 1, "acertoG4": false,
          "acertoZ4": false, "acertoPosicao": false, "pontos": 0 }
        // ... posições 1,2,3,4 e 17,18,19,20
      ]
    }
  ]
}
```

Os campos estatísticos do arquivo carregam resíduos da temporada anterior (strings, não números) e são integralmente sobrescritos no primeiro ciclo de cálculo. Só têm valor semântico: `Nome`, `Clubes[].Grupo`, `Clubes[].Clube`, `Clubes[].Coracao`, `PalpitesPosicao[].Clube` e `PalpitesPosicao[].posicao`.

### 4.2 Os quatro grupos de clubes

Cada apostador escolhe **um** clube de cada grupo. Os grupos são pré-definidos por força esperada — observados em 2026:

| Grupo | Clubes disponíveis |
|---|---|
| **GP1** | Flamengo, Vasco, Fluminense |
| **GP2** | Palmeiras, Cruzeiro, Grêmio, Bahia, Mirassol, São Paulo |
| **GP3** | Vitória, Santos, Atlético-MG, Bragantino, Internacional, Corinthians |
| **GP4** | Coritiba, Athletico-PR, Remo, Chapecoense |

Os grupos são dados, não código — vivem apenas dentro de `bolao.json`. Não há validação de que a aposta respeite um clube por grupo.

### 4.3 Saída — chave Redis `bolao_mem`

```jsonc
{
  "Competidores": [ /* 30, ordenados pelo Bolão Clássico */ ],
  "BolaoNovo":    [ /* os MESMOS 30 objetos, ordenados pelo Bolão por Posição */ ],
  "ano": 2026,
  "titulo": "Bolão do Max - 2026",
  "atualizado_em": "09/ago/2026 18:45:03"
}
```

> **`BolaoNovo` compartilha as referências de objeto com `Competidores`** ([`regras.bolao.js:102`](../../helper/regras.bolao.js#L102) usa `.slice(0)`, cópia rasa). Os dois arrays são ordenações distintas do mesmo conjunto de objetos. Consequência: cada competidor carrega simultaneamente os campos dos dois bolões, e o JSON serializa cada objeto **duas vezes** — o que responde por boa parte dos 112 KB do payload.

### 4.4 Campos calculados por competidor

**Bolão Clássico**

| Campo | Cálculo |
|---|---|
| `Pontos` | Soma dos `pontos` dos 4 clubes |
| `Saldo_Gols` | Soma dos `saldoGols` dos 4 clubes |
| `golsPro` | Soma dos `golsPro` dos 4 clubes |
| `Posicao` | Índice 1-based após ordenação |
| `Premio` | String de premiação ou `'-'` |
| `Clubes[].pontos`, `.jogos`, `.vitorias`, `.empates`, `.derrotas`, `.golsPro`, `.golsContra`, `.saldoGols`, `.percentual` | Copiados da classificação atual |

**Bolão por Posição**

| Campo | Cálculo |
|---|---|
| `PalpitesPosicao[].acertoG4` | Palpite em 1–4 **e** clube atualmente em 1–4 |
| `PalpitesPosicao[].acertoZ4` | Palpite em 17–20 **e** clube atualmente em ≥17 |
| `PalpitesPosicao[].acertoPosicao` | Acertou G4/Z4 **e** a posição é exata |
| `PalpitesPosicao[].pontos` | 4 se `acertoPosicao`, 1 se acerto de faixa, senão 0 |
| `PalpitesPosicao[].posicaoAtualTime` | Posição real do clube na tabela |
| `PontosG4Z4` | Soma dos 8 palpites |
| `AcertosG4Z4` | Contagem de acertos de faixa (G4 + Z4) |
| `AcertosG4` / `AcertosZ4` | Contagem por faixa |
| `PosicaoG4Z4` | Índice após ordenação (com tratamento parcial de empate) |
| `PremioG4Z4` | `R$ 1000.00 / n` para os empatados em 1º, senão `'-'` |

`posicaoAtualTime` só é gravado quando o clube é encontrado na classificação. Se o nome não casar, o campo fica `undefined` e a interface de detalhe exibe `Posição Atual undefined`.

---

## 5. Regras de negócio — Bolão Clássico

**Arquivo:** [`helper/regras.bolao.js:12-99`](../../helper/regras.bolao.js#L12-L99)

### 5.1 Pontuação

Soma direta dos pontos que os 4 clubes escolhidos têm na tabela do Brasileirão naquele instante. Sem pesos, bônus ou multiplicadores.

```
Pontos = Σ pontos(clube)  para os 4 clubes do conjunto
```

Exemplo real (Alan, líder em 09/08/2026):

| Grupo | Clube | Pontos |
|---|---|---|
| GP1 | Flamengo | 39 |
| GP2 | Palmeiras | 48 |
| GP3 | Vitória | 26 |
| GP4 | Coritiba | 30 |
| | **Total** | **143** |

### 5.2 Critérios de desempate

Aplicados em cascata ([`regras.bolao.js:81-93`](../../helper/regras.bolao.js#L81-L93)):

1. **Pontos** (maior primeiro)
2. **Saldo de gols** somado dos 4 clubes (maior primeiro)
3. **Gols pró** somados (maior primeiro)
4. **Gols contra** somados (menor primeiro)
5. **Nome** em ordem alfabética crescente

> O texto de regras exibido na página afirma que *"o saldo de gols é o único critério de desempate... caso permaneça empatado, o prêmio será dividido"*. O código implementa **cinco** critérios e, na prática, nunca divide o prêmio do Clássico — o desempate por nome garante ordenação total. Ver [§10.2](#102-desempate-do-clássico-texto-e-código-descrevem-regras-diferentes).

### 5.3 Premiação

| Posição | Valor atribuído pelo código |
|---|---|
| 1º | R$ 2.000,00 |
| 2º | R$ 600,00 |
| 3º | R$ 300,00 |
| Último (30º) | R$ 120,00 |
| Demais | `-` |

A última posição é detectada por `pos == bolao.Competidores.length` — acompanha automaticamente o número de competidores.

---

## 6. Regras de negócio — Bolão por Posição

**Arquivo:** [`helper/regras.bolao.js:42-77, 101-134`](../../helper/regras.bolao.js#L42-L134)

Cada apostador crava 8 palpites: os 4 primeiros colocados (G4, posições 1–4) e os 4 últimos (Z4, posições 17–20), **com a posição exata de cada um**.

### 6.1 Pontuação por palpite

| Situação | Pontos |
|---|---|
| Clube está na faixa certa (G4 ou Z4), posição errada | **1** |
| Clube está na faixa certa **e** na posição exata | **4** |
| Clube fora da faixa | **0** |

Os 4 pontos são absolutos, não cumulativos: o código atribui `t.pontos = 1` e depois sobrescreve com `t.pontos = 4`. O texto da página descreve como "1 ponto + 3 pontos = 4", o que dá o mesmo resultado.

Máximo teórico: 8 palpites × 4 = **32 pontos**.

### 6.2 Condições exatas de acerto

```js
// G4 — regras.bolao.js:50
palpite.posicao entre 1 e 4  E  posicaoReal <= 4

// Z4 — regras.bolao.js:58
palpite.posicao entre 17 e 20  E  posicaoReal >= 17
```

A verificação de Z4 usa apenas `>= 17`, sem teto. Correto para uma tabela de 20 clubes; quebraria numa série com mais times.

### 6.3 Critérios de desempate

1. **PontosG4Z4** (maior primeiro)
2. **AcertosG4Z4** — total de clubes acertados na faixa (maior primeiro)
3. **AcertosG4** (maior primeiro)
4. **AcertosZ4** (maior primeiro)

Sem quinto critério: empates que sobrevivem a esses quatro mantêm a ordem do array de entrada.

### 6.4 Premiação e divisão

Prêmio único de **R$ 1.000,00** para o 1º lugar, dividido igualmente em caso de empate na liderança:

```js
PremioG4Z4 = 'R$ ' + (1000 / dividirPremio).toFixed(2)
```

O contador `dividirPremio` ([linhas 114-130](../../helper/regras.bolao.js#L114-L130)) percorre o ranking e incrementa enquanto os pontos continuarem iguais aos do líder; ao encontrar o primeiro valor diferente, marca `pontosAnterior = -1` para travar novos empates. Todos os empatados recebem `PosicaoG4Z4 = 1`.

**Limitações:**
- Só empates **na 1ª posição** são colapsados. Empates em qualquer outra posição são exibidos como posições distintas. Exemplo real de 09/08/2026: Alan e Chico têm ambos 16 pontos e aparecem como 2º e 3º; Gilson e Daiane têm ambos 14 e aparecem como 4º e 5º.
- O valor é formatado com `.toFixed(2)`, produzindo `R$ 1000.00` — ponto decimal e sem separador de milhar, destoando dos prêmios do Clássico, que são strings fixas no padrão brasileiro (`R$ 2.000,00`).

### 6.5 Exemplo real completo

Renato, líder do Bolão por Posição em 09/08/2026 com **17 pontos**:

| Palpite | Clube | Posição real | Resultado | Pontos |
|---|---|---|---|---|
| 1º | Palmeiras | 1 | ✅ posição exata | 4 |
| 2º | Flamengo | 2 | ✅ posição exata | 4 |
| 3º | Cruzeiro | 5 | fora do G4 | 0 |
| 4º | Fluminense | 4 | ✅ posição exata | 4 |
| 17º | Chapecoense | 20 | 👍 acertou o Z4 | 1 |
| 18º | Vitória | 13 | fora do Z4 | 0 |
| 19º | Remo | 19 | ✅ posição exata | 4 |
| 20º | Coritiba | 9 | fora do Z4 | 0 |
| | | | **Total** | **17** |

---

## 7. Interface

**Arquivos:** [`views/layout.pug`](../../views/layout.pug), [`views/index.pug`](../../views/index.pug), [`public/stylesheets/`](../../public/stylesheets/), [`public/javascripts/bolao.js`](../../public/javascripts/bolao.js)

Página única, server-rendered, sem navegação. Estrutura vertical:

```
┌──────────────────────────────────────────────────┐
│ [pp.jpg]  BOLÃO DO MAX - BRASILEIRÃO 2026        │  h1
│ Resultados em tempo real (atualizado em ...)     │  h2
├──────────────────────────────────────────────────┤
│ BOLÃO CLÁSSICO                                   │  h3
│ ┌────┬──────┬─────┬────┬────────┬──────────────┐ │
│ │Pos │ Nome │ Pts │ SG │ Prêmio │   Clubes     │ │
│ │    │      │     │    │        │GP1│GP2│GP3│GP4│ │
│ ├────┼──────┼─────┼────┼────────┼───┼───┼───┼──┤ │
│ │ 30 linhas clicáveis                          │ │
│ └──────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────┤
│ BOLÃO POR POSIÇÃO                                │  h3
│ ┌────┬──────┬─────┬────────┬─────────┬─────────┐ │
│ │Pos │ Nome │ Pts │ Prêmio │Clubes G4│Clubes Z4│ │
│ │    │      │     │        │1º/2º/3º/│17º...20º│ │
│ ├────┼──────┼─────┼────────┼─────────┼─────────┤ │
│ │ 30 linhas clicáveis, com listas ordenadas    │ │
│ └──────────────────────────────────────────────┘ │
│ Legenda: ✅ = ... | 👍 = ...                      │
├──────────────────────────────────────────────────┤
│ Regras Bolões do MAX 2026  (itens 1 a 8)         │
└──────────────────────────────────────────────────┘
```

### 7.1 Tabela — Bolão Clássico

Cabeçalho de duas linhas: `Pos`, `Nome`, `Pts`, `SG`, `Prêmio` com `rowspan=2`; `Clubes` com `colspan=4`, subdividido em `GP1`–`GP4`.

Formatação condicional:
- **Saldo de gols negativo** → classe `.vermelho` (`color: red`)
- **Time do coração** (`Coracao: true`) → classe `.coracao` (fundo `#AAAAAA`). Nenhum competidor tem essa marcação nos dados de 2026 — o recurso existe em código e CSS mas está inativo.

### 7.2 Tabela — Bolão por Posição

Cabeçalho declara `rowspan=4` para as 4 primeiras colunas, mas só existem 2 linhas de cabeçalho — o navegador corrige o excesso.

As colunas G4 e Z4 renderizam listas `<ol>`: a de G4 com `start=1`, a de Z4 com `start=17`. Cada item recebe sufixo:
- `✅` quando `acertoPosicao` — 4 pontos
- `👍` quando acertou a faixa mas não a posição — 1 ponto
- sem marcador quando errou

A ordem dos itens segue a ordem do array `PalpitesPosicao`, filtrada por `posicao <= 4` e `posicao >= 17`.

### 7.3 Interação: clique nas linhas

**Toda linha das duas tabelas é clicável.** Não há indicação visual disso além de `cursor: pointer` e, no desktop, realce amarelo no hover. O clique dispara um `alert()` nativo do navegador com o detalhamento da pontuação.

O wiring é feito por atributo `onclick` inline gerado no servidor, com o objeto inteiro do competidor serializado via `JSON.stringify` dentro do HTML ([`index.pug:26`](../../views/index.pug#L26) e [`index.pug:52`](../../views/index.pug#L52)).

**Clique na tabela do Clássico** → `demonstrativo(competidor)`. Saída real (Alan, 1º lugar):

```
Alan: 143 pontos / Saldo Gols: 30

  Flamengo: 39 Pontos /  Saldo Gols: 19 /  Jogos: 20

  Palmeiras: 48 Pontos /  Saldo Gols: 22 /  Jogos: 22

  Vitória: 26 Pontos /  Saldo Gols: -9 /  Jogos: 21

  Coritiba: 30 Pontos /  Saldo Gols: -2 /  Jogos: 22
```

**Clique na tabela por Posição** → `demonstrativoG4Z4(competidor)`. Saída real (Renato, 1º lugar):

```
Renato: 17 pontos

  Palmeiras:  Chute 1 | Posição Atual 1 | ✅ 4 pontos

  Flamengo:  Chute 2 | Posição Atual 2 | ✅ 4 pontos

  Cruzeiro:  Chute 3 | Posição Atual 5 |

  Fluminense:  Chute 4 | Posição Atual 4 | ✅ 4 pontos

  Chapecoense:  Chute 17 | Posição Atual 20 | 👍 1 ponto

  Vitória:  Chute 18 | Posição Atual 13 |

  Remo:  Chute 19 | Posição Atual 19 | ✅ 4 pontos

  Coritiba:  Chute 20 | Posição Atual 9 |
```

O detalhe do Clássico mostra pontos, saldo de gols e jogos por clube — **não** mostra vitórias, empates, derrotas, gols pró/contra nem aproveitamento, embora todos esses dados estejam disponíveis no payload.

### 7.4 Estratégia responsiva

Não há CSS responsivo. A escolha da folha de estilo é feita **no servidor**, por detecção de user-agent ([`routes/index.js:14`](../../routes/index.js#L14) com o pacote `browser-detect`, consumido em [`index.pug:5`](../../views/index.pug#L5)):

```pug
link(rel='stylesheet', href= brw.mobile ? '/stylesheets/style.mob.css' : '/stylesheets/style.css')
```

As duas folhas são quase idênticas. As diferenças completas:

| Propriedade | `style.css` (desktop) | `style.mob.css` (mobile) |
|---|---|---|
| `html` font-size | `1.1vw` | `2.3vw` |
| `body` font-size | `1.1vw` | `2.2vw` |
| `img` width | `10vw` | `12vw` |
| `tr:hover` | `background-color: yellow` | **ausente** |

Tipografia em `vw` significa que o texto escala com a largura da viewport sem piso nem teto — em telas muito largas ou muito estreitas o tamanho fica desproporcional.

### 7.5 Classes CSS declaradas mas inexistentes

`index.pug` aplica as classes `.meio` (linhas 29, 30, 56) e `.esquerda` (linha 55), **nenhuma das duas definida** em qualquer folha de estilo. Essas células caem no alinhamento padrão de `<td>` (à esquerda), e não centralizado como o nome sugere.

Classes efetivamente definidas: `.centro`, `.direita`, `.vermelho`, `.coracao`, `.spacamento-lateral`. A classe `.table-striped` vem do Bootstrap 4 via CDN.

---

## 8. Rotas HTTP

| Rota | Método | Resposta | Observações |
|---|---|---|---|
| `/` | GET | HTML renderizado | Lê `bolao_mem`; grava `data_last_get`; responde `500` se o client Redis for falsy |
| `/resultados` | GET | JSON completo | **CORS liberado para qualquer origem**; grava `data_last_get`; retorna `{ msg: 'Cache com erro!' }` com status 200 se não houver Redis |
| `/users` | GET | `respond with a resource` | Scaffold do express-generator, nunca usado |
| qualquer outra | — | 404 via `views/error.pug` | |

O handler de erro renderiza `message`, `status` e **`error.stack`** — o stack trace só é preenchido quando `NODE_ENV=development`; em produção o `<pre>` sai vazio.

`res.send(500)` em [`routes/index.js:21`](../../routes/index.js#L21) funciona — no Express 4.16 a forma numérica ainda define `statusCode = 500` e envia `Internal Server Error` como corpo —, mas está **depreciada** e emite aviso a cada chamada. A forma atual é `res.sendStatus(500)`. Em Express 5 esse comportamento muda: o número passa a ser tratado como corpo.

Já `/resultados` responde a falha de cache com **status 200** e corpo `{ msg: 'Cache com erro!' }`, o que impede qualquer consumidor de distinguir erro de sucesso pelo status.

### Middleware ativo (ordem)

1. Logger próprio de duração — imprime `[STARTED]`, `[FINISHED]` e `[CLOSED]` com o tempo em ms
2. `morgan('dev')`
3. `express.json()`
4. `express.urlencoded({ extended: false })`
5. `cookie-parser`
6. `express.static('public')`

`modules/browserDetectMiddleware.js` existe mas **é código morto**: não é importado em lugar nenhum, tem os parâmetros invertidos (`(res, req)`) e chama um `next()` que não está no escopo. A detecção real acontece direto na rota.

---

## 9. Cache e atualização

**Arquivo:** [`atualiza-redis.js`](../../atualiza-redis.js)

### 9.1 Chaves Redis

| Chave | Conteúdo | Escrita por |
|---|---|---|
| `bolao_mem` | JSON completo do bolão calculado (~112 KB) | ciclo de atualização |
| `bolao_data_atu` | Timestamp da última atualização | ciclo de atualização |
| `data_last_get` | Timestamp do último acesso a `/` ou `/resultados` | rotas |
| `maraca` | `{ value = 'biloca2' }` — teste de conectividade do boot | `app.js:55` |

Nenhuma chave tem TTL. O cache é sobrescrito, nunca expira.

### 9.2 Ciclo de atualização

```
scraping → regras.bolao.js → carimba atualizado_em → SET bolao_mem + bolao_data_atu
```

O timestamp é gerado em `America/Sao_Paulo` no formato `DD/MMM/yyyy HH:mm:ss` com locale `pt-br` (ex.: `09/ago/2026 18:45:03`).

### 9.3 Agendamento

Três gatilhos:

1. **No boot** — `atualiza_cache(app)` é chamado imediatamente ao carregar o módulo.
2. **Cron a cada `MINUTOS_QUANDO_ACESSADO` minutos** (padrão 3) — atualiza **apenas se** houve acesso nos últimos 21 minutos (`data_last_get + 21min >= agora`).
3. **Cron a cada `MINUTOS_QUANDO_NAO_ACESSADO` minutos** (padrão 1) — atualiza **incondicionalmente**.

> ⚠️ O gatilho 3 roda a cada minuto sem nenhuma condição, o que torna o gatilho 2 completamente redundante e inverte a intenção sugerida pelos nomes das variáveis. Ver [§10.3](#103-a-lógica-de-agendamento-está-invertida).

---

## 10. Divergências e defeitos verificados

Levantados na leitura do código e confirmados contra a produção em 09/08/2026.

### 10.1 Prêmios do Clássico divergem entre texto e cálculo

| | 2º lugar | 3º lugar |
|---|---|---|
| Texto exibido — [`index.pug:85`](../../views/index.pug#L85) | R$ 650,00 | R$ 350,00 |
| Coluna "Prêmio" — [`regras.bolao.js:98`](../../helper/regras.bolao.js#L98) | R$ 600,00 | R$ 300,00 |

Confirmado em produção: Chamon (2º) exibe R$ 600,00 e Max (3º) exibe R$ 300,00, logo acima de um texto que promete R$ 650,00 e R$ 350,00.

**A aritmética indica que o texto está correto e o código está defasado**: com 2.000 + 650 + 350 + 120 = 3.120, mais 1.000 do Bolão por Posição, sobram exatamente os **R$ 530** citados no item 8 das regras. Com os valores do código sobrariam R$ 630.

Origem: o commit `160813e` (09/03/2025) atualizou o texto da view sem alterar o cálculo. A divergência está em produção desde então.

### 10.2 Desempate do Clássico: texto e código descrevem regras diferentes

O item 3 das regras exibidas afirma que o saldo de gols é o *único* critério de desempate e que, persistindo o empate, o prêmio é dividido. O código aplica cinco critérios em cascata (§5.2) e nunca divide prêmio no Clássico — a ordenação alfabética final garante desempate total. Um empate real em pontos e saldo seria resolvido silenciosamente por gols pró, gols contra e nome, sem que ninguém veja isso na tela.

### 10.3 A lógica de agendamento está invertida

O job incondicional de 1 minuto (`MINUTOS_QUANDO_NAO_ACESSADO`) roda sempre, independentemente de tráfego. O job condicional de 3 minutos (`MINUTOS_QUANDO_ACESSADO`) nunca acrescenta nada que o primeiro já não tenha feito.

Efeito prático: o sistema faz **até 80 requisições por hora ao globoesporte.globo.com**, 24 horas por dia, durante o ano inteiro — inclusive fora da temporada e em horários sem nenhum acesso.

### 10.4 Página de 220 KB por causa do `onclick` inline

Cada uma das 60 linhas (30 × 2 tabelas) carrega o objeto completo do competidor serializado em JSON dentro do atributo `onclick` — cerca de **3,3 KB por linha**. Isso responde por aproximadamente **197 KB dos 220 KB** do HTML.

Como `Competidores` e `BolaoNovo` compartilham as mesmas referências (§4.3), cada competidor é serializado duas vezes com conteúdo idêntico.

### 10.5 Falha de scraping é invisível

Se a regex não casar, a Promise fica pendente indefinidamente. O cache mantém o último valor bom e a página continua exibindo `atualizado em <timestamp antigo>` sem qualquer aviso. Um scraping quebrado só é perceptível reparando que o timestamp parou de avançar.

### 10.6 Race condition no boot

[`app.js:92`](../../app.js#L92) chama `atualiza_redis(app)` de forma síncrona no carregamento do módulo, enquanto a conexão Redis é estabelecida numa IIFE assíncrona ([`app.js:39-61`](../../app.js#L39-L61)). A primeira tentativa de atualização pode ocorrer antes de o client estar conectado.

### 10.7 Estado global mutável compartilhado

`regras.bolao.js` usa `require('../json/bolao.json')` dentro da função. O `require` é cacheado, então **o mesmo objeto é mutado a cada ciclo** — a ordenação e todos os campos calculados são aplicados repetidamente sobre o resultado anterior. Funciona porque todos os campos são integralmente recomputados, mas é frágil.

O módulo também cria variáveis globais implícitas (sem `const`/`let`/`var`): `calcula_bolao`, `p`, `i`, `pontuacao`, `pontuacaoAtual`, `pos`, `pontosAnterior`, `dividirPremio`. O mesmo em `atualiza-redis.js:13` com `bolao`.

### 10.8 Infra documentada diverge da infra real

O `README.md` e o diretório `apache/` documentam deploy via Apache com `mod_proxy` e certbot. A produção responde com `server: nginx/1.24.0 (Ubuntu)`. O header `x-powered-by: Express` também está exposto.

### 10.9 Configurações de Redis divergentes

| Origem | Porta | Senha (final) |
|---|---|---|
| `app.js` (fallback) | 6399 | ...82 |
| `docker-compose.yaml` | 6379 | ...81 |
| `bolao-max-server/localhost/docker-compose.yaml` | 6399 | ...82 |

Credenciais versionadas em texto claro em ambos os arquivos.

### 10.10 Outros

- `views/bolao.pug` é uma versão antiga e órfã da tabela do Clássico — nenhuma rota a renderiza. Usa `++i` sobre uma global implícita para numerar as linhas.
- `Dockerfile` roda `npm install` e depois `npm ci --only=production`, duplicando a instalação. Tem dois `CMD` — só o último vale; o primeiro (`cd /home/node/app/`) é inócuo.
- `docker-compose.yaml` monta `./app-build:/usr/src/app` e define `working_dir: /usr/src/app`, mas o `Dockerfile` instala em `/home/node/app` e o `CMD` usa caminho absoluto — o volume e o working_dir não afetam a execução.
- O pacote `request` está deprecado desde 2020.
- Node 14 está fora de suporte desde abril de 2023.

---

## 11. Configuração

### Variáveis de ambiente

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `CACHE_URL` | `localhost` | Host do Redis |
| `CACHE_PORT` | `6399` | Porta do Redis |
| `CACHE_PW` | `eYVX...82` | Senha do Redis (usuário fixo `default`) |
| `MINUTOS_QUANDO_ACESSADO` | `3` | Intervalo do cron condicional |
| `MINUTOS_QUANDO_NAO_ACESSADO` | `1` | Intervalo do cron incondicional |
| `NODE_ENV` | — | `development` expõe stack trace na página de erro |

### Execução local

```bash
# Redis isolado
docker compose -f bolao-max-server/localhost/docker-compose.yaml up -d

# App
cd z_legado/bolao-max-server
npm install
PORT=3000 CACHE_URL=localhost CACHE_PORT=6399 \
CACHE_PW=eYVX7EwVmmxKPC-DmwMtyKVge8oLd2t82 npm start
```

### Produção

`docker compose up --build -d` sobe dois containers na rede `rede-maxmat1`: a app (porta `5001:8081`) e o Redis (`6379:6379`, com `--save 20 1` e persistência em `./cache-redis`). Um proxy reverso na frente termina TLS e encaminha para `localhost:5001`.

---

## 12. Comportamentos ausentes

Registrado para evitar suposições em mudanças futuras.

- **Sem autenticação** — a página é pública e anônima
- **Sem escrita pelo usuário** — apostas só mudam editando `json/bolao.json` e reiniciando
- **Sem histórico** — o cache guarda só o estado atual; anos anteriores existem como arquivos JSON e planilhas, mas nenhuma rota os expõe
- **Sem paginação, ordenação ou filtro** na interface
- **Sem estado de fim de campeonato** — nada congela o resultado após a 38ª rodada
- **Sem validação das apostas** — um clube fora do grupo, um palpite duplicado ou um nome inexistente passam silenciosamente e valem 0
- **Sem tratamento de clube não encontrado** — os dois `else` de erro em `regras.bolao.js` estão comentados
- **Sem testes automatizados, linter ou CI**
- **Sem healthcheck ou métrica** — só `console.log`
