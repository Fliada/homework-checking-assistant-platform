"""AI authorship checks for submission artifacts via ml experiments/ai_check.py."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
AI_CHECK = ROOT / "ml experiments" / "ai_check.py"
DETECTOR_VENV = ROOT / "ml experiments" / "ru-ai-text-detector" / "venv" / "bin" / "python"
TEXT_EXT = {".md", ".txt", ".markdown"}
CODE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".java", ".rs", ".c", ".cpp", ".h"}


def _artifact_kind(path: str) -> str | None:
    ext = Path(path).suffix.lower()
    if ext in CODE_EXT or ext in TEXT_EXT:
        return "file"
    return None


def _stable_id(*parts: str) -> str:
    return hashlib.sha256(":".join(parts).encode()).hexdigest()[:24]


def _ai_check_python() -> str:
    if DETECTOR_VENV.is_file():
        return str(DETECTOR_VENV)
    return sys.executable


def _run_ai_check(path: str, content: str) -> dict[str, Any]:
    if not AI_CHECK.is_file():
        return {"error": "ai_check_missing", "signals": [], "highlights": []}
    suffix = Path(path).suffix or ".txt"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=suffix, delete=False) as handle:
        handle.write(content)
        temp_path = handle.name
    try:
        completed = subprocess.run(
            [_ai_check_python(), str(AI_CHECK), "--json", temp_path],
            capture_output=True,
            text=True,
            timeout=180,
            cwd=str(ROOT),
            env={**os.environ, "PYTHONUTF8": "1"},
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "ai_check_failed").strip().splitlines()[-1]
            return {"error": detail[:240], "signals": [], "highlights": []}
        payload = json.loads(completed.stdout)
        if not isinstance(payload, dict):
            return {"error": "invalid_ai_check_payload", "signals": [], "highlights": []}
        return payload
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
        return {"error": str(exc)[:240], "signals": [], "highlights": []}
    finally:
        Path(temp_path).unlink(missing_ok=True)


def _attach_ids(artifact_id: str, path: str, payload: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    signals: list[dict[str, Any]] = []
    highlights: list[dict[str, Any]] = []
    line_signal: dict[tuple[str, int], str] = {}
    for item in payload.get("signals", []):
        start = int(item.get("start_line", 1))
        end = int(item.get("end_line", start))
        block_name = item.get("block_name", path)
        signal_id = _stable_id(artifact_id, path, block_name, str(start))
        signal = {
            "id": signal_id,
            "artifact_id": artifact_id,
            "path": path,
            "kind": item.get("kind", payload.get("kind", "code")),
            "block_kind": item.get("block_kind", ""),
            "block_name": block_name,
            "start_line": start,
            "end_line": end,
            "classification": item.get("classification", ""),
            "ai_score": float(item.get("ai_score") or 0),
            "human_score": item.get("human_score"),
            "level": item.get("level", "low"),
            "status": "pending",
            "message": item.get("message", ""),
        }
        signals.append(signal)
        for line in range(start, end + 1):
            line_signal[(path, line)] = signal_id
    for item in payload.get("highlights", []):
        start = int(item.get("start_line", 1))
        end = int(item.get("end_line", start))
        highlight_id = _stable_id(artifact_id, path, "line", str(start), str(end))
        highlights.append(
            {
                "id": highlight_id,
                "signal_id": line_signal.get((path, start), ""),
                "artifact_id": artifact_id,
                "path": path,
                "kind": item.get("kind", payload.get("kind", "code")),
                "start_line": start,
                "end_line": end,
                "ai_score": float(item.get("ai_score") or 0),
                "level": item.get("level", "low"),
                "status": "pending",
                "message": item.get("message", ""),
                "reasons": item.get("reasons", []),
            }
        )
    return signals, highlights


def _aggregate_ai_score(highlights: list[dict[str, Any]], signals: list[dict[str, Any]]) -> float | None:
    values = [float(item.get("ai_score") or 0) for item in highlights if item.get("ai_score") is not None]
    if not values:
        values = [float(item.get("ai_score") or 0) for item in signals if item.get("ai_score") is not None]
    if not values:
        return None
    return round(max(values), 4)


def run_integrity_check(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    signals: list[dict[str, Any]] = []
    highlights: list[dict[str, Any]] = []
    levels: list[str] = []
    errors: list[str] = []

    for artifact in artifacts:
        path = artifact.get("path", "")
        if not path or _artifact_kind(path) is None:
            continue
        if artifact.get("parse_status") != "parsed":
            continue
        content = artifact.get("content", "")
        if not isinstance(content, str) or not content.strip():
            continue
        artifact_id = artifact.get("id", artifact.get("artifact_id", ""))
        payload = _run_ai_check(path, content)
        if payload.get("error"):
            errors.append(f"{path}: {payload['error']}")
            continue
        file_signals, file_highlights = _attach_ids(artifact_id, path, payload)
        signals.extend(file_signals)
        highlights.extend(file_highlights)
        levels.extend(item["level"] for item in file_signals if item.get("level"))

    if not signals and not highlights and errors:
        return {
            "status": "unavailable",
            "decision": "deferred",
            "level": None,
            "message": "Не удалось выполнить проверку на ИИ: " + "; ".join(errors[:2]),
            "signals": [],
            "highlights": [],
        }

    overall = None
    if levels:
        overall = "high" if "high" in levels else ("medium" if "medium" in levels else "low")

    ai_score = _aggregate_ai_score(highlights, signals)

    message = (
        f"Найдено сигналов: {len(signals)}."
        if signals
        else ("Анализ завершён, явных признаков ИИ не обнаружено." if not errors else "Анализ частично завершён.")
    )
    if ai_score is not None:
        message = f"Итоговая оценка ИИ: {ai_score * 100:.0f}%. " + message
    if errors and (signals or highlights):
        message += " Ошибки: " + "; ".join(errors[:2])

    return {
        "status": "partial" if errors else "completed",
        "decision": "pending" if signals else "none",
        "level": overall,
        "ai_score": ai_score,
        "message": message,
        "signals": signals,
        "highlights": highlights,
    }
