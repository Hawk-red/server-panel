#!/bin/bash
# dfree command для Samba: на вход путь (cwd запроса), на выход «total_kb free_kb» (блоки по 1 КБ).
# Корень шары MacMini (/srv/share) лежит на корневом SSD, а Finder должен видеть место на hdd1tb;
# для остальных путей берём df файловой системы реального пути (readlink -f).
# df под timeout 3 с: при зависшем диске не блокируем smbd, а отдаём df самого пути.
p="${1:-.}"
real=$(timeout 3 readlink -f -- "$p" 2>/dev/null) || real="$p"
[[ -n "$real" ]] || real="$p"
[[ "$real" == /srv/share ]] && real=/mnt/hdd1tb
out=$(timeout 3 df -Pk -- "$real" 2>/dev/null | awk 'NR==2 {print $2, $4}')
[[ "$out" =~ ^[0-9]+\ [0-9]+$ ]] || out=$(timeout 3 df -Pk -- "$p" 2>/dev/null | awk 'NR==2 {print $2, $4}')
[[ "$out" =~ ^[0-9]+\ [0-9]+$ ]] || out="0 0"
echo "$out"
