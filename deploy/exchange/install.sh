#!/bin/bash
# Установка обменника файлов (SFTPGo за nginx). Запуск: sudo /opt/server-panel/deploy/exchange/install.sh
# Что делает (по шагам, с бэкапами в /root/backup-configs и откатом nginx при ошибке):
#   1. каталоги /srv/exchange (файлы) и /opt/sftpgo (compose и база), права для панели (чтение);
#   2. nginx: conf.d/exchange.conf, snippets/exchange-public.conf, vhost админки (:8443, только LAN/VPN),
#      include в vhost api.pulsdev.net; nginx -t, при ошибке — откат;
#   3. ufw: порт 8443 только из LAN и VPN; 4. fail2ban: jail exchange; 5. запуск контейнера.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
SRC=/opt/server-panel/deploy/exchange
BK=/root/backup-configs
TS=$(date +%Y%m%d-%H%M%S)
VHOST=/etc/nginx/sites-available/api.pulsdev.net
mkdir -p "$BK"; chmod 700 "$BK"

echo "== 1. каталоги"
install -d -o hawk -g hawk -m 750 /srv/exchange /srv/exchange/uploads
install -d -o 1001 -g 1001 -m 750 /opt/sftpgo /opt/sftpgo/data
# панель читает содержимое (размеры, «последние загрузки»); новые файлы наследуют доступ
setfacl -R -m u:panel:rX /srv/exchange
setfacl -R -d -m u:panel:rX /srv/exchange
install -o root -g hawk -m 640 "$SRC/compose.yaml" /opt/sftpgo/compose.yaml

echo "== 2. nginx"
cp -p "$VHOST" "$BK/api.pulsdev.net.bak-$TS"
NEWVHOST=$(mktemp)
awk -f "$SRC/patch-vhost.awk" "$VHOST" > "$NEWVHOST" || { echo "В vhost не найден блок «location /» в server 443 — не трогаю"; rm -f "$NEWVHOST"; exit 1; }
install -d /etc/nginx/snippets
install -o root -g root -m 644 "$SRC/nginx-http.conf"   /etc/nginx/conf.d/exchange.conf
install -o root -g root -m 644 "$SRC/nginx-public.conf" /etc/nginx/snippets/exchange-public.conf
install -o root -g root -m 644 "$SRC/nginx-admin.conf"  /etc/nginx/sites-available/exchange-admin
ln -sfn /etc/nginx/sites-available/exchange-admin /etc/nginx/sites-enabled/exchange-admin
install -o root -g root -m 644 "$NEWVHOST" "$VHOST"; rm -f "$NEWVHOST"
for f in exchange.access.log exchange-admin.access.log; do
  touch "/var/log/nginx/$f"; chown www-data:adm "/var/log/nginx/$f"; chmod 640 "/var/log/nginx/$f"
done
if nginx -t; then
  systemctl reload nginx
  echo "nginx перечитан"
else
  echo "!! nginx -t не прошёл — откатываю" >&2
  cp -p "$BK/api.pulsdev.net.bak-$TS" "$VHOST"
  rm -f /etc/nginx/conf.d/exchange.conf /etc/nginx/snippets/exchange-public.conf /etc/nginx/sites-enabled/exchange-admin /etc/nginx/sites-available/exchange-admin
  nginx -t
  exit 1
fi

echo "== 3. ufw (админка :8443 — только LAN и VPN)"
ufw allow from 192.168.31.0/24 to any port 8443 proto tcp comment 'exchange admin (LAN)'
ufw allow from 10.10.10.0/24   to any port 8443 proto tcp comment 'exchange admin (VPN)'

echo "== 4. fail2ban"
install -o root -g root -m 644 "$SRC/fail2ban-filter.conf" /etc/fail2ban/filter.d/exchange.conf
install -o root -g root -m 644 "$SRC/fail2ban-jail.local"  /etc/fail2ban/jail.d/exchange.local
fail2ban-client -t >/dev/null && fail2ban-client reload && fail2ban-client status exchange | head -4

echo "== 5. контейнер"
docker compose -f /opt/sftpgo/compose.yaml pull
docker compose -f /opt/sftpgo/compose.yaml up -d
for i in $(seq 1 30); do curl -s -o /dev/null -m2 http://127.0.0.1:8080/healthz && break; sleep 1; done
curl -s -m3 -o /dev/null -w "публичный вход (127.0.0.1:8080/healthz): %{http_code}\n" http://127.0.0.1:8080/healthz || true
echo
echo "Готово. Дальше:"
echo "  1) ~/Scripts/adguard-rewrite.py         — запись api.pulsdev.net → 192.168.31.112 для дома"
echo "  2) https://api.pulsdev.net:8443/files/web/admin/setup (или https://192.168.31.112:8443/files/web/admin/setup)"
echo "     — создать администратора SFTPGo (это НЕ файловый пользователь; логин лучше не admin)"
echo "  3) ~/Scripts/exchange-users.py           — файловые пользователи admin и uploads (пароли скрыты)"
