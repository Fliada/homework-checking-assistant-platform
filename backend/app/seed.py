import json
import os
import secrets
from datetime import timedelta
from pathlib import Path
from sqlalchemy import select
from .auth import hash_password
from .config import settings
from .models import *

TASK_TYPES = ['artifact_triage', 'criterion_evaluation', 'annotation_generation', 'integrity_reasoning', 'review_critic', 'feedback_compose']

def initialize(db):
    owner = db.scalar(select(User).where(User.role == 'owner'))
    if owner is None and settings.owner_email and settings.owner_password:
        if len(settings.owner_password) < 12:
            raise RuntimeError('OWNER_PASSWORD must contain at least 12 characters')
        existing = db.scalar(select(User).where(User.email == settings.owner_email.lower()))
        if existing:
            raise RuntimeError('OWNER_EMAIL already belongs to a non-owner account')
        owner = User(id='owner', name=os.getenv('OWNER_NAME', 'Владелец платформы'), email=settings.owner_email.lower(), password_hash=hash_password(settings.owner_password), role='owner')
        db.add(owner)
        db.flush()
    if not db.get(PlatformSetting, 'global'):
        db.add(PlatformSetting(id='global', values={'maxFileMb': 10, 'maxFiles': 100, 'maxReviewTokens': 16000, 'mode': settings.app_env}))
    if not settings.seed_demo:
        db.commit()
        return
    names = {'student': 'Артём Волков', 'reviewer': 'Мария Смирнова', 'coordinator': 'Анна Белова', 'expert': 'Дмитрий Соколов', 'admin': 'Алексей Петров', 'moderator': 'Ольга Орлова', 'pending': 'Новый сотрудник'}
    for role, name in names.items():
        if not db.get(User, f'demo-{role}'):
            db.add(User(id=f'demo-{role}', name=name, email=f'{role}@demo.local', password_hash=hash_password(secrets.token_urlsafe(32)), role=role, course_ids=['go'], account_type='student' if role == 'student' else 'employee'))
    for i, name in enumerate(['Екатерина Новикова', 'Илья Морозов', 'София Кузнецова', 'Михаил Егоров'], 2):
        if not db.get(User, f'demo-student-{i}'):
            db.add(User(id=f'demo-student-{i}', name=name, email=f'student{i}@demo.local', password_hash=hash_password(secrets.token_urlsafe(32)), role='student', course_ids=['go'], account_type='student'))
    if not db.get(User, 'demo-reviewer-2'):
        db.add(User(id='demo-reviewer-2', name='Павел Крылов', email='reviewer2@demo.local', password_hash=hash_password(secrets.token_urlsafe(32)), role='reviewer', course_ids=['go'], capacity=240))
    db.flush()
    if not db.get(Course, 'go'):
        db.add(Course(id='go', title='Go: разработка микросервисов', run='Осень 2026 · поток 1', owner_expert_id='demo-expert'))
    if not db.get(ModelEndpoint, 'openai-default'):
        # Keep the original registry ID so existing assignment bindings remain valid.
        db.add(ModelEndpoint(id='openai-default', name='Gemma · Google AI Studio', provider='gemini', group='balanced', base_url='https://generativelanguage.googleapis.com/v1beta', model_name=os.getenv('GEMMA_MODEL', 'gemma-4-31b-it'), api_key_env='GEMINI_API_KEY', default_params={'temperature': .2, 'max_output_tokens': 4000, 'timeout_seconds': 90, 'max_retries': 2}, capabilities={'json_schema': False, 'json_mode': False, 'max_context_tokens': 32000}))
    db.flush()
    for n in range(1, 4):
        fixture = json.loads((Path(__file__).parents[1] / 'fixtures' / f'go-task-{n}.json').read_text())
        aid = fixture['id']
        if db.get(Assignment, aid):
            continue
        refs = [{**r, 'id': uid(), 'type': r['level'], 'name': r['path'].split('/')[-1], 'url': f"https://github.com/{r['repository']}/tree/{r['ref']}/{r['path']}"} for r in fixture['references']]
        db.add(Assignment(id=aid, course_id='go', code=f'ДЗ {n}', title=fixture['title'], task_text=fixture['task_text'], due_at=(now() + timedelta(days=n*4)).isoformat(), review_due_at=(now() + timedelta(days=n*4+3)).isoformat(), references=refs, late_policy={'enabled': False, 'type': 'fixed', 'value': 0, 'intervalDays': 1}))
        db.flush()
        db.add(Rubric(id=f'{aid}-rubric-1', assignment_id=aid, version=1, status='published', criteria=fixture['criteria'], published_at=now()))
        db.add(AgentConfig(id=f'{aid}-config-1', assignment_id=aid, version=1, status='published', created_by='demo-expert', published_at=now(), tasks={task: {'model_id': 'openai-default', 'prompt_template': f'Выполни задачу {task}. Оценивай только текущий критерий задания. Используй существующие source anchors. При нехватке оснований откажись от оценки.', 'params': {'temperature': .2, 'top_p': .9, 'max_output_tokens': 4000}} for task in TASK_TYPES}))
    db.flush()
    # These fixtures are synthetic and contain no measured model outputs.
    if not db.get(Submission, 'demo-submission-1'):
        for i in range(1, 6):
            sid = f'demo-submission-{i}'
            student = 'demo-student' if i == 1 else f'demo-student-{i}'
            aid = 'go-task-1' if i < 5 else 'go-task-2'
            artifact_id = f'demo-artifact-{i}'
            content = 'package main\n\nimport (\n    "encoding/json"\n    "net/http"\n    "log"\n)\n\nfunc main() {\n    http.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {\n        w.Header().Set("Content-Type", "application/json")\n        json.NewEncoder(w).Encode(map[string]string{"message": "pong"})\n    })\n    log.Fatal(http.ListenAndServe(":8080", nil))\n}\n'
            artifacts = [{'id': artifact_id, 'path': 'cmd/main.go', 'media_type': 'text/plain', 'parse_status': 'parsed', 'public': True, 'content': content, 'segments': [{'id': f'{artifact_id}-{j}', 'path': 'cmd/main.go', 'anchor': f'line:{j}', 'text': line} for j, line in enumerate(content.splitlines(), 1)]}]
            db.add(Submission(id=sid, assignment_id=aid, student_id=student, external_ref='https://github.com/ai-talent-hub-avito/homework_examples/pull/1', submitted_at=now()-timedelta(hours=i*9), status='needs_human', artifacts=artifacts, public_data=True, git_metadata={'demo': True, 'head_sha': 'synthetic'}, error='Демонстрационная работа. Автоматическая оценка ещё не запускалась.'))
            db.flush()
            rubric = db.get(Rubric, f'{aid}-rubric-1')
            db.add(Review(id=f'demo-review-{i}', submission_id=sid, reviewer_id='demo-reviewer' if i < 4 else 'demo-reviewer-2', rubric_id=rubric.id, agent_config_version_id=f'{aid}-config-1', status='needs_human', criterion_results=[{'criterion_id': c['id'], 'suggested_score': None, 'final_score': None, 'confidence': 0, 'abstained': True, 'reason': 'Ожидает проверки по рубрике', 'confirmed': False, 'note': ''} for c in rubric.criteria]))
        db.add(Notification(user_id='demo-reviewer', title='Работы ждут проверки', message='В вашей очереди три демонстрационные работы.', link='/ledger'))
    db.commit()
