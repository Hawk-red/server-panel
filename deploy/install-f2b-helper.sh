#!/bin/bash
# Установка root-утилиты блокировок fail2ban и обновление sudoers (раздел «Безопасность» панели).
# Запуск: sudo /opt/server-panel/deploy/install-f2b-helper.sh
# Порядок: резервные копии → проверка нового sudoers (visudo -c) ДО установки → утилита → sudoers → проверка итога.
# Откат: восстановить файлы из /root/backup-configs/*-before-f2b-* (команды выводятся в конце).
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_SRC="$DIR/server-panel-f2b"; SUDOERS_SRC="$DIR/sudoers-server-panel"
HELPER=/usr/local/sbin/server-panel-f2b; SUDOERS=/etc/sudoers.d/server-panel
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -f "$HELPER_SRC" && -f "$SUDOERS_SRC" ]] || { echo "Нет исходников в $DIR" >&2; exit 1; }
bash -n "$HELPER_SRC"
echo "== 1. Проверка нового sudoers до применения"
visudo -cf "$SUDOERS_SRC"
grep -q "SP_F2B" "$SUDOERS_SRC" || { echo "В sudoers нет SP_F2B" >&2; exit 1; }

echo "== 2. Резервные копии"
mkdir -p "$BK"; chmod 700 "$BK"
[[ -f "$SUDOERS" ]] && cp -p "$SUDOERS" "$BK/sudoers-server-panel-before-f2b-$TS" && echo "   $BK/sudoers-server-panel-before-f2b-$TS"
[[ -f "$HELPER" ]] && cp -p "$HELPER" "$BK/server-panel-f2b-before-f2b-$TS" && echo "   $BK/server-panel-f2b-before-f2b-$TS"

echo "== 3. Установка"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER"
install -o root -g root -m 440 "$SUDOERS_SRC" "$SUDOERS"
if ! visudo -c >/dev/null; then
  echo "Итоговая проверка sudoers не прошла — возвращаю прежний файл" >&2
  [[ -f "$BK/sudoers-server-panel-before-f2b-$TS" ]] && install -o root -g root -m 440 "$BK/sudoers-server-panel-before-f2b-$TS" "$SUDOERS"
  exit 1
fi
cmp -s "$HELPER_SRC" "$HELPER" && cmp -s "$SUDOERS_SRC" "$SUDOERS" && echo "   установленные файлы совпадают с deploy/"

echo "== 4. Проверка от имени panel"
if fail2ban-client status panel-auth >/dev/null 2>&1; then
  sudo -u panel sudo -n "$HELPER" status | head -3 && echo "   status: ok (пустой вывод — банов нет)"
else
  echo "   jail panel-auth ещё не включён (install-fail2ban.sh): status заработает после него"
fi
echo "Готово. Панель перезапускать не нужно (sudoers и утилита читаются при каждом вызове)."
echo "Откат: sudo install -m 440 $BK/sudoers-server-panel-before-f2b-$TS $SUDOERS && sudo rm -f $HELPER"
