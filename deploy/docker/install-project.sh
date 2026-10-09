#!/bin/bash
# Подключение ОДНОГО контейнера к обновлению из панели: корневая копия compose + запись в белый список помощника.
# Запуск: sudo /opt/server-panel/deploy/docker/install-project.sh <имя>            (например: portainer)
#         sudo ... install-project.sh <имя> --from /путь/к/compose.yaml            (compose из другого места, напр. у macmini)
#         sudo ... install-project.sh --remove <имя>                               (отключить от панели)
# Источники: deploy/docker/<имя>/compose.yaml и project.json (параметры: сервис, проверки здоровья, предупреждение, копии данных).
# Ничего не скачивает, не пересоздаёт и не перезапускает: в конце — только `server-panel-docker update <имя> --dry-run`.
# Порядок: проверки → резервные копии → установка (root:root, без записи для остальных) → запись в белый список → dry-run.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0 ..." >&2; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"
CONF=/etc/server-panel; PROJECTS=$CONF/docker-projects.json; HELPER=/usr/local/sbin/server-panel-docker
BK=/root/backup-configs; TS=$(date +%Y%m%d-%H%M%S)
[[ -x "$HELPER" && -f "$PROJECTS" ]] || { echo "Сначала установите помощника: sudo /opt/server-panel/deploy/install-docker-helper.sh" >&2; exit 1; }
mkdir -p "$BK"; chmod 700 "$BK"

if [[ "${1:-}" == "--remove" ]]; then
  NAME="${2:?имя контейнера}"
  [[ "$NAME" =~ ^[a-z0-9][a-z0-9_.-]{0,40}$ ]] || { echo "Недопустимое имя" >&2; exit 1; }
  cp -p "$PROJECTS" "$BK/docker-projects.json-before-remove-$NAME-$TS"
  python3 -I - "$PROJECTS" "$NAME" <<'PY'
import json, os, sys
p, name = sys.argv[1:3]
d = json.load(open(p)); d["projects"].pop(name, None)
open(p + ".tmp", "w").write(json.dumps(d, ensure_ascii=False, indent=1) + "\n"); os.chmod(p + ".tmp", 0o644); os.replace(p + ".tmp", p)
PY
  rm -rf "$CONF/docker/$NAME"
  echo "«$NAME» отключён от обновления из панели (compose удалён из $CONF/docker, контейнер не тронут)."; exit 0
fi

NAME="${1:?имя контейнера}"; SRC="$DIR/$NAME/compose.yaml"
[[ "$NAME" =~ ^[a-z0-9][a-z0-9_.-]{0,40}$ ]] || { echo "Недопустимое имя" >&2; exit 1; }
if [[ "${2:-}" == "--from" ]]; then SRC="${3:?путь к compose}"; fi
META="$DIR/$NAME/project.json"
[[ -f "$SRC" && -f "$META" ]] || { echo "Нет $SRC или $META" >&2; exit 1; }

echo "== 1. Проверки до установки"
python3 -I - "$META" "$NAME" <<'PY'
import json, sys
m = json.load(open(sys.argv[1])); name = sys.argv[2]
for k in ("service", "container", "image", "health"):
    assert k in m, f"в project.json нет поля {k}"
assert m["container"] == name, "container не совпадает с именем"
print("   project.json: ok")
PY
docker compose -p "$NAME" -f "$SRC" config -q && echo "   docker compose config: ok"
docker inspect "$NAME" >/dev/null 2>&1 && echo "   контейнер «$NAME» существует" || { echo "Контейнер «$NAME» не найден" >&2; exit 1; }

echo "== 2. Резервные копии"
cp -p "$PROJECTS" "$BK/docker-projects.json-before-$NAME-$TS" && echo "   $BK/docker-projects.json-before-$NAME-$TS"
[[ -f "$CONF/docker/$NAME/compose.yaml" ]] && cp -p "$CONF/docker/$NAME/compose.yaml" "$BK/compose-$NAME-before-$TS" && echo "   $BK/compose-$NAME-before-$TS" || true

echo "== 3. Установка compose (root:root)"
install -d -o root -g root -m 755 "$CONF/docker" "$CONF/docker/$NAME"
install -o root -g root -m 644 "$SRC" "$CONF/docker/$NAME/compose.yaml"
SHA=$(sha256sum "$CONF/docker/$NAME/compose.yaml" | cut -d' ' -f1)
echo "   $CONF/docker/$NAME/compose.yaml  sha256=$SHA"

echo "== 4. Запись в белый список"
python3 -I - "$PROJECTS" "$META" "$NAME" "$SHA" <<'PY'
import json, os, sys
p, meta, name, sha = sys.argv[1:5]
d = json.load(open(p)); m = json.load(open(meta)); m["sha256"] = sha
d.setdefault("projects", {})[name] = m
open(p + ".tmp", "w").write(json.dumps(d, ensure_ascii=False, indent=1) + "\n")
os.chmod(p + ".tmp", 0o644); os.replace(p + ".tmp", p)
PY
chown root:root "$PROJECTS"; chmod 644 "$PROJECTS"
echo "   $NAME добавлен в $PROJECTS"

echo "== 5. Пробная проверка (dry-run): ничего не скачивается и не меняется"
"$HELPER" update "$NAME" --dry-run || { echo "dry-run не прошёл — смотрите вывод выше" >&2; exit 1; }
echo
echo "Готово. Откройте «Обновления» в панели (после перезапуска панели, если ещё не делали) и обновите страницу."
echo "Отключить обратно: sudo $0 --remove $NAME"
