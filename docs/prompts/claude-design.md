# Prompt — Repaginação do Bolão do Max

Brief de design pronto para ser entregue ao **claude-design**. A especificação técnica completa do sistema atual está em [`docs/spec/bolao-do-max.md`](../spec/bolao-do-max.md) — leia antes de desenhar.

---

## 1. O pedido

Repaginar a interface de https://bolao.maxmat1.com.br, hoje uma página única com duas tabelas HTML empilhadas, transformando-a em uma experiência com **navegação por abas**, **excelente no mobile** e com **três temas de cor selecionáveis** (ocre, claro e escuro) em um menu sanduíche.

O sistema é um placar em tempo quase-real de um bolão do Brasileirão disputado por 30 apostadores. Ele é **somente leitura**: não há login, formulário, sessão ou qualquer escrita vinda do navegador. O usuário abre a página, procura o próprio nome, confere a pontuação e sai. Esse é o fluxo que precisa ficar bom.

## 2. O que existe hoje

Uma página só, server-rendered em Pug, com esta pilha vertical:

```
[foto]  BOLÃO DO MAX - BRASILEIRÃO 2026
Resultados em tempo real (atualizado em 09/ago/2026 18:45:03)

BOLÃO CLÁSSICO
tabela de 30 linhas × 9 colunas  (Pos, Nome, Pts, SG, Prêmio, GP1, GP2, GP3, GP4)

BOLÃO POR POSIÇÃO
tabela de 30 linhas × 6 colunas, com listas <ol> dentro das duas últimas células

Legenda: ✅ = Acertou a posição (4 pontos) | 👍 = Acertou o G4 ou Z4 (1 ponto)

Regras Bolões do MAX 2026  (8 parágrafos de texto corrido)
```

Clicar em qualquer linha abre um `alert()` nativo do navegador com o detalhamento.

### Problemas concretos a resolver

Levantados na spec, todos verificados em produção:

1. **Não é responsivo.** Existem duas folhas de estilo quase idênticas — `style.css` e `style.mob.css` — e o servidor escolhe uma por *sniffing* de user-agent. As únicas diferenças reais são o `font-size` (`1.1vw` vs `2.3vw`), a largura da imagem e a ausência de `:hover` no mobile. Tipografia em `vw` puro escala sem piso nem teto.
2. **A tabela do Clássico tem 9 colunas.** Num celular isso é ilegível ou exige scroll horizontal.
3. **O detalhamento é um `alert()` nativo.** Texto monoespaçado sem formatação, sem hierarquia, impossível de estilizar, bloqueia a página.
4. **A página pesa 220 KB.** Cada uma das 60 linhas carrega o objeto JSON completo do competidor dentro do atributo `onclick` — ~3,3 KB por linha, ~197 KB só disso.
5. **Nada indica que as linhas são clicáveis** além do `cursor: pointer` e um realce amarelo no hover que não existe no mobile.
6. **As regras são 8 parágrafos de texto corrido** no fim da página, sem hierarquia visual.
7. Classes `.meio` e `.esquerda` são aplicadas no template mas **não existem em nenhum CSS** — as células que deveriam estar centralizadas estão à esquerda.

## 3. O que construir

### 3.1 Navegação por abas

Duas abas: **Bolão Clássico** e **Bolão por Posição**.

- São dois rankings **do mesmo grupo de 30 pessoas**, com regras e ordens diferentes. A mesma pessoa aparece nas duas com posições distintas — deixe isso legível, é fonte de confusão hoje.
- A troca de aba deve ser instantânea, sem ida ao servidor. Os dados dos dois bolões já vêm juntos no mesmo payload.
- A aba ativa precisa sobreviver a um reload (a pessoa atualiza a página o tempo todo pra ver se mudou).
- Abas acessíveis: `role="tablist"`/`role="tab"`/`role="tabpanel"`, navegação por setas, foco visível.

### 3.2 Mobile em primeiro lugar

Presumir que a maioria acessa pelo celular, provavelmente durante os jogos.

- **Abandonar o sniffing de user-agent.** Uma folha de estilo só, com media queries de verdade.
- **Repensar a tabela no mobile.** 9 colunas não cabem. Cards por competidor, colunas colapsáveis, ou qualquer solução que preserve a leitura de ranking sem scroll horizontal — a decisão é sua, mas o critério é: dá pra achar o próprio nome e entender a posição com o polegar, numa mão.
- Alvos de toque confortáveis. As linhas são interativas.
- Tipografia com escala controlada (piso e teto), não `vw` puro.

