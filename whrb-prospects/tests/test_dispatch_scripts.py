"""Tests for the dispatch_*.py helper scripts.

The scripts themselves shell out to Supabase, so the surface under test
here is the parsing/branching logic — the regex that pulls the
``[pipeline_summary]`` line out of pipeline logs (dispatch_finalize_run)
and the env-driven branch selection (dispatch_adopt_run). Network
calls are exercised at the workflow level, not here.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

_SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


def _load_script(name: str) -> ModuleType:
    """Import a scripts/*.py module by file path.

    `scripts/` isn't a package, so a regular `import` won't find it.
    We use importlib to load the module file directly.
    """
    path = _SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# --- dispatch_finalize_run --------------------------------------------------


@pytest.fixture(scope="module")
def finalize() -> ModuleType:
    return _load_script("dispatch_finalize_run")


def test_summary_regex_parses_success_with_rows(finalize: ModuleType) -> None:
    log = "noise\n[pipeline_summary] status=success rows_upserted=2976 error=\nmore\n"
    matches = finalize.SUMMARY_RE.findall(log)
    assert matches == [("success", "2976", "")]


def test_summary_regex_parses_failure_with_error(finalize: ModuleType) -> None:
    log = "[pipeline_summary] status=failed rows_upserted= error=connection refused\n"
    matches = finalize.SUMMARY_RE.findall(log)
    assert matches == [("failed", "", "connection refused")]


def test_summary_regex_picks_last_when_duplicated(finalize: ModuleType) -> None:
    log = (
        "[pipeline_summary] status=success rows_upserted=10 error=\n"
        "[pipeline_summary] status=failed rows_upserted=0 error=oom\n"
    )
    matches = finalize.SUMMARY_RE.findall(log)
    assert matches[-1] == ("failed", "0", "oom")


def test_summary_regex_no_match_on_unrelated_line(finalize: ModuleType) -> None:
    assert finalize.SUMMARY_RE.findall("regular log output\n") == []


# --- dispatch_adopt_run -----------------------------------------------------


class _FakeSupabase:
    """Records `.table(...)` operations without hitting the network.

    The real client returns a chain whose terminal `.execute()` yields a
    response object with `.data`. We stub just enough of that shape to
    let the script under test reach its branches.
    """

    def __init__(self, *, update_returns: list[dict[str, Any]] | None = None,
                 insert_returns: list[dict[str, Any]] | None = None,
                 select_returns: dict[str, Any] | None = None) -> None:
        self._update_returns = update_returns or []
        self._insert_returns = insert_returns or []
        self._select_returns = select_returns or {}
        self.calls: list[tuple[str, ...]] = []

    def table(self, name: str) -> _FakeSupabase:
        self.calls.append(("table", name))
        return self

    def update(self, patch: dict[str, Any]) -> _FakeSupabase:
        self.calls.append(("update", tuple(sorted(patch.keys()))))
        return self

    def insert(self, row: dict[str, Any]) -> _FakeSupabase:
        self.calls.append(("insert", tuple(sorted(row.keys()))))
        return self

    def select(self, col: str) -> _FakeSupabase:
        self.calls.append(("select", col))
        return self

    def eq(self, col: str, _val: Any) -> _FakeSupabase:
        self.calls.append(("eq", col))
        return self

    def single(self) -> _FakeSupabase:
        return self

    def execute(self) -> Any:
        last = self.calls[-1][0] if self.calls else ""
        if last == "single":
            data: Any = self._select_returns
        elif any(c[0] == "update" for c in reversed(self.calls)) and not any(
            c[0] == "select" for c in self.calls
        ):
            data = self._update_returns
        elif any(c[0] == "insert" for c in self.calls):
            data = self._insert_returns
        else:
            data = self._select_returns

        class _Resp:
            def __init__(self, d: Any) -> None:
                self.data = d

        return _Resp(data)


@pytest.fixture(scope="module")
def adopt() -> ModuleType:
    return _load_script("dispatch_adopt_run")


def test_repository_dispatch_missing_run_id_exits_nonzero(
    adopt: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "github_output"
    output_file.touch()
    monkeypatch.setenv("SUPABASE_URL", "https://stub.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "stub-key")
    monkeypatch.setenv("EVENT_NAME", "repository_dispatch")
    monkeypatch.setenv("DISPATCH_RUN_ID", "")
    monkeypatch.setenv("GITHUB_RUN_ID", "999")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setattr(adopt, "create_client", lambda *_a, **_k: _FakeSupabase())

    rc = adopt.main()
    assert rc == 1


def test_schedule_event_inserts_running_row_and_writes_output(
    adopt: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "github_output"
    output_file.touch()
    fake = _FakeSupabase(insert_returns=[{"id": "abc-123"}])

    monkeypatch.setenv("SUPABASE_URL", "https://stub.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "stub-key")
    monkeypatch.setenv("EVENT_NAME", "schedule")
    monkeypatch.setenv("GITHUB_RUN_ID", "42")
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setattr(adopt, "create_client", lambda *_a, **_k: fake)

    rc = adopt.main()
    assert rc == 0
    assert any(c[0] == "insert" for c in fake.calls)
    contents = output_file.read_text()
    assert "run_id=abc-123" in contents
    assert "args=" in contents


def test_workflow_dispatch_inserts_with_manual_marker(
    adopt: ModuleType,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    output_file = tmp_path / "github_output"
    output_file.touch()
    captured: dict[str, Any] = {}

    class _Recording(_FakeSupabase):
        def insert(self, row: dict[str, Any]) -> _FakeSupabase:
            captured["row"] = row
            return super().insert(row)

    fake = _Recording(insert_returns=[{"id": "wf-1"}])

    monkeypatch.setenv("SUPABASE_URL", "https://stub.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "stub-key")
    monkeypatch.setenv("EVENT_NAME", "workflow_dispatch")
    monkeypatch.setenv("GITHUB_RUN_ID", "0")  # falsy → omitted from row
    monkeypatch.setenv("GITHUB_OUTPUT", str(output_file))
    monkeypatch.setattr(adopt, "create_client", lambda *_a, **_k: fake)

    rc = adopt.main()
    assert rc == 0
    assert captured["row"]["args"] == "--manual"
    assert captured["row"]["status"] == "running"
    # GITHUB_RUN_ID="0" is treated as missing — column omitted, not zeroed
    assert "github_run_id" not in captured["row"]
