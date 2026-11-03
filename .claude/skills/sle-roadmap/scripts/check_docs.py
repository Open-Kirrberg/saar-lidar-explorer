#!/usr/bin/env python3
"""Docs drift gate (ADR 0025): ADR index complete, status lines valid, supersede targets exist,
relative links resolve, PRD short. Usage: python3 -I check_docs.py <repo-root>"""
import re
import sys
from pathlib import Path

PRD_MAX_LINES = 150
STATUS = re.compile(r"^- \*\*Status:\*\* (Proposed|Accepted|Superseded by (\d{4}))\b", re.M)
LINK = re.compile(r"\]\(([^)#\s]+)(?:#[^)]*)?\)")


def main(root: Path) -> int:
    errors: list[str] = []
    adr_dir = root / "docs/adr"
    index = (adr_dir / "README.md").read_text(encoding="utf-8")
    adrs = sorted(p for p in adr_dir.glob("[0-9][0-9][0-9][0-9]-*.md"))
    numbers = {p.name[:4] for p in adrs}
    if len(numbers) != len(adrs):
        errors.append("duplicate ADR numbers")
    for p in adrs:
        text = p.read_text(encoding="utf-8")
        if f"]({p.name})" not in index:
            errors.append(f"{p.name}: not linked in docs/adr/README.md")
        if not text.startswith(f"# {p.name[:4]} · "):
            errors.append(f"{p.name}: title must start with '# {p.name[:4]} · '")
        m = STATUS.search(text)
        if not m:
            errors.append(f"{p.name}: missing/invalid '- **Status:**' line")
        elif m.group(2) and m.group(2) not in numbers:
            errors.append(f"{p.name}: superseded by missing ADR {m.group(2)}")
    for target in re.findall(r"\]\((\d{4}-[^)]+\.md)\)", index):
        if not (adr_dir / target).exists():
            errors.append(f"docs/adr/README.md: dead link {target}")
    for doc in [root / "PRD.md", root / "CHANGELOG.md", root / "README.md", root / "app/README.md", root / "schloss-karlsberg/README.md", root / "schloss-karlsberg/CHANGELOG.md", root / "schloss-karlsberg/docs/improvement-backlog.md", adr_dir / "README.md", *adrs]:
        for href in LINK.findall(doc.read_text(encoding="utf-8")):
            if "://" in href or href.startswith("mailto:"):
                continue
            if not (doc.parent / href).exists():
                errors.append(f"{doc.relative_to(root)}: dead link {href}")
    prd_lines = len((root / "PRD.md").read_text(encoding="utf-8").splitlines())
    if prd_lines > PRD_MAX_LINES:
        errors.append(f"PRD.md: {prd_lines} lines > {PRD_MAX_LINES} (move decisions to ADRs)")
    for e in errors:
        print("  ✗", e)
    print(f"  {len(adrs)} ADRs, PRD {prd_lines}/{PRD_MAX_LINES} lines, {len(errors)} problems")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
