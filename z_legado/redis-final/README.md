# Estado final do sistema antigo

O que estava no Redis do bolão antigo no momento em que ele foi desligado, em
**10/08/2026 14:29**, capturado antes de derrubar o container.

O Redis *era* o banco de dados daquele sistema: o resultado só existia ali, sem
cópia em disco além do `dump.rdb`. Estes arquivos são a última fotografia dele.

| Arquivo | O que é | Tamanho |
|---|---|---|
| `bolao_mem.txt` | O payload inteiro que a tela e o `/resultados` liam. 30 competidores, temporada 2026, atualizado 10/ago/2026 14:23 | 112 KB |
| `bolao_data_atu.txt` | Data da última atualização bem-sucedida | 21 B |
| `data_last_get.txt` | Data do último acesso registrado — era o que decidia a cadência de 3 ou 1 minuto | 26 B |
| `maraca.txt` | Chave herdada, sem uso no cálculo | 22 B |

Não é backup operacional: o sistema novo não lê nada daqui. É registro
histórico, e serve para conferir o cálculo novo contra o que a produção antiga
mostrava no último instante — a mesma checagem que os testes de ouro fazem
contra uma captura anterior.

O resto do sistema antigo continua no servidor, intocado:

```
/opt/bolao-maxmat1/                      código e dado, nada apagado
/opt/bolao-maxmat1/cache-redis/dump.rdb  o Redis em disco, com SAVE final
node/bolao.maxmat1.com.br:latest         imagem, 1,66 GB
redis:7.2-alpine3.18                     imagem do cache dele
```

Voltar atrás está descrito em [`docs/_atual/deploy.e.backup.md`](../../docs/_atual/deploy.e.backup.md), §9.
