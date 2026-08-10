# z_legado — o sistema anterior, arquivado

Tudo que serviu o Bolão do Max até **10/08/2026** e não faz parte do sistema
novo. Nada aqui é executado; nada aqui foi apagado.

A estrutura é a original — os caminhos internos e os links das especificações
continuam válidos, só passaram a viver debaixo desta pasta.

> Voltar a produção para este sistema **não depende desta pasta**. O servidor tem
> a própria cópia em `/opt/bolao-maxmat1`, intacta, e o procedimento está no §9 de
> [`docs/_atual/deploy.e.backup.md`](../docs/_atual/deploy.e.backup.md). Aqui é
> arquivo histórico.

## O que tem

| Caminho | O que é | Por que ficou |
|---|---|---|
| `bolao-max-server/` | A aplicação inteira: Node 14, Express 4, Pug, o scraping do ge.globo, `regras.bolao.js` e os JSONs de aposta de 2018 a 2026 | Rodou nove temporadas. É a referência de comportamento que os testes de ouro reproduzem, e a origem dos seeds de aposta |
| `bolao-max-server/json/bolao*.json` | As apostas ano a ano, como eram mantidas: JSON editado à mão | `bun run seeds:apostas` lê daqui para gerar `seeds/apostas/` |
| `redis-final/` | As quatro chaves do Redis antigo, capturadas minutos antes do desligamento | Naquele sistema o Redis **era** o banco: é a última fotografia do estado dele |
| `Dockerfile` · `docker-compose.yaml` · `.dockerignore` | A imagem Node 14 e o stack de dois containers (app + Redis 7.2) | Como aquilo subia |
| `rebuild-docker.sh` | Script de rebuild que faz `git reset --hard` e `docker system prune -f` | **Destrutivo.** Guardado como registro, não para usar |
| `apache/` | Vhosts e certificados da época em que o site era servido por Apache, antes do nginx | Registro. Ver a nota de segurança abaixo |
| `azure/` | Templates ARM exportados de uma tentativa de hospedar no Azure | Registro |
| `doc/` | Imagens, o mascote e capturas antigas de resultado (`resultado.json`, `bolao2018.json`) | Material do bolão e dado histórico |
| `maraca` | Arquivo vazio, e uma chave `maraca` existia no Redis antigo sem uso no cálculo | Mistério preservado |
| `.vs/` | Estado de workspace do Visual Studio | Sobra de ferramenta |

## Uma nota de segurança

`apache/bolao.maxmat1.com.br/` guardava também o **`privkey.pem`** — a chave
privada do certificado. Ela foi **removida da árvore** ao arquivar.

O certificado correspondente expirou em **3 de março de 2022** e a chave pública
dele não é a que o site serve hoje (conferido em 10/08/2026 contra o certificado
ao vivo), então o risco prático é nenhum: chave de certificado expirado não
impersona ninguém. Os `cert.pem`, `chain.pem` e `fullchain.pem` continuam aqui —
certificado é dado público por natureza.

A chave permanece no **histórico do git**, e tirá-la de lá exigiria reescrever o
histórico e forçar push nos dois remotos. Fica registrado como pendência de
decisão, não como emergência.

É também o exemplo concreto do que o `CLAUDE.md` avisa: existem credenciais
versionadas neste repositório, e o padrão não deve ser repetido. No sistema novo
nenhum segredo entra no git — as senhas de banco e cache são geradas pelo próprio
servidor e as chaves de API ficam no `.env`, que é ignorado.
