#!/bin/bash
# Шаг 1: токен API adm.tools + установка хука DNS-01. Ничего в certbot не меняет — только готовит хук и проверяет токен.
# Запуск: sudo /opt/server-panel/deploy/certbot/dns01-setup.sh
# Токен возьмите на https://adm.tools/user/api/ (доступ к DNS того аккаунта, где висит pulsdev.net).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
SRC=/opt/server-panel/deploy/certbot
HOOK=/usr/local/sbin/admtools-dns-hook.py
TOKEN_FILE=/etc/letsencrypt/admtools-api-token
BK=/root/backup-configs
mkdir -p "$BK"; chmod 700 "$BK"

install -o root -g root -m 750 "$SRC/admtools-dns-hook.py" "$HOOK"
echo "хук установлен: $HOOK"

echo
echo "Токен API adm.tools (https://adm.tools/user/api/) — ввод скрыт, никуда, кроме файла, не попадёт."
read -rsp "Токен: " TOKEN; echo
[[ -n "$TOKEN" ]] || { echo "Пустой токен — ничего не записано." >&2; exit 1; }

[[ -f "$TOKEN_FILE" ]] && cp -p "$TOKEN_FILE" "$BK/admtools-api-token.bak-$(date +%Y%m%d-%H%M%S)"
umask 077
printf '%s' "$TOKEN" > "$TOKEN_FILE"
chown root:root "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
unset TOKEN

echo
echo "== проверка токена (только чтение — список доменов):"
"$HOOK" selftest
