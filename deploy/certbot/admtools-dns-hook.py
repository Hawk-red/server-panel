#!/usr/bin/env python3
"""Хук certbot для DNS-01 через API adm.tools (Hosting Ukraine / ukraine.com.ua) — без проброса порта 80.
Формат запросов взят из рабочего certbot-плагина certbot-dns-ukrainecomua (тот же API, тот же протокол);
здесь переписано на стандартную библиотеку, чтобы не ставить lexicon/dns-lexicon как пакет.

Установка: sudo /opt/server-panel/deploy/certbot/dns01-setup.sh (токен, файл токена, установка сюда же).
Запуск (делает certbot через --manual-auth-hook / --manual-cleanup-hook, см. dns01-switch.sh):
    admtools-dns-hook.py auth       — сначала удалить ВСЕ старые TXT-записи _acme-challenge.<домен> (хвосты
                                       от прошлых/прерванных попыток), затем добавить новую и подождать,
                                       пока она не ответит со всех авторитативных NS домена
    admtools-dns-hook.py cleanup    — удалить ВСЕ TXT-записи _acme-challenge.<домен>, не только свою
Ручные команды (домен указывать как есть, например api.pulsdev.net — «_acme-challenge.» добавится сам):
    admtools-dns-hook.py list  <домен>   — показать все TXT-записи _acme-challenge.<домен>
    admtools-dns-hook.py wipe  <домен>   — удалить их все
    admtools-dns-hook.py selftest        — только проверить токен (список доменов), ничего не меняет

Переменные окружения от certbot: CERTBOT_DOMAIN (проверяемый домен), CERTBOT_VALIDATION (значение записи).
ADMTOOLS_TOKEN_FILE — путь к файлу токена (по умолчанию /etc/letsencrypt/admtools-api-token).
ADMTOOLS_API_BASE   — базовый URL API (по умолчанию https://adm.tools/action; для тестов — свой сервер).
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE = os.environ.get("ADMTOOLS_API_BASE", "https://adm.tools/action")
TOKEN_FILE = os.environ.get("ADMTOOLS_TOKEN_FILE", "/etc/letsencrypt/admtools-api-token")
PROPAGATION_TIMEOUT = int(os.environ.get("ADMTOOLS_PROPAGATION_TIMEOUT", 90))  # секунд ждать через авторитативные NS (не фатально)
POLL_INTERVAL = int(os.environ.get("ADMTOOLS_POLL_INTERVAL", 5))
DIG = os.environ.get("ADMTOOLS_DIG", "/usr/bin/dig")
MIN_INTERVAL_BETWEEN_CALLS = 1.0  # у adm.tools лимит — не больше 2 запросов в секунду


class ApiError(Exception):
    pass


def read_token() -> str:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            token = f.read().strip()
    except FileNotFoundError:
        sys.exit(f"Файл токена не найден: {TOKEN_FILE}. Сначала запустите dns01-setup.sh.")
    except PermissionError:
        sys.exit(f"Нет доступа к {TOKEN_FILE} (запускать хук нужно от root — так его вызывает certbot).")
    if not token:
        sys.exit(f"Файл токена {TOKEN_FILE} пуст.")
    return token


_last_call = 0.0


def api(path: str, data: dict | None = None) -> dict:
    """POST на adm.tools: form-urlencoded тело, ответ {"result": bool, "response": {...}}."""
    global _last_call
    wait = MIN_INTERVAL_BETWEEN_CALLS - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    body = urllib.parse.urlencode(data or {}).encode()
    req = urllib.request.Request(
        API_BASE + path,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {read_token()}",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "server-panel-certbot-hook",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:300]
        raise ApiError(f"{path}: HTTP {e.code} — {detail}") from e
    except urllib.error.URLError as e:
        raise ApiError(f"{path}: adm.tools недоступен ({e.reason})") from e
    finally:
        _last_call = time.monotonic()
    try:
        j = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(f"{path}: не JSON в ответе: {raw[:200]!r}")
    if not j.get("result"):
        raise ApiError(f"{path}: adm.tools вернул ошибку: {j}")
    return j.get("response") or {}


def find_domain(fqdn: str) -> tuple[str, str]:
    """По полному имени находит зарегистрированный в adm.tools корневой домен и его domain_id."""
    domains = api("/dns/list/").get("list") or {}
    fqdn = fqdn.rstrip(".")
    best = None
    for name, info in domains.items():
        name = name.rstrip(".")
        if fqdn == name or fqdn.endswith("." + name):
            if best is None or len(name) > len(best[0]):
                best = (name, str(info["domain_id"]))
    if not best:
        raise ApiError(f"В adm.tools нет домена, под который подходит {fqdn}. Есть: {', '.join(domains) or '(пусто)'}")
    return best


def relative_name(fqdn: str, root: str) -> str:
    fqdn = fqdn.rstrip(".")
    if fqdn == root:
        return ""
    return fqdn[: -(len(root) + 1)]


def find_records(domain_id: str, rtype: str, record: str, data: str | None = None):
    rows = api("/dns/records_list/", {"domain_id": domain_id}).get("list") or []
    return [r for r in rows if r.get("type") == rtype and r.get("record") == record and (data is None or r.get("data") == data)]


def authoritative_ns(domain: str) -> list[str]:
    try:
        out = subprocess.run([DIG, "+short", "NS", domain], capture_output=True, text=True, timeout=10)
        return sorted({l.strip().rstrip(".") for l in out.stdout.splitlines() if l.strip()})
    except Exception:
        return []


def wait_for_propagation(fqdn: str, root: str, expected: str):
    ns_list = authoritative_ns(root)
    if not ns_list:
        print(f"  (не удалось узнать NS для {root} — жду {POLL_INTERVAL} с наугад)", file=sys.stderr)
        time.sleep(POLL_INTERVAL)
        return
    deadline = time.monotonic() + PROPAGATION_TIMEOUT
    while time.monotonic() < deadline:
        ok = 0
        for ns in ns_list:
            try:
                out = subprocess.run([DIG, "+short", "+time=3", "+tries=1", "TXT", fqdn, f"@{ns}"], capture_output=True, text=True, timeout=6)
                if expected in out.stdout:
                    ok += 1
            except Exception:
                pass
        if ok == len(ns_list):
            print(f"  запись видна на всех {ok} серверах имён домена {root}")
            return
        print(f"  запись видна на {ok} из {len(ns_list)} серверов имён — жду ещё {POLL_INTERVAL} с…", file=sys.stderr)
        time.sleep(POLL_INTERVAL)
    print(f"  !! за {PROPAGATION_TIMEOUT} с запись не разошлась по всем NS — продолжаю всё равно, "
          f"Let's Encrypt может не пройти проверку с первого раза", file=sys.stderr)


def wipe_records(domain_id: str, rel: str) -> int:
    """Удаляет ВСЕ TXT-записи с этим относительным именем (не важно, что в data) — хвосты прошлых попыток."""
    records = find_records(domain_id, "TXT", rel)
    for r in records:
        api("/dns/record_delete/", {"subdomain_id": r["id"]})
    return len(records)


def cmd_auth():
    domain = os.environ.get("CERTBOT_DOMAIN")
    validation = os.environ.get("CERTBOT_VALIDATION")
    if not domain or not validation:
        sys.exit("Нет CERTBOT_DOMAIN/CERTBOT_VALIDATION — запускать этот скрипт должен certbot (--manual-auth-hook).")
    fqdn = f"_acme-challenge.{domain}"
    root, domain_id = find_domain(domain)
    rel = relative_name(fqdn, root)
    print(f"[auth] {fqdn} → домен в adm.tools: {root}, запись: {rel or '@'}")
    # Сначала сносим все старые записи с этим именем (хвосты от прошлых/прерванных попыток) —
    # DNS-01 проверяется по ВСЕМ TXT сразу, лишняя старая запись валит проверку, даже если новая верна.
    removed = wipe_records(domain_id, rel)
    if removed:
        print(f"  снесены старые записи с тем же именем: {removed}")
    api("/dns/record_add", {"domain_id": domain_id, "type": "TXT", "record": rel, "data": validation})
    print("  запись добавлена")
    wait_for_propagation(fqdn, root, validation)


def cmd_cleanup():
    domain = os.environ.get("CERTBOT_DOMAIN")
    if not domain:
        sys.exit("Нет CERTBOT_DOMAIN — запускать этот скрипт должен certbot (--manual-cleanup-hook).")
    fqdn = f"_acme-challenge.{domain}"
    try:
        root, domain_id = find_domain(domain)
    except ApiError as e:
        print(f"[cleanup] {e} — убирать нечего", file=sys.stderr)
        return
    rel = relative_name(fqdn, root)
    # Удаляем ВСЕ TXT-записи с этим именем, не только ту, что добавили в этом прогоне — чтобы не копились хвосты.
    removed = wipe_records(domain_id, rel)
    print(f"[cleanup] {fqdn}: удалено записей: {removed}" if removed else f"[cleanup] {fqdn}: записей уже нет")


def cmd_list(domain: str):
    fqdn = f"_acme-challenge.{domain}"
    root, domain_id = find_domain(domain)
    rel = relative_name(fqdn, root)
    records = find_records(domain_id, "TXT", rel)
    if not records:
        print(f"{fqdn} (домен {root}): TXT-записей нет")
        return
    print(f"{fqdn} (домен {root}, запись «{rel or '@'}») — TXT-записей: {len(records)}")
    for r in records:
        print(f"  id={r.get('id')}  data={r.get('data')}")


def cmd_wipe(domain: str):
    fqdn = f"_acme-challenge.{domain}"
    root, domain_id = find_domain(domain)
    rel = relative_name(fqdn, root)
    records = find_records(domain_id, "TXT", rel)
    for r in records:
        print(f"  удаляю id={r.get('id')}  data={r.get('data')}")
    removed = wipe_records(domain_id, rel)
    print(f"{fqdn}: удалено записей: {removed}" if removed else f"{fqdn}: записей и не было")


def cmd_selftest():
    domains = api("/dns/list/").get("list") or {}
    if not domains:
        sys.exit("Токен принят, но в аккаунте adm.tools нет ни одного домена под управлением DNS.")
    print(f"Токен работает. Доменов под управлением DNS: {len(domains)} ({', '.join(sorted(domains))}).")


if __name__ == "__main__":
    USAGE = f"Использование: {sys.argv[0]} auth|cleanup|selftest | list <домен> | wipe <домен>"
    if len(sys.argv) < 2:
        sys.exit(USAGE)
    cmd = sys.argv[1]
    try:
        if cmd in ("auth", "cleanup", "selftest") and len(sys.argv) == 2:
            {"auth": cmd_auth, "cleanup": cmd_cleanup, "selftest": cmd_selftest}[cmd]()
        elif cmd in ("list", "wipe") and len(sys.argv) == 3:
            {"list": cmd_list, "wipe": cmd_wipe}[cmd](sys.argv[2])
        else:
            sys.exit(USAGE)
    except ApiError as e:
        sys.exit(f"Ошибка adm.tools: {e}")
