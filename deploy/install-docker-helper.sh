#!/bin/bash
# Установка root-помощника обновления Docker-контейнеров и его sudoers (раздел «Обновления» панели).
# Запуск: sudo /opt/server-panel/deploy/install-docker-helper.sh
# Порядок: проверки → проверка нового sudoers (visudo -cf) ДО установки → резервные копии → установка → итоговая проверка.
# Ничего не обновляет и не перезапускает: контейнеры не трогаются, белый список остаётся пустым (если его не было).
# Откат: команды выводятся в конце.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
HELPER_SRC="$DIR/server-panel-docker"; SUDOERS_SRC="$DIR/sudoers-server-panel-docker"
HELPER=/usr/local/sbin/server-panel-docker; SUDOERS=/etc/sudoers.d/server-panel-docker
CONF=/etc/server-panel; PROJECTS=$CONF/docker-projects.json; STATE=/var/lib/server-panel-docker
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -f "$HELPER_SRC" && -f "$SUDOERS_SRC" ]] || { echo "Нет исходников в $DIR" >&2; exit 1; }

echo "== 1. Проверки до установки"
python3 -I -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" "$HELPER_SRC" && echo "   синтаксис помощника: ok"
visudo -cf "$SUDOERS_SRC"
grep -q "SP_DOCKER" "$SUDOERS_SRC" || { echo "В sudoers нет SP_DOCKER" >&2; exit 1; }
getent group panel >/dev/null || { echo "Нет группы panel" >&2; exit 1; }
docker compose version >/dev/null || { echo "Нет docker compose" >&2; exit 1; }
command -v systemd-run >/dev/null || { echo "Нет systemd-run" >&2; exit 1; }

echo "== 2. Резервные копии"
mkdir -p "$BK"; chmod 700 "$BK"
[[ -f "$HELPER" ]] && cp -p "$HELPER" "$BK/server-panel-docker-before-$TS" && echo "   $BK/server-panel-docker-before-$TS"
[[ -f "$SUDOERS" ]] && cp -p "$SUDOERS" "$BK/sudoers-server-panel-docker-before-$TS" && echo "   $BK/sudoers-server-panel-docker-before-$TS"

echo "== 3. Каталоги и белый список"
install -d -o root -g root -m 755 "$CONF" "$CONF/docker"
install -d -o root -g panel -m 750 "$STATE" "$STATE/jobs" "$STATE/state"
install -d -o root -g root -m 700 "$STATE/inspect" "$STATE/backups"
if [[ ! -f "$PROJECTS" ]]; then
  printf '{\n "version": 1,\n "projects": {}\n}\n' > "$PROJECTS"; chown root:root "$PROJECTS"; chmod 644 "$PROJECTS"
  echo "   создан пустой белый список $PROJECTS (контейнеры добавляются по одному: deploy/docker/install-project.sh)"
else
  echo "   белый список уже есть, не трогаю"
fi

echo "== 4. Установка"
install -o root -g root -m 755 "$HELPER_SRC" "$HELPER"
install -o root -g root -m 440 "$SUDOERS_SRC" "$SUDOERS"
if ! visudo -c >/dev/null; then
  echo "Итоговая проверка sudoers не прошла — убираю новый файл" >&2
  if [[ -f "$BK/sudoers-server-panel-docker-before-$TS" ]]; then install -o root -g root -m 440 "$BK/sudoers-server-panel-docker-before-$TS" "$SUDOERS"; else rm -f "$SUDOERS"; fi
  exit 1
fi
cmp -s "$HELPER_SRC" "$HELPER" && cmp -s "$SUDOERS_SRC" "$SUDOERS" && echo "   установленные файлы совпадают с deploy/"

echo "== 5. Проверка от имени panel"
if sudo -u panel sudo -n -l 2>/dev/null | grep -q "server-panel-docker update"; then echo "   sudo для panel: ok"; else echo "   ВНИМАНИЕ: panel не видит разрешение на server-panel-docker" >&2; fi
if sudo -u panel sudo -n "$HELPER" update no-such-container 2>&1 | grep -q "белый список\|не входит"; then echo "   чужое имя контейнера отклоняется: ok"; fi
sudo -u panel test -r "$STATE/jobs" && echo "   panel читает $STATE/jobs: ok"

echo
echo "Готово. Перезапускать ничего не нужно, контейнеры не тронуты."
echo "Чтобы панель увидела новые маршруты и кнопки: sudo systemctl restart server-panel"
echo "Откат: sudo rm -f $SUDOERS $HELPER   (и, при желании, восстановить файлы из $BK/*-before-$TS)"
