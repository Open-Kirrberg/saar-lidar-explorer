"""Entry point: `python -I cli.py <zone> [stage ...]` (run.sh wraps it). Stages run in order; default = all.

Stages: frames -> privacy -> sfm -> undistort -> mesh -> georef -> export -> package -> clean
"""
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # our own code only; -I keeps cwd off sys.path

from capture.common import load_zone, timed  # noqa: E402

STAGES = ["frames", "privacy", "sfm", "undistort", "mesh", "georef", "export", "package", "clean"]


def main(argv: list[str]) -> None:
    if not argv:
        print(__doc__)
        sys.exit(2)
    zone = load_zone(argv[0])
    stages = argv[1:] or STAGES
    for st in stages:
        if st not in STAGES:
            sys.exit(f"unknown stage {st!r}; known: {' '.join(STAGES)}")
    for st in stages:
        mod = importlib.import_module(f"capture.{st}")
        with timed(zone, st):
            mod.run(zone)


if __name__ == "__main__":
    main(sys.argv[1:])
