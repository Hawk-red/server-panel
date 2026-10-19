#!/usr/bin/python3 -I
"""Тесты server-panel-bluetooth на подставных systemctl/rfkill: ничего реального не запускается.
Запуск: python3 -I deploy/bluetooth/test_helper.py"""
import importlib.machinery
import importlib.util
import io
import os
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "server-panel-bluetooth")
spec = importlib.util.spec_from_loader("spbt", importlib.machinery.SourceFileLoader("spbt", path))
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class Sys:
    """Минимальная модель systemd: active + состояние юнита."""
    def __init__(self, active=False, enabled="masked"):
        self.active, self.enabled, self.calls = active, enabled, []

    def run(self, argv, check=True):
        self.calls.append(argv[1:] if argv[0] == h.SYSTEMCTL else ["rfkill", *argv[1:]])
        if argv[0] == h.RFKILL:
            return 0, '{"rfkilldevices":[{"id":2,"type":"bluetooth","soft":"unblocked","hard":"unblocked"},{"id":0,"type":"wlan","soft":"blocked","hard":"unblocked"}]}'
        cmd = argv[1]
        if cmd == "is-active": return (0 if self.active else 3), ("active\n" if self.active else "inactive\n")
        if cmd == "is-enabled": return (1 if self.enabled in ("masked", "disabled") else 0), self.enabled + "\n"
        if cmd == "unmask" and self.enabled == "masked": self.enabled = "disabled"
        elif cmd == "mask": self.enabled = "masked"
        elif cmd == "enable": self.enabled = "enabled"
        elif cmd == "disable": self.enabled = "disabled"
        elif cmd == "start": self.active = True
        elif cmd == "stop": self.active = False
        return 0, ""


class T(unittest.TestCase):
    def go(self, args, sysm):
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(h, "run", sysm.run), mock.patch.object(h, "lock", lambda: os.open("/dev/null", os.O_RDONLY)), \
             mock.patch.object(h, "log", lambda m: None), mock.patch.object(h, "adapter_found", lambda: True), \
             redirect_stdout(out), redirect_stderr(err):
            code = h.main(args)
        return code, out.getvalue(), err.getvalue()

    def test_whitelist(self):
        s = Sys()
        for bad in ([], ["on", "off"], ["restart"], ["status", "x"], ["ON"], ["on;reboot"], ["$(id)"], ["--help"], [""]):
            code, _, err = self.go(bad, s)
            self.assertEqual(code, 2, bad)
        self.assertEqual(s.calls, [])  # ни одна команда не запускалась

    def test_status_masked(self):
        import json
        code, out, _ = self.go(["status"], Sys(False, "masked"))
        d = json.loads(out)
        self.assertEqual((code, d["active"], d["enabled"], d["masked"], d["autostart"], d["adapter"]), (0, False, "masked", True, False, True))
        self.assertEqual(d["rfkill"], {"soft": False, "hard": False})

    def test_on_does_not_enable(self):
        s = Sys(False, "masked")
        code, _, _ = self.go(["on"], s)
        self.assertEqual(code, 0)
        self.assertTrue(s.active)
        self.assertEqual(s.enabled, "disabled")  # unmask без enable
        self.assertIn(["rfkill", "unblock", "bluetooth"], s.calls)
        self.assertNotIn(["enable", h.UNIT], s.calls)

    def test_off_masks_when_autostart_off(self):
        s = Sys(True, "disabled")
        self.assertEqual(self.go(["off"], s)[0], 0)
        self.assertFalse(s.active)
        self.assertEqual(s.enabled, "masked")

    def test_off_keeps_enabled(self):
        s = Sys(True, "enabled")
        self.go(["off"], s)
        self.assertFalse(s.active)
        self.assertEqual(s.enabled, "enabled")  # автозагрузка включена — не маскируем

    def test_autostart_on(self):
        s = Sys(False, "masked")
        self.go(["autostart-on"], s)
        self.assertEqual(s.enabled, "enabled")
        self.assertFalse(s.active)  # сам не запускает

    def test_autostart_off_active_does_not_mask(self):
        s = Sys(True, "enabled")
        self.go(["autostart-off"], s)
        self.assertEqual((s.enabled, s.active), ("disabled", True))

    def test_autostart_off_inactive_masks(self):
        s = Sys(False, "enabled")
        self.go(["autostart-off"], s)
        self.assertEqual(s.enabled, "masked")

    def test_failure_exit_3(self):
        s = Sys(False, "masked")
        def boom(argv, check=True):
            if len(argv) > 1 and argv[1] == "start": raise h.Fail("start bluetooth.service: Failed")
            return s.run(argv, check)
        out, err = io.StringIO(), io.StringIO()
        with mock.patch.object(h, "run", boom), mock.patch.object(h, "lock", lambda: os.open("/dev/null", os.O_RDONLY)), \
             mock.patch.object(h, "log", lambda m: None), mock.patch.object(h, "adapter_found", lambda: True), \
             redirect_stdout(out), redirect_stderr(err):
            self.assertEqual(h.main(["on"]), 3)
        self.assertIn("Failed", err.getvalue())


if __name__ == "__main__":
    unittest.main()
