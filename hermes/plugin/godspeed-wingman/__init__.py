"""godspeed-wingman: the open question and the waiting reply ideas, handed to the model before each turn.

Runs `godspeed-wingman context` and returns its output as injected context, so a short "agree" or
"send 2" lands in the right place. Works on Linux, macOS and Windows: setup writes the exact
command line (launcher.json: Node and the program, with the mission control and the private
folder), so no shell and no .cmd file is needed. Every failure returns None: a broken Wingman
never breaks the assistant.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _command():
    try:
        with open(os.path.join(HERE, "launcher.json"), encoding="utf-8") as f:
            argv = json.load(f).get("argv") or []
        if len(argv) >= 2 and os.path.exists(argv[0]) and os.path.exists(argv[1]):
            return [argv[0], argv[1], "context"] + list(argv[2:])
    except (OSError, ValueError, AttributeError):
        pass
    candidates = []
    try:
        with open(os.path.join(HERE, "launcher.txt"), encoding="utf-8") as f:
            candidates.append(f.read().strip())
    except OSError:
        pass
    home = os.path.expanduser("~")
    if sys.platform == "win32":
        candidates.append(os.path.join(home, ".godspeed", "bin", "godspeed-wingman.cmd"))
    candidates += [
        os.path.join(home, ".godspeed", "bin", "godspeed-wingman"),
        shutil.which("godspeed-wingman") or "",
        "/usr/local/bin/godspeed-wingman",
    ]
    for c in candidates:
        if c and os.path.exists(c):
            # A sh launcher cannot start on Windows; its .cmd sister can.
            if sys.platform == "win32" and not c.lower().endswith((".cmd", ".bat", ".exe")):
                if os.path.exists(c + ".cmd"):
                    return [c + ".cmd", "context"]
                continue
            return [c, "context"]
    return None


def on_pre_llm_call(**kwargs):
    try:
        cmd = _command()
        if not cmd:
            return None
        flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=5, creationflags=flags)
        out = (r.stdout or "").strip()
        return {"context": out} if out else None
    except Exception:
        return None


def register(ctx):
    ctx.register_hook("pre_llm_call", on_pre_llm_call)
