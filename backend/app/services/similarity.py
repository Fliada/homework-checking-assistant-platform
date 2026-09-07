"""Run JPlag against stored source snapshots, without executing student code."""
import hashlib
import json
import os
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
LANGUAGES = {'go': ['.go'], 'python3': ['.py'], 'java': ['.java'], 'cpp': ['.cpp', '.cc', '.c', '.h', '.hpp'],
             'javascript': ['.js', '.jsx'], 'typescript': ['.ts', '.tsx'], 'csharp': ['.cs'], 'kotlin': ['.kt']}
MAX_INPUT_BYTES = 100_000_000
MAX_REPORT_BYTES = 150_000_000


class SimilarityError(Exception):
    pass


def runtime():
    jar = Path(os.getenv('JPLAG_JAR', str(ROOT / 'vendor' / 'jplag.jar')))
    java = os.getenv('JPLAG_JAVA') or next((str(p) for p in (ROOT / 'vendor' / 'java').glob('**/bin/java')), None)
    if not java or not jar.is_file():
        raise SimilarityError('JPlag не установлен. Выполните npm run setup:jplag в папке репозитория.')
    return str(Path(java).resolve()), jar


def source_files(submission, language):
    files = {}
    for artifact in submission.artifacts:
        path = PurePosixPath(artifact.get('path', ''))
        if path.is_absolute() or '..' in path.parts or '\\' in str(path) or '\x00' in str(path): continue
        if path.suffix.lower() not in LANGUAGES[language]: continue
        content = artifact.get('content')
        if not isinstance(content, str) or not content.strip(): continue
        files[str(path)] = content
    return files


def parse_report(path, sources):
    pairs = []; overview = {}
    with zipfile.ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > MAX_REPORT_BYTES:
            raise SimilarityError('Отчёт JPlag слишком большой. Уменьшите число файлов в работах.')
        for entry in archive.infolist():
            if entry.filename == 'overview.json': overview = json.loads(archive.read(entry))
            if not entry.filename.startswith('comparisons/') or not entry.filename.endswith('.json'): continue
            data = json.loads(archive.read(entry))
            left = data.get('first_submission_id', data.get('firstSubmissionId'))
            right = data.get('second_submission_id', data.get('secondSubmissionId'))
            if left not in sources or right not in sources: continue
            def field(obj, snake, camel): return obj.get(snake, obj.get(camel))
            matches = []
            for match in data.get('matches', [])[:100]:
                sides = []
                for sid, name in [(left, 'first'), (right, 'second')]:
                    filepath = field(match, f'{name}_file_name', f'{name}FileName') or ''
                    # JPlag paths are relative to the submission root and may include its ID.
                    candidates = [filepath, str(PurePosixPath(filepath).relative_to(sid)) if filepath.startswith(sid + '/') else filepath]
                    relative = next((p for p in candidates if p in sources[sid]), None)
                    if relative is None: break
                    start = field(match, f'start_in_{name}', f'startIn{name.title()}') or {}
                    end = field(match, f'end_in_{name}', f'endIn{name.title()}') or {}
                    lines = sources[sid][relative].splitlines()
                    first = max(1, int(start.get('line', 1))); last = min(len(lines), int(end.get('line', first)))
                    if last < first: break
                    sides.append({'path': relative, 'start': first, 'end': last,
                                  'code': '\n'.join(lines[first - 1:min(last, first + 199)])[:30000],
                                  'truncated': last - first >= 200})
                if len(sides) == 2: matches.append({'left': sides[0], 'right': sides[1]})
            similarity = data.get('similarities', {})
            pairs.append({'id': hashlib.sha256('|'.join(sorted([left, right])).encode()).hexdigest()[:24],
                          'leftId': left, 'rightId': right,
                          'averagePercent': round(float(similarity.get('AVG', 0)) * 100, 1),
                          'maxPercent': round(float(similarity.get('MAX', 0)) * 100, 1),
                          'matches': matches, 'matchCount': len(data.get('matches', [])),
                          'matchesTruncated': len(data.get('matches', [])) > len(matches)})
    return {'pairs': sorted(pairs, key=lambda p: -p['averagePercent']), 'overview': overview}


