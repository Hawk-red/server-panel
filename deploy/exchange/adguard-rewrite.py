#!/usr/bin/env python3
"""Запись DNS-rewrite в AdGuard Home: api.pulsdev.net → 192.168.31.112, чтобы из дома открывался
https://api.pulsdev.net/files/ с нормальным сертификатом (роутер не отдаёт свой внешний адрес обратно в сеть).
Запуск: ~/Scripts/adguard-rewrite.py [--remove]. Логин и пароль AdGuard вводятся здесь (пароль скрыт)."""
import base64, getpass, json, os, sys, urllib.error, urllib.request

URL = os.environ.get("ADGUARD_URL", "http://127.0.0.1:3000")
DOMAIN, ANSWER = "api.pulsdev.net", "192.168.31.112"


def call(auth, method, path, body=None):
    headers = {"Authorization": "Basic " + base64.b64encode(auth.encode()).decode(), "Content-Type": "application/json"}
    r = urllib.request.Request(URL + "/control" + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"AdGuard ответил {e.code}: " + ("неверный логин или пароль." if e.code == 401 else e.read().decode(errors="replace")[:150]))
    except urllib.error.URLError as e:
        sys.exit(f"AdGuard недоступен ({e.reason}).")


try:
    user = input("Логин AdGuard Home: ").strip()
    auth = f"{user}:{getpass.getpass('Пароль: ')}"
except (KeyboardInterrupt, EOFError):
    sys.exit("\nПрервано.")
rules = call(auth, "GET", "/rewrite/list") or []
have = [r for r in rules if r.get("domain") == DOMAIN]
if "--remove" in sys.argv:
    for r in have:
        call(auth, "POST", "/rewrite/delete", r)
    sys.exit(f"Удалено записей: {len(have)}")
if any(r.get("answer") == ANSWER for r in have):
    sys.exit(f"Запись {DOMAIN} → {ANSWER} уже есть.")
if have:
    print(f"Внимание: для {DOMAIN} уже есть другая запись: {[r.get('answer') for r in have]} — оставляю её и добавляю новую.")
call(auth, "POST", "/rewrite/add", {"domain": DOMAIN, "answer": ANSWER})
print(f"Готово: {DOMAIN} → {ANSWER} (для устройств, которые используют AdGuard как DNS).")