### 3.3 Detalhamento do competidor

Substituir o `alert()` por um painel próprio — modal, drawer ou expansão inline, o que servir melhor ao mobile.

**No Bolão Clássico**, o detalhe hoje mostra só pontos, saldo de gols e jogos por clube. O payload já traz muito mais e nada disso é usado: **vitórias, empates, derrotas, gols pró, gols contra e aproveitamento**. Há espaço para um detalhamento genuinamente informativo — os 4 clubes do conjunto, cada um com sua campanha, e como cada um contribui para o total.

**No Bolão por Posição**, o detalhe precisa mostrar os 8 palpites confrontados com a realidade: clube, posição chutada, posição atual e quantos pontos aquilo rendeu. Hoje sai assim:

```
Renato: 17 pontos

  Palmeiras:  Chute 1 | Posição Atual 1 | ✅ 4 pontos
  Cruzeiro:  Chute 3 | Posição Atual 5 |
  Chapecoense:  Chute 17 | Posição Atual 20 | 👍 1 ponto
```

A distância entre chute e realidade é a informação mais interessante do bolão inteiro e hoje está enterrada num alert. Vale tratamento visual.

Requisitos: fechar com Esc e com toque fora, foco preso enquanto aberto, foco devolvido à linha de origem ao fechar.

### 3.4 Temas de cor

Três temas selecionáveis, em **menu sanduíche**:

| Tema | Papel |
|---|---|
| **Ocre** | Assinatura do produto — tom terroso, quente. Padrão sugerido. |
| **Claro** | Neutro, alto contraste, legível sob sol |
| **Escuro** | Para uso noturno, durante os jogos |

- A escolha persiste entre visitas (localStorage).
- **Sem flash de tema errado no carregamento** — o tema tem que estar aplicado antes da primeira pintura.
- Na primeira visita, sem preferência salva, respeitar `prefers-color-scheme` para decidir entre claro e escuro; ou assumir ocre como entrada. Justifique a escolha.
- Todas as cores como custom properties. Nenhuma cor hardcoded fora da definição dos temas.
- Os três temas precisam manter contraste AA em texto e nos marcadores semânticos.

O menu sanduíche pode abrigar também: link para as regras, indicação da última atualização e qualquer outro item de navegação que a repaginação criar.

### 3.5 Semântica visual a preservar

Estes sinais existem hoje e carregam significado — precisam sobreviver, ainda que redesenhados:

| Sinal | Significado |
|---|---|
| ✅ | Acertou a posição exata do clube — 4 pontos |
| 👍 | Acertou a faixa (G4 ou Z4) mas não a posição — 1 ponto |
| Saldo de gols em vermelho | Valor negativo |
| Célula com fundo cinza | "Time do coração" (campo `Coracao`) |
| Coluna Prêmio com `-` | Não premiado |

Observação: `Coracao` está `false` para todos os competidores em 2026. O recurso existe em código e CSS mas está inativo — decida se vale manter no desenho.

## 4. Dados disponíveis

O endpoint **https://bolao.maxmat1.com.br/resultados** é público, tem CORS liberado e devolve o payload completo (~112 KB). Use dados reais no protótipo — 30 competidores de verdade, com nomes e números reais.

Estrutura:

```jsonc
{
  "ano": 2026,
  "titulo": "Bolão do Max - 2026",
  "atualizado_em": "09/ago/2026 18:45:03",
  "Competidores": [ /* 30, ordenados pelo Bolão Clássico */ ],
  "BolaoNovo":    [ /* os MESMOS 30, ordenados pelo Bolão por Posição */ ]
}
```

Cada competidor:

```jsonc
{
  "Nome": "Alan",

  // Bolão Clássico
  "Pontos": 143, "Saldo_Gols": 30, "golsPro": 124,
  "Posicao": 1, "Premio": "R$ 2.000,00",
  "Clubes": [                          // exatamente 4, um por grupo
    { "Grupo": "GP1", "Clube": "Flamengo", "Coracao": false,
      "pontos": 39, "jogos": 20, "vitorias": 11, "empates": 6, "derrotas": 3,
      "golsPro": 37, "golsContra": 18, "saldoGols": 19, "percentual": 65 }
  ],

  // Bolão por Posição
  "PontosG4Z4": 16, "PosicaoG4Z4": 2, "PremioG4Z4": "-",
  "AcertosG4Z4": 4, "AcertosG4": 2, "AcertosZ4": 2,
  "PalpitesPosicao": [                 // exatamente 8: posições 1-4 e 17-20
    { "Clube": "Palmeiras", "posicao": 1, "posicaoAtualTime": 1,
      "acertoG4": true, "acertoZ4": false, "acertoPosicao": true, "pontos": 4 }
  ]
}
```

