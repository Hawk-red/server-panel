#!/bin/bash
# Корень единой шары MacMini: /srv/share (root:root, 755) с символическими ссылками на каталоги дисков, и права каталога обменника.
# Идемпотентно, можно запускать повторно (например, когда /srv/exchange станет точкой монтирования нового диска).
# Запуск: sudo /opt/server-panel/deploy/samba/share-tree.sh
#
# Почему ссылки, а не bind-монтирование: bind привязан к конкретной файловой системе. После перемонтирования диска
# (umount -l + mount, кнопка в панели, отвал USB) bind продолжает показывать старую (пустую) папку; ссылка разыменовывается по
# пути при каждом обращении и всегда ведёт на то, что смонтировано сейчас.
set -euo pipefail
SHARE_ROOT=${SHARE_ROOT:-/srv/share}
HDD=${T_HDD:-/mnt/hdd1tb}; FLAC=${T_FLAC:-/mnt/flac-usb/music}; TORR=${T_TORR:-/home/torrents-tmp}; EXCH=${T_EXCH:-/srv/exchange}
if [[ "${NOROOT:-}" != 1 ]]; then [[ $EUID -eq 0 ]] || { echo "Нужен root: sudo $0" >&2; exit 1; }; fi
own() { [[ "${NOROOT:-}" == 1 ]] || chown "$@"; }

echo "== Корень шары $SHARE_ROOT"
install -d -m 755 "$SHARE_ROOT"; own root:root "$SHARE_ROOT"
link() { # имя цель
  ln -sfn "$2" "$SHARE_ROOT/$1"; own -h root:root "$SHARE_ROOT/$1"
  printf '   %-16s → %s%s\n' "$1" "$2" "$([[ -e "$2" ]] && echo '' || echo '   (пока недоступно)')"
}
link 1TB "$HDD"
link FLAC "$FLAC"
link MacMiniTorrents "$TORR"
# Папка обменника в шаре называется SFTPGo (раньше — Exchange). Каталог данных остаётся /srv/exchange.
# Старая ссылка Exchange (только символическая, настоящую папку не трогаем): переименовывается в SFTPGo, а если SFTPGo уже есть — удаляется.
if [[ -L "$SHARE_ROOT/Exchange" ]]; then
  if [[ -e "$SHARE_ROOT/SFTPGo" || -L "$SHARE_ROOT/SFTPGo" ]]; then rm -f "$SHARE_ROOT/Exchange"; echo "   Exchange: старая ссылка удалена (SFTPGo уже есть)"
  else mv -T "$SHARE_ROOT/Exchange" "$SHARE_ROOT/SFTPGo"; echo "   Exchange → SFTPGo: ссылка переименована"; fi
elif [[ -e "$SHARE_ROOT/Exchange" ]]; then
  echo "   ВНИМАНИЕ: $SHARE_ROOT/Exchange — не ссылка, не трогаю" >&2
fi
if [[ -e "$SHARE_ROOT/SFTPGo" && ! -L "$SHARE_ROOT/SFTPGo" ]]; then
  echo "   ВНИМАНИЕ: $SHARE_ROOT/SFTPGo — не ссылка, не трогаю" >&2
else
  link SFTPGo "$EXCH"
fi

echo "== Каталог обменника ($EXCH): доступ для macmini (шара) и hawk (SFTPGo, uid 1001) рядом с существующим ACL панели"
# Не ломаем прежнее: владелец hawk, ACL u:panel:r-x остаётся. Добавляем macmini (чтение и запись) и hawk (чтобы SFTPGo мог работать с файлами,
# которые создал macmini: владелец у них macmini, а доступ hawk даёт именно этот ACL). Default-ACL наследуется новыми файлами и папками.
if [[ -d "$EXCH" ]]; then
  setfacl -R -m u:macmini:rwX,u:hawk:rwX,u:panel:rX "$EXCH"
  setfacl -R -d -m u:macmini:rwX,u:hawk:rwX,u:panel:rX "$EXCH"
  getfacl -p "$EXCH" | sed 's/^/   /'
else
  echo "   $EXCH не существует — пропускаю ACL" >&2
fi
echo "Готово."
