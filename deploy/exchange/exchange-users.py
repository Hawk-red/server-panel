#!/usr/bin/env python3
"""Файловые пользователи обменника (SFTPGo): admin (всё, квота 25 ГБ на весь обменник) и uploads (гость: только
загрузка и создание папок, квота 20 ГБ, файл до 10 ГБ). Заодно создаёт правило «раз в час пересчитывать квоты»:
гостевые файлы лежат внутри домашней папки admin, и без пересчёта его счётчик о них не знает.

Запуск от hawk:  ~/Scripts/exchange-users.py
Пароли вводятся скрытно и не попадают ни в аргументы команд, ни в файлы. Скрипт можно запускать повторно:
существующий пользователь обновляется (Enter вместо пароля — пароль не меняется).
Дальше пользователей, папки и права удобнее менять в веб-админке: https://api.pulsdev.net:8443/files/web/admin/
"""
import base64
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("EXCHANGE_API", "http://127.0.0.1:8082")
GIB = 1024**3
MIN_LEN = 12
OWNER_QUOTA = 25 * GIB  # весь обменник на SSD, включая гостевые папки
GUEST_QUOTA = 20 * GIB
MAX_FILE = 10 * GIB


def call(method, path, token=None, body=None, basic=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if basic:
        headers["Authorization"] = "Basic " + base64.b64encode(f"{basic[0]}:{basic[1]}".encode()).decode()
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"error": raw.decode(errors="replace")[:200]}
    except urllib.error.URLError as e:
        sys.exit(f"Не удалось подключиться к {API}: {e.reason}. Контейнер запущен? (docker ps | grep sftpgo)")


def ask_password(name, exists):
    hint = " (Enter — оставить прежний)" if exists else ""
    while True:
        p1 = getpass.getpass(f"Пароль для «{name}»{hint}: ")
        if not p1 and exists:
            return None
        if len(p1) < MIN_LEN:
            print(f"  Слишком короткий: нужно не меньше {MIN_LEN} символов.")
            continue
        if getpass.getpass("  Повторите пароль: ") != p1:
            print("  Пароли не совпали.")
            continue
        return p1


# Всё, что гость не должен менять сам
WEB_LOCK = ["publickey-change-disabled", "tls-cert-change-disabled", "api-key-auth-change-disabled", "mfa-disabled", "password-change-disabled", "info-change-disabled", "password-reset-disabled"]

USERS = {
    "admin": {
        "description": "Владелец обменника: полный доступ ко всему хранилищу",
        "home_dir": "/data/exchange",
        "permissions": {"/": ["*"]},
        "quota_size": OWNER_QUOTA,
        "filters": {"denied_protocols": ["SSH", "FTP", "DAV"], "max_upload_file_size": MAX_FILE, "web_client": ["publickey-change-disabled", "tls-cert-change-disabled", "api-key-auth-change-disabled"]},
    },
    "uploads": {
        "description": "Гость: видит только папку uploads, может загружать и создавать папки; скачивать, удалять, переименовывать и делиться нельзя",
        "home_dir": "/data/exchange/uploads",
        "permissions": {"/": ["list", "upload", "create_dirs"]},
        "quota_size": GUEST_QUOTA,
        "filters": {"denied_protocols": ["SSH", "FTP", "DAV"], "max_upload_file_size": MAX_FILE, "web_client": WEB_LOCK + ["shares-disabled"]},
    },
}


def ensure_quota_rescan(token):
    """Раз в час пересчитывает занятое место у всех пользователей (событие по расписанию, действие «сброс квоты»)."""
    st, _ = call("GET", "/api/v2/eventactions/rescan-quota", token=token)
    if st == 404:
        st, res = call("POST", "/api/v2/eventactions", token=token, body={"name": "rescan-quota", "type": 5, "options": {}})
        if st not in (200, 201):
            sys.exit(f"Действие пересчёта квоты не создано: {st} {res}")
    st, _ = call("GET", "/api/v2/eventrules/quota-rescan-hourly", token=token)
    if st == 404:
        rule = {
            "name": "quota-rescan-hourly",
            "status": 1,
            "trigger": 3,
            "conditions": {"schedules": [{"hour": "*", "day_of_week": "*", "day_of_month": "*", "month": "*"}]},
            "actions": [{"name": "rescan-quota", "order": 1}],
        }
        st, res = call("POST", "/api/v2/eventrules", token=token, body=rule)
        if st not in (200, 201):
            sys.exit(f"Правило пересчёта квоты не создано: {st} {res}")
        print("  Правило «пересчёт квот раз в час» создано.")


def main():
    print(f"Администратор SFTPGo (тот, что создан в мастере на {API}).")
    login = input("Логин: ").strip()
    st, tok = call("GET", "/api/v2/token", basic=(login, getpass.getpass("Пароль: ")))
    if st != 200:
        sys.exit("Вход не удался: неверный логин или пароль администратора.")
    token = tok["access_token"]

    for name, spec in USERS.items():
        st, cur = call("GET", f"/api/v2/users/{name}", token=token)
        exists = st == 200
        password = ask_password(name, exists)
        body = {"status": 1, "username": name, **spec}
        if password:
            body["password"] = password
        if exists:
            st, res = call("PUT", f"/api/v2/users/{name}", token=token, body=body)
            action = "обновлён"
        else:
            st, res = call("POST", "/api/v2/users", token=token, body=body)
            action = "создан"
        if st not in (200, 201):
            sys.exit(f"«{name}»: ошибка {st}: {(res or {}).get('error') or (res or {}).get('message')}")
        print(f"  «{name}» {action}.")
    ensure_quota_rescan(token)
    print(f"Лимиты: admin — {OWNER_QUOTA // GIB} ГБ на весь обменник, гость uploads — {GUEST_QUOTA // GIB} ГБ; файл — до {MAX_FILE // GIB} ГБ.")
    print("Готово. Дальше всё меняется в веб-админке.")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        sys.exit("\nПрервано, ничего не записано.")
