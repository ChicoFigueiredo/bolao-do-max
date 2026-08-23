#!/bin/bash
# Reinicia o container do bolão quando o healthcheck reprova de forma sustentada.
#
# Por que existe: em 11/08/2026 a web ficou 26 h entregando meia resposta, e em
# 23/08/2026 ela estava com FailingStreak=6095 e RestartCount=0 — o healthcheck
# detectava havia dois dias e meio e ninguém agia. Sinal sem atuador é enfeite.
#
# Por que não é o container `willfarrell/autoheal`: ele exige montar
# /var/run/docker.sock, e quem alcança esse socket é root no host. Depois do RCE
# de 13/08/2026 não faz sentido pagar esse preço por um watchdog.
#
# A causa raiz é um vazamento de memória (≈220 MB no start, ~800 MB e o teto de
# 768 MiB em 2,5 dias). Isto aqui é paliativo consciente: troca um apagão longo
# por um reinício de segundos, enquanto o vazamento não é corrigido.
set -uo pipefail

ALVO=${1:-bolao-do-max-web}
MINIMO_FALHAS=${2:-3}

estado=$(docker inspect -f '{{.State.Health.Status}}' "$ALVO" 2>/dev/null) || exit 0
[ "$estado" = "unhealthy" ] || exit 0

falhas=$(docker inspect -f '{{.State.Health.FailingStreak}}' "$ALVO" 2>/dev/null || echo 0)
[ "$falhas" -ge "$MINIMO_FALHAS" ] || exit 0

logger -t bolao-autoheal "»$ALVO« unhealthy com FailingStreak=$falhas — reiniciando"
if docker restart "$ALVO" >/dev/null 2>&1; then
  logger -t bolao-autoheal "»$ALVO« reiniciado"
else
  logger -t bolao-autoheal "ERRO ao reiniciar »$ALVO«"
fi
