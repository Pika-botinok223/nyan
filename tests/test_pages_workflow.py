from pathlib import Path

import pytest

yaml = pytest.importorskip("yaml")

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "pages.yml"


def load():
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_workflow_deploys_docs_to_pages():
    wf = load()
    job = wf["jobs"]["deploy"]
    steps = job["steps"]
    uses = [s.get("uses", "") for s in steps]

    assert any(u.startswith("actions/deploy-pages@") for u in uses)
    upload = next(s for s in steps if s.get("uses", "").startswith("actions/upload-pages-artifact@"))
    assert upload["with"]["path"] == "docs"
    assert job["environment"]["name"] == "github-pages"


def test_workflow_permissions_and_triggers():
    wf = load()
    assert wf["permissions"] == {"contents": "read", "pages": "write", "id-token": "write"}
    triggers = wf.get("on", wf.get(True))  # PyYAML parses a bare `on` key as True
    assert "workflow_dispatch" in triggers
    assert "docs/**" in triggers["push"]["paths"]
    assert "default_branch" in wf["jobs"]["deploy"]["if"]
