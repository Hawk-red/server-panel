#!/usr/bin/env python3
"""Собирает русский перевод веб-клиента SFTPGo: английский файл из ТЕКУЩЕГО образа + наши переводы из locale-ru.json.

Готовый файл монтируется в контейнер поверх locales/en/translation.json (английский — язык по умолчанию).
Новые и непереведённые строки после обновления образа остаются английскими (а не превращаются в имена ключей),
поэтому обновление контейнера ничего не ломает. Запускается из install.sh и update.sh; вручную:
  build-locale.py [--image drakkan/sftpgo:latest] [--out /opt/sftpgo/locales/en/translation.json]
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--image", default="drakkan/sftpgo:latest")
ap.add_argument("--out", default="/opt/sftpgo/locales/en/translation.json")
ap.add_argument("--base", help="взять английский файл из этого пути, а не из образа (для проверок)")
a = ap.parse_args()

if a.base:
    base_text = open(a.base, encoding="utf-8").read()
else:
    r = subprocess.run(["docker", "run", "--rm", "--entrypoint", "cat", a.image, "/usr/share/sftpgo/static/locales/en/translation.json"], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit("Не удалось прочитать английский перевод из образа: " + r.stderr.strip()[:200])
    base_text = r.stdout
base = json.loads(base_text)
ru = {k: v for k, v in json.load(open(os.path.join(HERE, "locale-ru.json"), encoding="utf-8")).items() if not k.startswith("_")}

applied, stale = 0, []
for key, text in ru.items():
    node = base
    parts = key.split(".")
    for p in parts[:-1]:
        node = node.get(p) if isinstance(node, dict) else None
        if node is None:
            break
    if isinstance(node, dict) and isinstance(node.get(parts[-1]), str):
        node[parts[-1]] = text
        applied += 1
    else:
        stale.append(key)

os.makedirs(os.path.dirname(a.out), exist_ok=True)
# Пишем в тот же файл (а не заменяем его): контейнер смонтировал файл по inode
with open(a.out, "w", encoding="utf-8") as f:
    json.dump(base, f, ensure_ascii=False, indent=2)
os.chmod(a.out, 0o644)
print(f"Перевод собран: {applied} строк переведено, {len(stale)} ключей нет в этой версии SFTPGo" + (f" ({', '.join(stale[:5])}…)" if stale else "") + f" → {a.out}")
