#!/usr/bin/env python3
"""Neutralise local paths and scan an exported code tree for secrets (stdlib only, Python >= 3.9).

  secret_scan.py <export dir> --repo-root <abs path of the source checkout> [--report findings.md]

1. Redact (in place, text files only): `Path("<repo root>")` in Python files -> `Path(__file__).resolve().parents[n]`,
   other occurrences of `<repo root>/` -> repo-relative, `$HOME` -> `~`, Claude scratch dirs
   (`/private/tmp/claude-…`) -> `<local scratch dir>`.
2. Scan: forbidden files (.env, private keys, settings.local.json, .npmrc tokens …), token patterns,
   private keys, credential assignments (HIGH -> exit 1), e-mail addresses other than noreply/example and
   remaining absolute home paths (INFO, listed for review).
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from typing import List, Tuple

TEXT_EXT = {".py", ".ts", ".js", ".json", ".md", ".sh", ".toml", ".yaml", ".yml", ".txt", ".html", ".css", ".glsl",
            ".swift", ".geojson", ".cfg", ".ini", ".lock", ""}

FORBIDDEN_NAMES = [
    (re.compile(r"(^|/)\.env(\..*)?$"), ".env file"),
    (re.compile(r"(^|/)id_(rsa|ed25519|ecdsa|dsa)(\.pub)?$"), "SSH key file"),
    (re.compile(r"\.(pem|key|p12|pfx|keystore)$"), "key/certificate file"),
    (re.compile(r"(^|/)\.claude/settings\.local\.json$"), "Claude local settings"),
    (re.compile(r"(^|/)\.npmrc$"), ".npmrc (may hold tokens)"),
    (re.compile(r"(^|/)\.netrc$"), ".netrc"),
    (re.compile(r"(^|/)\.ssh/"), "~/.ssh content"),
]
HIGH = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"), "private key"),
    (re.compile(r"AKIA[0-9A-Z]{16}"), "AWS access key"),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}"), "GitHub token"),
    (re.compile(r"github_pat_[A-Za-z0-9_]{20,}"), "GitHub fine-grained token"),
    (re.compile(r"\bsk-(ant-)?[A-Za-z0-9_-]{24,}"), "API secret key (sk-…)"),
    (re.compile(r"AIza[0-9A-Za-z_-]{35}"), "Google API key"),
    (re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"(?i)\b(api[_-]?key|secret|access[_-]?token|auth[_-]?token|passw(or)?d)\b\s*[:=]\s*['\"][^'\"\s]{8,}['\"]"), "credential assignment"),
    (re.compile(r"//registry\.npmjs\.org/:_authToken"), "npm auth token"),
]
EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
EMAIL_OK = re.compile(r"(noreply|no-reply)@|@users\.noreply\.github\.com$|@example\.(org|com|net)$|\.test$|\.localhost$|\.github\.io$")
HOME_PATH = re.compile(r"(/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|C:\\\\Users\\\\[A-Za-z0-9._-]+)")


def is_text(p: Path) -> bool:
    if p.suffix.lower() not in TEXT_EXT:
        return False
    try:
        with p.open("rb") as fh:
            return b"\0" not in fh.read(8192)
    except OSError:
        return False


def redact(root: Path, repo_root: str, home: str) -> List[str]:
    changed = []
    scratch = re.compile(r"/private/tmp/claude-[^\s`'\")]+|/tmp/claude-[^\s`'\")]+")
    for p in sorted(root.rglob("*")):
        if not p.is_file() or ".git" in p.relative_to(root).parts or not is_text(p):
            continue
        rel = p.relative_to(root)
        if rel.as_posix().startswith("scripts/release/"):
            continue  # the release tooling itself (its patterns would redact themselves)
        s = p.read_text(encoding="utf-8", errors="surrogateescape")
        o = s
        if p.suffix == ".py":
            depth = len(rel.parts) - 1
            s = s.replace(f'Path("{repo_root}")', f"Path(__file__).resolve().parents[{depth}]")
        s = s.replace(repo_root + "/", "").replace(repo_root, ".")
        s = scratch.sub("<local scratch dir>", s)
        if home and home != "/":
            s = s.replace(home + "/", "~/")
        if s != o:
            p.write_text(s, encoding="utf-8", errors="surrogateescape")
            changed.append(rel.as_posix())
    return changed


def scan(root: Path) -> Tuple[List[str], List[str]]:
    high: List[str] = []
    info: List[str] = []
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if rel.startswith(".git/"):
            continue
        for rx, what in FORBIDDEN_NAMES:
            if rx.search(rel):
                high.append(f"`{rel}`: {what}")
        if not is_text(p):
            continue
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            for rx, what in HIGH:
                if rx.search(line):
                    high.append(f"`{rel}:{n}`: {what}")
            for m in EMAIL.finditer(line):
                if not EMAIL_OK.search(m.group(0)):
                    info.append(f"`{rel}:{n}`: e-mail `{m.group(0)}`")
            for m in HOME_PATH.finditer(line):
                info.append(f"`{rel}:{n}`: absolute home path `{m.group(0)}`")
    return high, info


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", type=Path)
    ap.add_argument("--repo-root", required=True)
    ap.add_argument("--report", type=Path)
    a = ap.parse_args()
    root = a.root.resolve()
    changed = redact(root, a.repo_root.rstrip("/"), os.path.expanduser("~"))
    high, info = scan(root)
    lines = ["# Secret scan of the code export", "", f"Tree: `{root}`", "",
             f"## Neutralised local paths ({len(changed)} files)", *([f"- `{c}`" for c in changed] or ["- none"]), "",
             f"## HIGH ({len(high)})", *([f"- {h}" for h in high] or ["- none"]), "",
             f"## INFO – review ({len(info)})", *([f"- {i}" for i in info] or ["- none"]), ""]
    text = "\n".join(lines)
    print(text)
    if a.report:
        a.report.write_text(text, encoding="utf-8")
    return 1 if high else 0


if __name__ == "__main__":
    sys.exit(main())