Faixas reais para calibrar o desenho, medidas em 09/08/2026 (campeonato pela metade, ~21ª rodada):

- **Pontos do Clássico:** 88 a 143 — 3 dígitos em toda a coluna
- **Saldo de gols:** −31 a +35, sendo 9 dos 30 negativos (o sinal de menos precisa caber)
- **Pontos por Posição:** 2 a 17 — 1 ou 2 dígitos (máximo teórico 32)
- **Premiados:** 1º, 2º, 3º e o **último** (30º) no Clássico; só o 1º por Posição. O prêmio de lanterna é real (R$ 120,00) e não é pódio — merece tratamento visual distinto, não só a mesma marcação dos três primeiros.
- **Nomes:** de 3 a 12 caracteres — "Max" no mínimo, "Ana Cristina" no máximo
- **Clubes:** de 4 a 13 caracteres — "Remo" no mínimo, "Internacional" no máximo
- **Formatos de prêmio inconsistentes:** o Clássico usa `R$ 2.000,00` (padrão brasileiro) e o de Posição usa `R$ 1000.00` (ponto decimal, sem separador de milhar). Vêm assim do backend. Normalize na apresentação.

## 5. Restrições técnicas

Não negociáveis — o projeto é pequeno, antigo e a simplicidade é intencional.

- **Server-rendered com Pug.** Não há bundler, transpilador ou build step, e não deve passar a haver. Sem React, Vue ou framework de front.
- **Node 14, CommonJS.** Não introduza dependências novas sem necessidade real.
- **CSS e JS estáticos**, servidos de `public/`. JS de navegador pode ser moderno; o servidor é que está preso ao Node 14.
- **O contrato de `/resultados` não muda.** Pode haver consumidores externos — o CORS está aberto por algum motivo.
- **Não alterar as regras de negócio.** Pontuação, desempate e premiação ficam como estão. Esta tarefa é de interface.
- **Corrigir o padrão de `onclick` inline.** Entregue os dados ao cliente uma vez só — um `<script type="application/json">` com o payload, por exemplo — em vez de 60 cópias em atributos HTML. Isso sozinho corta ~197 KB da página.

### Entregável

Um **protótipo HTML estático e autocontido** (CSS e JS inline ou em arquivos irmãos), alimentado com os dados reais do endpoint, cobrindo:

1. As duas abas com o conteúdo completo dos 30 competidores
2. Os três temas funcionando e alternáveis
3. O menu sanduíche
4. O painel de detalhamento das duas tabelas
5. Layout de mobile e de desktop

O protótipo será portado para Pug depois. Mantenha a marcação próxima do que um template Pug simples geraria — evite estruturas que só um framework produziria.

## 6. Fora de escopo

- **A divergência de prêmios.** O texto das regras promete R$ 650,00 e R$ 350,00 para 2º e 3º; o código calcula R$ 600,00 e R$ 300,00. É um bug conhecido, documentado na seção 10.1 da spec, e será corrigido em separado. **Reproduza os valores como vierem do payload** — não tente conciliar.
- Histórico de anos anteriores. Existem dados de 2018 a 2025 em arquivos, mas nenhuma rota os expõe.
- Qualquer funcionalidade de escrita: cadastro de apostas, edição, comentários.
- O agendamento de atualização e o scraping.
- A página de erro.

## 7. Critérios de aceite

1. Funciona bem em tela de 360 px de largura sem scroll horizontal.
2. Achar o próprio nome entre 30 competidores é rápido nas duas abas.
3. Os três temas são coerentes entre si e legíveis; nenhum parece rascunho.
4. A troca de tema é imediata e persiste; nenhum flash no carregamento.
5. O detalhamento supera o `alert()` em clareza, não só em estética.
6. A aba ativa sobrevive ao reload.
7. Navegável por teclado; abas e painel de detalhe com semântica ARIA correta.
8. A página final é substancialmente mais leve que os 220 KB atuais.
9. O HTML entregue é portável para Pug sem reescrita estrutural.
