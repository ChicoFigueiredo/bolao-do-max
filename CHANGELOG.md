# Diário do Bolão do Max

Registro do que quebrou, do que consertou e do que ficou aberto — em ordem
inversa, o mais recente primeiro.

Não é um changelog de releases: para saber o que entrou em cada versão, o `git
log` e as tags (`v2.0.0`, `v2.1.0`) contam melhor. Aqui ficam os episódios que
custaram tempo para entender e cuja lição se perde se não for escrita: o
sintoma, a causa quando encontrada, a causa **quando não** encontrada, e o que
foi feito. O diário começa em 11/08/2026; o que veio antes está no git.

---

## 2026-08-11 — o apagão de 26 h que o healthcheck não viu

O site não abria. O container estava `healthy`, com 26 h de pé, memória e CPU
tranquilas, e nenhum erro no log além de um único aviso no boot.

### O sintoma

Toda resposta **gerada dinamicamente** entregava seus primeiros bytes e travava
para sempre. Não era lentidão: era parada, e nas mesmas fronteiras de buffer a
cada tentativa.

| o que se pediu | o que chegou |
| --- | --- |
| `/api/resultados` | 16384 bytes — 16 KiB exatos, e para |
| `/` pelo domínio | 122880 bytes — 120 KiB exatos, e para |
| `/` interno | 126867 bytes, e para |
| um 404 qualquer | 5445 bytes, e para |
| um JSON de erro de 37 bytes | 37 bytes, e não fecha |

Arquivos estáticos, que saem por outro caminho de envio, iam bem. O HTML chegava
sem `</html>`, sem o payload do RSC e sem os scripts de bootstrap — então o React
nunca hidratava, e o nginx cortava a conexão no `proxy_read_timeout 30s`. Do
lado de quem visitava: página pela metade, carregando para sempre.

### Por que ninguém foi avisado

O healthcheck do Docker olhava só `r.ok` em `/api/resultados` — **cabeçalho** — e
nunca lia o corpo. Passava em ~130 ms. O Docker reportou `healthy` durante as 26
horas inteiras de apagão. O cabeçalho sai antes da falha; o corpo é que morre.

### O que foi descartado

- **Não é o código.** Um container novo da imagem **idêntica**, mesmo `.env` e
  mesmas redes, serviu tudo completo em menos de 0,3 s: `/` em 161345 bytes
  contra os 126867 truncados, o 404 em 8049 contra 5445, a API em 61373 contra
  16384.
- **Não é vazamento de recurso.** 22 descritores abertos contra um teto de
  524288, uma única conexão estabelecida, 350 MB de 768 MB, 0,8 % de CPU.
- **Não é bug genérico do Bun.** Num teste isolado na mesma imagem, o
  `node:http` do Bun encerrou corretamente resposta simples, resposta `chunked`
  e pipe de `ReadableStream` para a resposta.
- **Não é o coalescedor do v2.1.0**, nem `after()`, nem instrumentação, nem
  patch em protótipo: nada disso existe no caminho.

### A causa, até onde foi

O servidor roda inteiramente sob **Bun 1.3.11**, não Node: o comando é `bun
--bun next start`, e o processo filho se anuncia como `node …` mas seu
executável real é `/usr/local/bin/bun`, via o shim `/tmp/bun-node-*/node → bun`
que aparece no `docker diff`. Não há Node de verdade na imagem.

A assinatura — um buffer escrito, o `drain` que nunca chega, e travamento em
fronteira exata — aponta para uma **trava de I/O no runtime depois de uptime
longo**. Onde exatamente, não foi isolado.

> **Isto continua aberto e vai repetir.** O que foi feito abaixo torna o
> problema visível; não o corrige. Os caminhos a avaliar são rodar o servidor
> sob Node real ou subir a versão do Bun.

### O que foi feito

`docker restart` devolveu o site na hora: 161345 bytes, `</html>` no lugar,
0,25 s.

**`2adddd2` — o healthcheck passa a ler o corpo.** Agora ele parseia o JSON em
vez de conferir o cabeçalho. Cobre os dois modos de morte: corpo truncado não
passa pelo `JSON.parse`, e corpo pendurado estoura o `--timeout`, que o Docker
conta como falha.

**`4295d19` — a conferência do deploy exige resposta que termina.** Ao ler o
`deploy.ts` para corrigir o relatório, apareceram três defeitos além do
previsto:

1. A conferência aceitava `%{http_code}` como prova de saúde — teria passado
   limpa durante todo o apagão. Agora exige `</html>` e diz quantos bytes
   truncados encontrou.
2. O `curl` interno não tinha `--max-time`. Contra a resposta pendurada daquele
   dia, o deploy penduraria junto, para sempre, sem dizer por quê.
3. O resumo final afirmava, **incondicionalmente**, que `bolao.maxmat1.com.br`
   continuava intocado na porta 5001. Desde a virada de 10/08/2026 isso era
   mentira impressa no relatório de sucesso — e produção é justamente o
   container que o deploy recria. Agora `viradaFeita()` lê o vhost, e o texto
   segue o fato, avisando do piscar de indisponibilidade.
4. A conferência testava só o domínio de convivência. O domínio de produção
   ficava de fora, então a subida era dada por boa enquanto produção estava
   fora do ar. Agora entra, e a falha lá é dura de propósito.

Mentira no relatório final é pior que silêncio: quem deploya confia nela e não
confere.

### O erro de operação, no meio do conserto

Rodei `bun run deploy --seco` acreditando que era simulação. A flag é
**`--dry-run`** — a variável interna se chama `seco`, e **o script ignora flag
desconhecida em silêncio**. Foi um deploy real: construiu e publicou
`bolao-do-max:2adddd2-sujo` em produção a partir de árvore de trabalho **não
commitada**, recarregou o nginx e apagou uma imagem antiga.

Nada irreversível, e o site seguiu `healthy` — mas por alguns minutos produção
rodou uma imagem que não existia em commit nenhum, que é exatamente o problema
de reprodutibilidade apontado poucos minutos antes. O deploy limpo seguinte
substituiu a imagem e a limpeza removeu a `-sujo`.

Lição, para quem vier: conferir a flag e conferir que `git status --porcelain`
está vazio antes de deployar — árvore suja gera tag `<sha>-sujo`. E vale fazer o
script **abortar em flag desconhecida** em vez de ignorá-la.

### Onde ficou

Produção em `bolao-do-max:4295d19`, container `healthy`,
`https://bolao.maxmat1.com.br/` em 161345 bytes e 0,25 s com o HTML fechando.

Aberto:

- a trava de I/O do Bun, **não diagnosticada**;
- **detectar não é curar** — o Docker não reinicia container marcado
  `unhealthy` (`restart: unless-stopped` reage a processo que morre, não a
  health), então falta um autoheal para o apagão se resolver sozinho;
- o `deploy.ts` aceitando flag desconhecida em silêncio;
- ponta solta: um único erro no boot, `⨯ Error: x`, com digest que decodifica
  para `ok:patched`. A string não existe no build nem em `next/dist`, e não é a
  causa do travamento — que acontece em toda requisição.
