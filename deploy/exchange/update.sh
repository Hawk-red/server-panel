#!/bin/bash
# Обновление обменника: новый образ SFTPGo + пересборка русского перевода + перезапуск контейнера.
# Запуск: sudo /opt/server-panel/deploy/exchange/update.sh
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
SRC=/opt/server-panel/deploy/exchange
docker compose -f /opt/sftpgo/compose.yaml pull
python3 "$SRC/build-locale.py"
docker compose -f /opt/sftpgo/compose.yaml up -d --force-recreate
for i in $(seq 1 30); do curl -s -o /dev/null -m2 http://127.0.0.1:8080/healthz && break; sleep 1; done
docker exec sftpgo sftpgo --version 2>/dev/null | head -1 || true
echo "Готово. Перевод в браузерах гостей может кэшироваться до 7 дней (обновится вместе с версией SFTPGo)."
