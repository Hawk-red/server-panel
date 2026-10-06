#!/bin/bash
# Проверка: обменник на hdd1tb. Запуск: /opt/server-panel/deploy/exchange/verify-hdd1tb.sh (sudo не нужен)
ok=0; bad=0; chk() { if eval "$2"; then echo "  ✓ $1"; ok=$((ok+1)); else echo "  ✗ $1"; bad=$((bad+1)); fi; }
DISK=/mnt/hdd1tb
chk "hdd1tb смонтирован и это не системный диск" "mountpoint -q $DISK && [ \"\$(mountpoint -d $DISK)\" != \"\$(mountpoint -d /)\" ]"
chk "/srv/exchange — ссылка на $DISK/sftpgo-data" "[ \"\$(readlink /srv/exchange)\" = $DISK/sftpgo-data ]"
chk "каталог данных на диске hdd1tb (не на SSD)" "[ \"\$(stat -c %d \$(readlink -f /srv/exchange))\" = \"\$(stat -c %d $DISK)\" ]"
chk "контейнер sftpgo запущен" "[ \"\$(docker inspect -f '{{.State.Status}}' sftpgo 2>/dev/null)\" = running ]"
pid=$(docker inspect -f '{{.State.Pid}}' sftpgo 2>/dev/null); cdev=$(awk '$5=="/data/exchange" {d=$3} END {print d}' /proc/$pid/mountinfo 2>/dev/null)
chk "контейнер видит /data/exchange на диске hdd1tb (устройство $cdev)" "[ -n \"$cdev\" ] && [ \"$cdev\" = \"\$(mountpoint -d $DISK)\" ]"
chk "ACL: macmini, hawk (rwx) и panel (r-x) на каталоге и как default" "getfacl -p /srv/exchange/ 2>/dev/null | grep -q 'user:macmini:rwx' && getfacl -p /srv/exchange/ | grep -q 'default:user:macmini:rwx' && getfacl -p /srv/exchange/ | grep -q 'user:panel:r-x'"
chk "в cron hawk есть сторож" "crontab -u hawk -l 2>/dev/null | grep -q sftpgo-guard.sh"
chk "ссылка SFTPGo в шаре MacMini ведёт в /srv/exchange" "[ \"\$(readlink /srv/share/SFTPGo 2>/dev/null)\" = /srv/exchange ]"
chk "HTTP веб-клиента отвечает (127.0.0.1:8080/files/)" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/files/ | grep -qE '^(200|301|302)$'"
echo; df -h /srv/exchange | tail -1 | sed 's/^/  диск обменника: /'
echo "  итог: $ok проверок прошло, $bad не прошло"; [ $bad -eq 0 ]
