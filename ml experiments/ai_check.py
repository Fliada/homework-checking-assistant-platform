#!/usr/bin/env python3
"""Единая проверка: код (Codect) и текст (ru-ai-text-detector)."""

from __future__ import annotations

import argparse
import ast
import html
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CODect_PYTHON = ROOT / "Codect" / "packages" / "core" / "python"
DETECTOR = ROOT / "ru-ai-text-detector"
VENV_PY = DETECTOR / "venv" / "bin" / "python"

CODE_EXT = {".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".java", ".rs", ".c", ".cpp", ".h", ".md", ".txt", ".markdown"}
TEXT_EXT = {".md", ".txt", ".markdown"}

# --- Codect (код) --------------------------------------------------------------

AI_LABEL = "AI-Generated Code"
HUMAN_LABEL = "Human-Written Code"
MIXED_LABEL = "Uncertain (Mixed Signals)"

LINE_PATTERNS: list[tuple[str, str, str]] = [
    (r"\b(print|breakpoint)\s*\(", "debug print", "human"),
    (r"#\s*(TODO|FIXME|HACK|XXX|BUG|REFACTOR)\b", "TODO-комментарий", "human"),
    (r"#\s*(if|for|while|def|class|import|return|with)\b", "закомментированный код", "human"),
    (r"\b(foo|bar|baz|example|sample|demo|tutorial|helper)\b", "generic-имя", "ai"),
    (r"\b(TODO|FIXME|INSERT|REPLACE|your_|my_|some_)\b", "placeholder", "ai"),
    (r'"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'', "docstring", "ai"),
]
MAGIC_SKIP = {0, 1, 2, -1, 10, 60, 100, 1000}


@dataclass
class BlockResult:
    kind: str
    name: str
    start: int
    end: int
    classification: str
    ai_score: float
    human_score: float
    ai_signals: list[str] = field(default_factory=list)
    human_signals: list[str] = field(default_factory=list)


@dataclass
class LineHit:
    reasons: list[str] = field(default_factory=list)
    tags: set[str] = field(default_factory=set)
    block: str | None = None
    block_class: str | None = None


def _codect_imports():
    if str(CODect_PYTHON) not in sys.path:
        sys.path.insert(0, str(CODect_PYTHON))
    from common_metrics import classify_signals  # noqa: E402
    from python_analyzer import ImprovedPythonAnalyzer  # noqa: E402

    return classify_signals, ImprovedPythonAnalyzer


def _end_line(node: ast.AST) -> int:
    return getattr(node, "end_lineno", node.lineno)


def _analyze_code_chunk(code: str, classify_signals, ImprovedPythonAnalyzer):
    analyzer = ImprovedPythonAnalyzer(code)
    features = analyzer.extract_all_features()
    classification, _, _ = classify_signals(
        features,
        ImprovedPythonAnalyzer.AI_WEIGHTS,
        ImprovedPythonAnalyzer.HUMAN_WEIGHTS,
    )
    return (
        classification,
        float(features.get("ai_score", 0)),
        float(features.get("human_score", 0)),
        list(features.get("top_ai_signals", [])),
        list(features.get("top_human_signals", [])),
    )


def analyze_code(path: Path):
    classify_signals, ImprovedPythonAnalyzer = _codect_imports()
    code = path.read_text(encoding="utf-8")
    lines = code.splitlines()
    tree = ast.parse(code)

    blocks: list[BlockResult] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            end = _end_line(node)
            chunk = "\n".join(lines[node.lineno - 1 : end])
            cls, ai, human, ai_sig, human_sig = _analyze_code_chunk(
                chunk, classify_signals, ImprovedPythonAnalyzer
            )
            blocks.append(
                BlockResult(
                    kind=type(node).__name__,
                    name=node.name,
                    start=node.lineno,
                    end=end,
                    classification=cls,
                    ai_score=ai,
                    human_score=human,
                    ai_signals=ai_sig,
                    human_signals=human_sig,
                )
            )

    if not blocks:
        cls, ai, human, ai_sig, human_sig = _analyze_code_chunk(
            code, classify_signals, ImprovedPythonAnalyzer
        )
        blocks.append(
            BlockResult(
                kind="Module",
                name="<module>",
                start=1,
                end=len(lines),
                classification=cls,
                ai_score=ai,
                human_score=human,
                ai_signals=ai_sig,
                human_signals=human_sig,
            )
        )

    hits: dict[int, LineHit] = {i: LineHit() for i in range(1, len(lines) + 1)}
    for lineno, line in enumerate(lines, 1):
        for pattern, label, tag in LINE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                hits[lineno].reasons.append(label)
                hits[lineno].tags.add(tag)

    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            if node.value not in MAGIC_SKIP and hasattr(node, "lineno"):
                hits[node.lineno].reasons.append("magic number")
                hits[node.lineno].tags.add("human")

    for lineno, line in enumerate(lines, 1):
        if len(line.rstrip()) > 100:
            hits[lineno].reasons.append("длинная строка")
            hits[lineno].tags.add("human")

    for block in blocks:
        label = f"{block.kind} `{block.name}`"
        for lineno in range(block.start, block.end + 1):
            if lineno in hits:
                hits[lineno].block = label
                hits[lineno].block_class = block.classification

    whole, _, _, _, _ = _analyze_code_chunk(code, classify_signals, ImprovedPythonAnalyzer)
    return lines, blocks, hits, whole


def _code_line_bg(hit: LineHit) -> str:
    if "ai" in hit.tags and "human" in hit.tags:
        return "#fff3cd"
    if "ai" in hit.tags:
        return "#f8d7da"
    if "human" in hit.tags:
        return "#d1e7dd"
    if hit.block_class == AI_LABEL:
        return "#fde2e2"
    if hit.block_class == MIXED_LABEL:
        return "#fff8e1"
    return "transparent"


def _code_icon(classification: str) -> str:
    if classification == AI_LABEL:
        return "AI"
    if classification == HUMAN_LABEL:
        return "Human"
    return "Mixed"


def print_code_report(path: Path, blocks: list[BlockResult], hits: dict[int, LineHit], whole: str) -> None:
    print(f"Тип: код (Codect)")
    print(f"Файл: {path.name}")
    print(f"Вердикт файла: {whole}\n")

    print("=" * 60)
    print("Блоки (функции / классы)")
    print("=" * 60)
    for block in blocks:
        print(
            f"\n[{_code_icon(block.classification)}] {block.kind} `{block.name}` "
            f"(стр. {block.start}-{block.end})"
        )
        print(f"  AI={block.ai_score:.2f}  Human={block.human_score:.2f}  → {block.classification}")
        if block.ai_signals:
            print(f"  AI-сигналы: {', '.join(block.ai_signals)}")
        if block.human_signals:
            print(f"  Human-сигналы: {', '.join(block.human_signals)}")

    ai_blocks = [b for b in blocks if b.classification == AI_LABEL]
    mixed_blocks = [b for b in blocks if b.classification == MIXED_LABEL]
    flagged = [(n, h) for n, h in sorted(hits.items()) if h.reasons]

    print("\n" + "=" * 60)
    print("Подозрительные / характерные строки")
    print("=" * 60)
    if ai_blocks:
        print("\nAI-блоки:")
        for b in ai_blocks:
            print(f"  стр. {b.start}-{b.end}: {b.kind} `{b.name}`")
    if mixed_blocks:
        print("\nMixed-блоки:")
        for b in mixed_blocks:
            print(f"  стр. {b.start}-{b.end}: {b.kind} `{b.name}`")
    if flagged:
        print("\nСтроки с паттернами:")
        for lineno, hit in flagged:
            tags = []
            if "ai" in hit.tags:
                tags.append("AI")
            if "human" in hit.tags:
                tags.append("human")
            tag_str = f" [{', '.join(tags)}]" if tags else ""
            print(f"  стр. {lineno:3d}{tag_str}: {', '.join(hit.reasons)}")
    elif not ai_blocks and not mixed_blocks:
        print("  (нет явных маркеров)")


def render_code_html(path: Path, lines: list[str], blocks: list[BlockResult], hits: dict[int, LineHit], whole: str) -> str:
    block_rows = "".join(
        f"<tr><td>{html.escape(b.kind)}</td><td><code>{html.escape(b.name)}</code></td>"
        f"<td>{b.start}-{b.end}</td><td>{html.escape(b.classification)}</td>"
        f"<td>{b.ai_score:.2f}</td><td>{b.human_score:.2f}</td></tr>"
        for b in blocks
    )
    code_rows = []
    for lineno, line in enumerate(lines, 1):
        hit = hits[lineno]
        reasons = "; ".join(hit.reasons)
        code_rows.append(
            f'<div class="line" style="background:{_code_line_bg(hit)}">'
            f'<span class="ln">{lineno}</span>'
            f'<span class="code">{html.escape(line) if line else " "}</span>'
            f'<span class="note">{html.escape(reasons)}</span></div>'
        )
    return f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>AI check (код) — {html.escape(path.name)}</title>
<style>
body{{font-family:ui-monospace,Menlo,monospace;margin:24px;background:#fafafa}}
h1,h2{{font-family:system-ui,sans-serif;font-size:1.1rem}}
.meta{{font-family:system-ui;color:#444}}
table{{border-collapse:collapse;font-family:system-ui;font-size:14px;margin:16px 0}}
th,td{{border:1px solid #ddd;padding:6px 10px}}
th{{background:#eee}}
.code-block{{background:#fff;border:1px solid #ddd;border-radius:6px}}
.line{{display:grid;grid-template-columns:48px 1fr 180px;gap:8px;padding:0 8px}}
.ln{{color:#888;text-align:right}} .code{{white-space:pre}} .note{{color:#666;font-size:11px;font-family:system-ui}}
</style></head><body>
<h1>Код: {html.escape(path.name)}</h1>
<p class="meta">Codect · <strong>{html.escape(whole)}</strong></p>
<h2>Блоки</h2>
<table><tr><th>Тип</th><th>Имя</th><th>Строки</th><th>Вердикт</th><th>AI</th><th>Human</th></tr>{block_rows}</table>
<h2>Исходник</h2><div class="code-block">{"".join(code_rows)}</div>
</body></html>"""


# --- ru-ai-text-detector (текст) ---------------------------------------------

def _ensure_text_venv() -> None:
    if Path(sys.executable).resolve() == VENV_PY.resolve():
        return
    if not VENV_PY.is_file():
        sys.exit(f"venv не найден: {VENV_PY}\nЗапустите setup.sh в ru-ai-text-detector/")
    os.execv(str(VENV_PY), [str(VENV_PY), str(Path(__file__).resolve()), *sys.argv[1:]])


def _read_prose(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    blocks = [b.strip() for b in raw.split("\n\n") if b.strip()]
    return "\n\n".join(blocks)


def analyze_text(path: Path, model: str):
    os.chdir(DETECTOR)
    sys.path.insert(0, str(DETECTOR))
    sys.path.insert(0, str(DETECTOR / "apps"))

    from detector_tui import HIGHLIGHT_THR, Report, _scan_transformer, render_ansi, report_html, summarize  # noqa: E402
    from aidetector import document_scan as ds  # noqa: E402
    from aidetector import transformer_score as TF  # noqa: E402

    text = _read_prose(path)
    if not text.strip():
        sys.exit("Файл пустой")

    def scan_full(text: str, version: str):
        sc = TF.get(version)
        verdict_thr = sc.threshold()
        paras = ds.split_paragraphs(text)
        split = ds.SectionSplit(content=list(paras), dropped=[])
        stream, spans = ds._build_content_stream(split.content)
        wins = ds.build_windows(stream)
        if wins:
            probs = sc.proba([stream[w.cstart : w.cend] for w in wins])
            for w, p in zip(wins, probs):
                w.p_ai = float(p)
        para_results = ds.project_to_paragraphs(split.content, spans, wins, HIGHLIGHT_THR[version])
        return (
            {
                "threshold": HIGHLIGHT_THR[version],
                "n_paragraphs_total": len(paras),
                "dropped": split.dropped,
                "paragraphs": para_results,
            },
            verdict_thr,
        )

    if path.suffix.lower() in TEXT_EXT:
        res, verdict_thr = scan_full(text, model)
    else:
        res, verdict_thr = _scan_transformer(text, model)

    report = Report(
        path=str(path),
        model_key=model,
        threshold=res["threshold"],
        verdict_threshold=verdict_thr,
        n_total=res["n_paragraphs_total"],
        paragraphs=res["paragraphs"],
        dropped=res["dropped"],
    )
    return report, render_ansi, report_html, summarize


def print_text_report(report, summarize, render_ansi, model: str) -> str:
    print(f"Тип: текст (ru-ai-text-detector, {model})")
    print(render_ansi(report, model))
    print("\n--- Сводка ---")
    for cat, n, chars, share in summarize(report):
        if n or chars:
            print(f"  {cat}: {share:.1%} ({n} абз., {chars} симв.)")

    flagged = [r for r in report.paragraphs if r.label == "подозрительно"]
    uncertain = [r for r in report.paragraphs if r.label == "неопределённо"]

    if flagged:
        print(f"\n--- Подозрительные абзацы ({len(flagged)}) ---")
        for r in sorted(flagged, key=lambda x: -(x.p_ai or 0)):
            print(f"  абз. {r.idx}  p(ИИ)={r.p_ai:.3f}  {r.text[:100]}...")
    else:
        print("\nПодозрительных абзацев нет (p ≥ 0.72).")

    if uncertain:
        print(f"\n--- Зоны внимания ({len(uncertain)}) ---")
        for r in sorted(uncertain, key=lambda x: -(x.p_ai or 0)):
            print(f"  абз. {r.idx}  p(ИИ)={r.p_ai:.3f}  {r.text[:100]}...")


# --- CLI ---------------------------------------------------------------------

def detect_kind(path: Path, forced: str | None) -> str:
    if forced and forced != "auto":
        return forced
    ext = path.suffix.lower()
    if ext in CODE_EXT:
        return "code"
    if ext in TEXT_EXT:
        return "text"
    if forced == "auto" or not forced:
        try:
            ast.parse(path.read_text(encoding="utf-8"))
            return "code"
        except SyntaxError:
            return "text"
    return "text"


def default_html(path: Path, kind: str) -> Path:
    suffix = ".code_report.html" if kind == "code" else ".ai_report.html"
    return path.with_name(path.name + suffix)


def run_code(path: Path, html_path: Path | None) -> Path | None:
    if not CODect_PYTHON.is_dir():
        sys.exit(f"Codect не найден: {CODect_PYTHON}")
    lines, blocks, hits, whole = analyze_code(path)
    print_code_report(path, blocks, hits, whole)
    out = html_path or default_html(path, "code")
    out.write_text(render_code_html(path, lines, blocks, hits, whole), encoding="utf-8")
    print(f"\nHTML: {out.resolve()}")
    return out


def run_text(path: Path, html_path: Path | None, model: str) -> Path | None:
    _ensure_text_venv()
    report, render_ansi, report_html, summarize = analyze_text(path, model)
    print_text_report(report, summarize, render_ansi, model)
    out = html_path or default_html(path, "text")
    out.write_text(report_html(report), encoding="utf-8")
    print(f"\nHTML: {out.resolve()}")
    return out


def analyze_file_json(path: Path, *, forced_type: str | None = None, model: str = "v4") -> dict:
    kind = detect_kind(path, forced_type or "auto")
    ext = path.suffix.lower()
    if kind == "code" and ext == ".py":
        if not CODect_PYTHON.is_dir():
            return {"kind": "code", "error": "codect_missing", "whole": None, "signals": [], "highlights": []}
        lines, blocks, hits, whole = analyze_code(path)
        return _code_json(path, blocks, hits, whole)
    if ext not in TEXT_EXT and ext in {".py", ".js", ".jsx", ".ts", ".tsx", ".go", ".java", ".rs", ".c", ".cpp", ".h"}:
        payload = _heuristic_source_json(path)
        if VENV_PY.is_file():
            try:
                report, _, _, _ = analyze_text(path, model)
                text_payload = _text_json(path, report)
                payload = _merge_payloads(payload, text_payload)
            except Exception as exc:
                if payload["signals"] or payload["highlights"]:
                    payload["warning"] = str(exc).splitlines()[-1][:200]
                else:
                    payload["warning"] = str(exc).splitlines()[-1][:200]
        return payload
    if VENV_PY.is_file():
        try:
            report, _, _, _ = analyze_text(path, model)
            return _text_json(path, report)
        except Exception as exc:
            return {"kind": "text", "error": str(exc), "whole": None, "signals": [], "highlights": []}
    if ext not in TEXT_EXT:
        return _heuristic_source_json(path)
    return {"kind": "text", "error": "text_detector_missing", "whole": None, "signals": [], "highlights": []}


def _merge_payloads(primary: dict, secondary: dict) -> dict:
    seen = {(item["start_line"], item["end_line"]) for item in primary.get("highlights", [])}
    highlights = list(primary.get("highlights", []))
    for item in secondary.get("highlights", []):
        key = (item["start_line"], item["end_line"])
        if key not in seen:
            highlights.append(item)
            seen.add(key)
    signals = list(primary.get("signals", []))
    signals.extend(secondary.get("signals", []))
    scores = [
        float(item.get("ai_score") or 0)
        for item in highlights + signals
        if item.get("ai_score") is not None
    ]
    return {
        "kind": primary.get("kind") or secondary.get("kind"),
        "whole": primary.get("whole") or secondary.get("whole"),
        "ai_score": max(scores) if scores else primary.get("ai_score") or secondary.get("ai_score"),
        "signals": signals,
        "highlights": highlights,
        "warning": primary.get("warning") or secondary.get("warning"),
    }


HEURISTIC_LINE_PATTERNS: list[tuple[str, str, float]] = [
    (r"//.*\b(This function|entry point|responsible for|Initialize and run|HTTP server)\b", "шаблонный AI-комментарий", 0.62),
    (r"//.{55,}", "длинный формальный комментарий", 0.55),
    (r"#.*\b(TODO|FIXME|INSERT|REPLACE|your_|example)\b", "placeholder", 0.58),
    (r"\b(foo|bar|baz|example|sample|demo|tutorial)\b", "generic-имя", 0.5),
]


def _heuristic_source_json(path: Path) -> dict:
    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    highlights: list[dict] = []
    flagged: list[int] = []
    for lineno, line in enumerate(lines, 1):
        reasons: list[str] = []
        score = 0.0
        for pattern, label, weight in HEURISTIC_LINE_PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                reasons.append(label)
                score = max(score, weight)
        if score >= 0.45:
            flagged.append(lineno)
            highlights.append(
                {
                    "kind": "code",
                    "path": path.name,
                    "start_line": lineno,
                    "end_line": lineno,
                    "ai_score": score,
                    "level": _signal_level(MIXED_LABEL, score),
                    "reasons": reasons,
                    "message": "; ".join(reasons) or "Подозрительная строка",
                }
            )
    signals: list[dict] = []
    if flagged:
        start, end = flagged[0], flagged[-1]
        top = max(item["ai_score"] for item in highlights)
        signals.append(
            {
                "kind": "code",
                "path": path.name,
                "block_kind": "Heuristic",
                "block_name": path.name,
                "start_line": start,
                "end_line": end,
                "classification": MIXED_LABEL,
                "ai_score": top,
                "level": _signal_level(MIXED_LABEL, top),
                "message": f"Эвристика: {len(flagged)} подозрительных строк в «{path.name}».",
            }
        )
    return {
        "kind": "code",
        "whole": MIXED_LABEL if flagged else HUMAN_LABEL,
        "signals": signals,
        "highlights": highlights,
    }


def _signal_level(classification: str, ai_score: float) -> str:
    if classification in {AI_LABEL, "подозрительно"} or ai_score >= 0.65:
        return "high"
    if classification in {MIXED_LABEL, "неопределённо"} or ai_score >= 0.45:
        return "medium"
    return "low"


def _code_json(path: Path, blocks: list[BlockResult], hits: dict[int, LineHit], whole: str) -> dict:
    signals: list[dict] = []
    highlights: list[dict] = []
    for block in blocks:
        if block.classification == HUMAN_LABEL:
            continue
        level = _signal_level(block.classification, block.ai_score)
        signals.append(
            {
                "kind": "code",
                "path": path.name,
                "block_kind": block.kind,
                "block_name": block.name,
                "start_line": block.start,
                "end_line": block.end,
                "classification": block.classification,
                "ai_score": block.ai_score,
                "human_score": block.human_score,
                "level": level,
                "message": f"Фрагмент «{block.name}» (стр. {block.start}-{block.end}) похож на код, сгенерированный ИИ.",
            }
        )
    flagged_lines: set[int] = set()
    for block in blocks:
        if block.classification != HUMAN_LABEL:
            flagged_lines.update(range(block.start, block.end + 1))
    for lineno, hit in hits.items():
        suspicious = lineno in flagged_lines or "ai" in hit.tags or hit.block_class in {AI_LABEL, MIXED_LABEL}
        if not suspicious:
            continue
        ai_score = next((b.ai_score for b in blocks if b.start <= lineno <= b.end), 0.0)
        highlights.append(
            {
                "kind": "code",
                "path": path.name,
                "start_line": lineno,
                "end_line": lineno,
                "ai_score": ai_score,
                "level": _signal_level(hit.block_class or AI_LABEL, ai_score),
                "reasons": hit.reasons,
                "message": "; ".join(hit.reasons) or hit.block_class or "Подозрительная строка",
            }
        )
    if whole != HUMAN_LABEL and not signals:
        max_ai = max((b.ai_score for b in blocks), default=0.0)
        signals.append(
            {
                "kind": "code",
                "path": path.name,
                "block_kind": "File",
                "block_name": path.name,
                "start_line": 1,
                "end_line": max(1, len(hits)),
                "classification": whole,
                "ai_score": max_ai,
                "human_score": min((b.human_score for b in blocks), default=0.0),
                "level": _signal_level(whole, max_ai),
                "message": f"Файл «{path.name}» содержит признаки кода, сгенерированного ИИ.",
            }
        )
    return {"kind": "code", "whole": whole, "signals": signals, "highlights": highlights}


def _paragraph_line_range(content: str, para_text: str, para_idx: int) -> tuple[int, int]:
    needle = (para_text or "").strip().split("\n")[0][:80]
    if needle:
        pos = content.find(needle)
        if pos >= 0:
            start = content[:pos].count("\n") + 1
            end = start + max(0, (para_text or "").count("\n"))
            return start, end
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", content) if part.strip()]
    if 1 <= para_idx <= len(paragraphs):
        block = paragraphs[para_idx - 1]
        pos = content.find(block[: min(len(block), 80)])
        if pos >= 0:
            start = content[:pos].count("\n") + 1
            end = start + block.count("\n")
            return start, end
    return para_idx, para_idx


def _text_json(path: Path, report) -> dict:
    content = path.read_text(encoding="utf-8", errors="replace")
    code_file = path.suffix.lower() in {".go", ".js", ".jsx", ".ts", ".tsx", ".java", ".rs", ".c", ".cpp", ".h", ".py"}
    signals: list[dict] = []
    highlights: list[dict] = []
    for para in report.paragraphs:
        if para.label not in {"подозрительно", "неопределённо"}:
            continue
        ai_score = float(para.p_ai or 0)
        level = _signal_level(para.label, ai_score)
        start_line, end_line = _paragraph_line_range(content, para.text, para.idx)
        kind = "code" if code_file else "text"
        signals.append(
            {
                "kind": kind,
                "path": path.name,
                "block_kind": "Paragraph",
                "block_name": f"абзац {para.idx}",
                "start_line": start_line,
                "end_line": end_line,
                "classification": para.label,
                "ai_score": ai_score,
                "level": level,
                "message": f"Строки {start_line}-{end_line}: p(ИИ)={ai_score:.2f} · {para.text[:120]}",
            }
        )
        for lineno in range(start_line, end_line + 1):
            highlights.append(
                {
                    "kind": kind,
                    "path": path.name,
                    "start_line": lineno,
                    "end_line": lineno,
                    "ai_score": ai_score,
                    "level": level,
                    "message": para.text[:160],
                }
            )
    overall = max((float(p.p_ai or 0) for p in report.paragraphs), default=0.0)
    return {
        "kind": "code" if code_file else "text",
        "whole": "подозрительно" if overall >= 0.72 else ("неопределённо" if overall >= 0.45 else "человек"),
        "ai_score": overall if highlights else None,
        "signals": signals,
        "highlights": highlights,
    }


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Проверка кода (Codect) и текста (ru-ai-text-detector) с подсветкой фрагментов"
    )
    ap.add_argument("file", type=Path, help="файл для проверки")
    ap.add_argument(
        "--type",
        choices=["auto", "code", "text"],
        default="auto",
        help="тип: auto по расширению, code или text",
    )
    ap.add_argument("--model", choices=["v1", "v2", "v3", "v4"], default="v4", help="модель для текста")
    ap.add_argument("--html", type=Path, help="путь для HTML-отчёта")
    ap.add_argument("--json", action="store_true", help="вывести JSON для интеграции в платформу")
    args = ap.parse_args()

    path = args.file.resolve()
    if not path.is_file():
        sys.exit(f"Файл не найден: {path}")

    if args.json:
        import json as _json

        print(_json.dumps(analyze_file_json(path, forced_type=args.type, model=args.model), ensure_ascii=False))
        return

    kind = detect_kind(path, args.type)
    if kind == "code":
        run_code(path, args.html)
    else:
        run_text(path, args.html, args.model)


if __name__ == "__main__":
    main()
