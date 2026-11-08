"""Stats-only AOI guard (aois.toml `stats_only = true`): tile steps are refused by run.sh's plan and by load_aoi."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import common  # noqa: E402
from common import (STATS_ONLY_DEFAULT_STEPS, TILE_STEPS, entry_step, load_aoi, plan_steps)  # noqa: E402

TOML = """
[defaults]
buffer_m = 200
county = "SPK"
chunk_size = 500

[tiles]
name = "Tiles"
bbox = [378000, 5460000, 379000, 5461000]

[stats]
name = "Stats only"
bbox = [375000, 5453000, 387000, 5471000]
stats_only = true

[grp]
name = "Group"
group = ["tiles", "tiles2"]
after = ["fixture"]

[tiles2]
name = "Tiles 2"
bbox = [379000, 5460000, 380000, 5461000]

[stats2]
name = "Stats only, own output"
bbox = [375000, 5453000, 387000, 5471000]
stats_only = true
stats_output = "tiles"
"""


@pytest.fixture()
def toml(tmp_path: Path) -> Path:
    p = tmp_path / "aois.toml"
    p.write_text(TOML)
    return p


@pytest.mark.parametrize("step", TILE_STEPS)
def test_load_aoi_refuses_every_tile_step(toml: Path, step: str) -> None:
    with pytest.raises(SystemExit) as e:
        load_aoi("stats", toml, step=step)
    assert "stats_only" in str(e.value) and repr(step) in str(e.value)


def test_load_aoi_allows_stats_scripts_and_tile_aois(toml: Path) -> None:
    for step in (None, "places", "stats-trees", "stats-inputs", "stats"):
        a = load_aoi("stats", toml, step=step) if step else load_aoi("stats", toml)
        assert (a.e0, a.n1) == (375000, 5471000)
    for step in TILE_STEPS:
        assert load_aoi("tiles", toml, step=step).width == 1000


def test_entry_script_decides_without_a_step(toml: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert entry_step("/x/pipeline/build.py") == "build"
    assert entry_step("historic_forest.py") == "forest"
    assert entry_step("stats_inputs.py") is None and entry_step("-c") is None and entry_step("") is None
    monkeypatch.setattr(sys, "argv", ["trees.py", "stats"])
    with pytest.raises(SystemExit):
        load_aoi("stats", toml)
    monkeypatch.setattr(sys, "argv", ["stats_inputs.py", "all"])
    assert load_aoi("stats", toml).key == "stats"


def test_plan_defaults_and_refusal(toml: Path) -> None:
    assert plan_steps("stats", (), toml) == [(s, "overall" if s == "stats" else "stats")
                                             for s in STATS_ONLY_DEFAULT_STEPS]
    assert [s for s, _ in plan_steps("stats", (), toml)] == ["places", "stats-trees", "stats-inputs", "stats"]
    assert plan_steps("stats2", ["stats"], toml) == [("stats", "tiles")]
    assert plan_steps("tiles", ["build", "stats"], toml) == [("build", "tiles"), ("stats", "tiles")]
    assert [s for s, _ in plan_steps("tiles", (), toml)] == list(common.DEFAULT_STEPS)
    with pytest.raises(SystemExit) as e:
        plan_steps("stats", ["places", "fetch"], toml)   # refused before any step runs
    assert "'fetch'" in str(e.value)
    with pytest.raises(SystemExit):
        plan_steps("nope", (), toml)


def test_real_orte_is_stats_only() -> None:
    """The repo's [orte] AOI is stats-only and its default chain ends with `stats overall`."""
    assert plan_steps("orte")[-1] == ("stats", "overall")
    with pytest.raises(SystemExit):
        load_aoi("orte", step="trees")


def test_run_sh_refuses_tile_step_for_stats_aoi() -> None:
    """run.sh exits non-zero with the guard message before running anything (the plan is computed first)."""
    pipe = Path(__file__).resolve().parents[1]
    r = subprocess.run(["bash", str(pipe / "run.sh"), "orte", "places", "build"], capture_output=True, text=True,
                       timeout=120)
    assert r.returncode != 0
    assert "stats_only" in r.stderr and "=== places" not in r.stdout


def test_plan_group_runs_members_then_own_steps(toml: Path) -> None:
    plan = plan_steps("grp", (), toml)
    members = [s for s in common.DEFAULT_STEPS if s not in ("pois", "test")]
    assert plan == [(s, "tiles") for s in members] + [(s, "tiles2") for s in members] + \
        [("fixture", "grp"), ("test", "grp")]
    assert plan_steps("grp", ["build", "fixture"], toml) == [("build", "tiles"), ("build", "tiles2"),
                                                             ("fixture", "grp")]
    assert plan_steps("grp", ["fixture"], toml) == [("fixture", "grp")]
