#!/usr/bin/python3 -I
"""Сверка compose-файла с работающим контейнером (только чтение): compare-inspect.py <контейнер> <compose.yaml>
Берёт `docker inspect` контейнера и `docker compose config --format json` и печатает таблицу ключевых параметров.
Env сравнивается без значений, пришедших из образа (в compose должны быть только заданные вручную)."""
import json
import re
import subprocess
import sys

name, compose = sys.argv[1], sys.argv[2]


def sh(*a):
    return json.loads(subprocess.check_output(a, text=True))


ins = sh("docker", "inspect", name)[0]
img = sh("docker", "image", "inspect", ins["Image"])[0]
cfgall = sh("docker", "compose", "-p", name, "-f", compose, "config", "--format", "json")
svc = next(iter(cfgall["services"].values()))
c, h, ic = ins["Config"], ins["HostConfig"], img["Config"]
rows = []


def row(label, a, b):
    rows.append((label, a, b, "=" if a == b else "ОТЛИЧАЕТСЯ"))


def mem(v):
    if v in (None, 0, "0"):
        return 0
    if isinstance(v, int):
        return v
    m = re.match(r"^(\d+)([kmg]?)b?$", str(v).lower())
    return int(m.group(1)) * {"": 1, "k": 1024, "m": 1024**2, "g": 1024**3}[m.group(2)]


row("образ", c["Image"], svc["image"])
row("entrypoint", c.get("Entrypoint"), svc.get("entrypoint") or ic.get("Entrypoint"))
row("команда", c.get("Cmd"), svc.get("command") or ic.get("Cmd"))
row("restart", h["RestartPolicy"]["Name"], svc.get("restart"))
net_c = h["NetworkMode"]
net_s = svc.get("network_mode") or f"{cfgall['name']}_default"
row("сеть", "bridge/host" if net_c in ("bridge", "host") and net_c == net_s else net_c, "bridge/host" if net_c == net_s and net_c in ("bridge", "host") else net_s)
row("user", c.get("User") or None, svc.get("user"))
ports_c = sorted(f"{b.get('HostIp') or '*'}:{b['HostPort']}->{k}" for k, v in (h.get("PortBindings") or {}).items() for b in v)
ports_s = sorted(f"{p.get('host_ip') or '*'}:{p['published']}->{p['target']}/{p.get('protocol', 'tcp')}" for p in svc.get("ports", []))
row("порты", ports_c, ports_s)
vols_c = sorted(f"{m['Name'] if m['Type'] == 'volume' else m['Source']}:{m['Destination']}:{'rw' if m['RW'] else 'ro'}" for m in ins["Mounts"])
vols_s = sorted(f"{v['source']}:{v['target']}:{'ro' if v.get('read_only') else 'rw'}" for v in svc.get("volumes", []))
row("тома и каталоги", vols_c, vols_s)
env_img = set(ic.get("Env") or [])
env_c = sorted(e for e in c["Env"] if e not in env_img)
env_s = sorted(e for e in (f"{k}={v}" for k, v in (svc.get("environment") or {}).items()) if e not in env_img)
row("env (заданные вручную)", env_c, env_s)
row("cap_drop", h.get("CapDrop"), svc.get("cap_drop"))
row("cap_add", h.get("CapAdd"), svc.get("cap_add"))
row("security_opt", h.get("SecurityOpt"), svc.get("security_opt"))
row("privileged", h.get("Privileged"), bool(svc.get("privileged")))
row("read_only", h.get("ReadonlyRootfs"), bool(svc.get("read_only")))
row("tmpfs", sorted((h.get("Tmpfs") or {}).keys()), sorted(t.split(":")[0] for t in (svc.get("tmpfs") or [])))
row("лимит памяти", h.get("Memory") or 0, mem(svc.get("mem_limit")))
row("драйвер логов", h["LogConfig"]["Type"], (svc.get("logging") or {}).get("driver", "json-file"))
row("лог: опции", h["LogConfig"].get("Config") or {}, (svc.get("logging") or {}).get("options") or {})
hc_c = c.get("Healthcheck") if c.get("Healthcheck") != ic.get("Healthcheck") else "из образа"
row("healthcheck (не из образа)", hc_c if hc_c != "из образа" else None, svc.get("healthcheck"))
row("stop_grace_period", c.get("StopTimeout"), svc.get("stop_grace_period"))
w = max(len(r[0]) for r in rows)
for l, a, b, ok in rows:
    print(f"{ok:11} {l:{w}}  inspect={a}  compose={b}" if ok != "=" else f"{'=':11} {l:{w}}  {a}")
print("ОТЛИЧИЙ:", sum(1 for r in rows if r[3] != "="))
