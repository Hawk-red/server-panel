#!/bin/bash
# Пересборка панели после правок кода. Запускать от hawk: /opt/server-panel/deploy/update.sh
# Фронт подхватывается сразу (статика читается с диска), бэкенду нужен перезапуск службы.
set -euo pipefail
cd /opt/server-panel
echo "== backend: сборка"
(cd backend && npm run build)
echo "== frontend: сборка"
(cd frontend && npm run build >/dev/null && echo "ok, $(du -sh dist | cut -f1)")
echo
echo "Готово. Чтобы применить изменения бэкенда:"
echo "  sudo systemctl restart server-panel && systemctl status server-panel --no-pager | head -3"
