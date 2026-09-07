from app.services.integrity_check import run_integrity_check


def test_integrity_skips_non_python_files():
    artifacts = [
        {
            "id": "a1",
            "path": "readme.md",
            "parse_status": "parsed",
            "content": "# Title\n\nSome text.",
        }
    ]
    result = run_integrity_check(artifacts)
    assert result["status"] in {"completed", "unavailable"}
    assert result["signals"] == []


def test_integrity_analyzes_python_when_codect_available():
    code = "def ping():\n    return 'pong'\n"
    artifacts = [{"id": "a1", "path": "main.py", "parse_status": "parsed", "content": code}]
    result = run_integrity_check(artifacts)
    if result["status"] == "unavailable":
        return
    assert result["status"] == "completed"
    assert isinstance(result["signals"], list)