def compare(submissions, language):
    if language not in LANGUAGES: raise SimilarityError('Этот язык пока не поддерживается.')
    java, jar = runtime()
    sources = {s.id: source_files(s, language) for s in submissions}
    excluded = [sid for sid, files in sources.items() if not files]
    sources = {sid: files for sid, files in sources.items() if files}
    if len(sources) < 2:
        raise SimilarityError('Для сравнения нужны минимум две работы разных студентов с исходным кодом выбранного языка.')
    if len(sources) > 200 or sum(len(text.encode()) for files in sources.values() for text in files.values()) > MAX_INPUT_BYTES:
        raise SimilarityError('Превышен лимит JPlag: 200 решений или 100 МБ исходников на запуск.')
    root = Path(os.getenv('JPLAG_DATA_ROOT', str(ROOT / 'similarity-data')))
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='run-', dir=root) as directory:
        work = Path(directory); inputs = work / 'inputs'; inputs.mkdir()
        for sid, files in sources.items():
            if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', sid): raise SimilarityError('Некорректный идентификатор работы.')
            for path, content in files.items():
                target = inputs / sid / path; target.parent.mkdir(parents=True, exist_ok=True); target.write_text(content)
        report = work / 'report.jplag'
        command = [java, '-Xmx1g', '-XX:ActiveProcessorCount=2', '-jar', str(jar.resolve()),
                   '-M', 'RUN', '-l', language, '-n', '-1', '-r', str(report), str(inputs)]
        try:
            with (work / 'engine.log').open('wb') as log:
                result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, cwd=work,
                                        timeout=max(10, min(600, int(os.getenv('JPLAG_TIMEOUT_SECONDS', '120')))), check=False)
        except subprocess.TimeoutExpired:
            raise SimilarityError('JPlag не успел завершить сравнение. Увеличьте JPLAG_TIMEOUT_SECONDS или сократите объём работ.') from None
        except OSError:
            raise SimilarityError('Java для JPlag не запускается. Проверьте npm run setup:jplag и JPLAG_JAVA.') from None
        if result.returncode or not report.is_file():
            raise SimilarityError('JPlag не смог сравнить исходники. Проверьте выбранный язык: нужны две синтаксически корректные работы достаточной длины.')
        parsed = parse_report(report, sources)
        overview = parsed.pop('overview')
        parsed.update({'engine': 'JPlag 6.3.0', 'excludedIds': excluded,
                       'parsedSubmissionCount': overview.get('total_valid_submissions', overview.get('totalValidSubmissions', len(sources))),
                       'failedSubmissions': overview.get('failed_submission_names', overview.get('failedSubmissionNames', [])),
                       'submissions': [{'id': s.id, 'studentId': s.student_id,
                                        'files': len(sources.get(s.id, {})), 'headSha': s.git_metadata.get('head_sha', ''),
                                        'partial': s.git_metadata.get('snapshot_complete') is not True,
                                        'demo': bool(s.git_metadata.get('demo')),
                                        'digest': hashlib.sha256(json.dumps(sources.get(s.id, {}), sort_keys=True).encode()).hexdigest()}
                                       for s in submissions]})
        return parsed


def process_similarity(db, job):
    from ..models import SimilarityRun, Submission
    run = db.get(SimilarityRun, job.entity_id)
    run.status = 'running'; run.error = None; db.commit()
    try:
        submissions = [db.get(Submission, sid) for sid in run.submission_ids]
        if any(s is None for s in submissions): raise SimilarityError('Исходная работа больше недоступна. Запустите новое сравнение.')
        run.results = compare(submissions, run.language)
        run.status = 'completed'
    except SimilarityError as exc:
        run.status = 'failed'; run.error = str(exc)
    db.commit()
