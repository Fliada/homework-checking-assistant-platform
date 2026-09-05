import copy
import hashlib
import hmac
import json
import os
import re
from contextlib import asynccontextmanager
from datetime import timezone
from urllib.parse import quote, urlparse
from fastapi import BackgroundTasks, Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .auth import *
from .config import settings
from .db import Base, engine, get_db, SessionLocal
from .models import *
from .serializers import *
from .seed import initialize, TASK_TYPES
from .jobs import enqueue, dispatch, resume_pending
from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from pathlib import Path

@asynccontextmanager
async def lifespan(app):
    if len(settings.jwt_secret) < 32:
        raise RuntimeError('JWT_SECRET must be configured with at least 32 characters in .env')
    Base.metadata.create_all(engine)
    backend_root = Path(__file__).resolve().parents[1]
    migration_config = AlembicConfig(str(backend_root / 'alembic.ini'))
    migration_config.set_main_option('script_location', str(backend_root / 'alembic'))
    alembic_command.upgrade(migration_config, 'head')
    with SessionLocal() as db: initialize(db)
    if settings.job_mode == 'local': resume_pending()
    yield

app = FastAPI(title='Avito AI Reviewer API', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False, allow_methods=['*'], allow_headers=['*'])
P = '/api/v1'

@app.exception_handler(HTTPException)
async def http_error(request, exc):
    detail = exc.detail if isinstance(exc.detail, dict) else {'code': 'request_error', 'message': str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={**detail, 'status': exc.status_code}, media_type='application/problem+json')

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(status_code=422, content={'code': 'validation_error', 'message': 'Проверьте обязательные поля запроса.', 'details': [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in exc.errors()]}, media_type='application/problem+json')

@app.exception_handler(IntegrityError)
async def conflict_error(request, exc):
    return JSONResponse(status_code=409, content={'code': 'conflict', 'message': 'Данные уже изменены или существуют. Обновите страницу.'}, media_type='application/problem+json')

@app.get('/health')
@app.get(P+'/health')
def health():
    return {'status': 'ok', 'debug': settings.debug and settings.seed_demo, 'mode': settings.app_env, 'integrity': 'mock'}

def audit(db, actor, action, entity, entity_id, payload=None):
    db.add(AuditEvent(actor_id=actor.id if actor else None, action=action, entity_type=entity, entity_id=entity_id, payload_safe=payload or {}))

def get(db, model, entity_id):
    value = db.get(model, entity_id)
    if value is None: fail(404, 'not_found', 'Объект не найден.')
    return value

def assignment_scope(db, user, assignment, write=False):
    if user.role in ADMIN: return
    if assignment.course_id not in (user.course_ids or []): fail(403, 'course_scope_forbidden', 'Курс не назначен вашему аккаунту.')
    if user.role == 'expert':
        if db.get(Course, assignment.course_id).owner_expert_id == user.id: return
        fail(403, 'scope_forbidden', 'Задание принадлежит другому эксперту.')
    if write:
        require(user, {'coordinator'})
    else:
        require(user, {'student', 'reviewer', 'coordinator', 'moderator'})

def review_scope(db, user, review, write=False):
    if user.role in ADMIN: return
    submission = get(db, Submission, review.submission_id)
    assignment_scope(db,user,get(db,Assignment,submission.assignment_id))
    if user.role == 'reviewer' and review.reviewer_id == user.id: return
    if not write and user.role == 'student' and submission.student_id == user.id and review.status == 'confirmed': return
    if not write and user.role in {'coordinator', 'moderator'}: return
    if not write and user.role == 'expert':
        assignment_scope(db, user, get(db, Assignment, submission.assignment_id))
        return
    fail(403, 'scope_forbidden', 'У вас нет доступа к этой проверке.')

def edit_review(db, user, rid):
    review = db.scalar(select(Review).where(Review.id == rid).with_for_update())
    if not review: fail(404, 'not_found', 'Проверка не найдена.')
    review_scope(db, user, review, True)
    if review.status in ['confirmed','superseded']: fail(409, 'review_locked', 'Подтверждённая проверка неизменяема.')
    if review.status in ['ingesting', 'pre_review_running', 'submitted']: fail(409, 'review_busy', 'Дождитесь завершения обработки.')
    return review

def changed(review):
    review.revision += 1
    review.status = 'in_review'

def idempotent(db, request, user, body):
    key = request.headers.get('Idempotency-Key')
    if not key or len(key) > 200: fail(400, 'idempotency_required', 'Требуется заголовок Idempotency-Key.')
    scope = f'{user.id if user else "github"}:{request.url.path}:{key}'
    pk = hashlib.sha256(scope.encode()).hexdigest()
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    old = db.get(Idempotency, pk)
    if old and old.fingerprint != fingerprint: fail(409, 'idempotency_conflict', 'Этот ключ уже использован для другого запроса.')
    return pk, fingerprint, old.response if old else None

def remember(db, key, fingerprint, response): db.add(Idempotency(id=key, fingerprint=fingerprint, response=response))

def password_valid(value):
    if not isinstance(value, str) or len(value) < 10 or len(value) > 256: fail(422, 'invalid_password', 'Пароль должен содержать от 10 до 256 символов.')

def text_field(body, name, minimum=1, maximum=1000):
    value = body.get(name)
    if not isinstance(value, str) or not minimum <= len(value.strip()) <= maximum: fail(422, 'invalid_field', f'Проверьте поле {name}.')
    return value.strip()

@app.post(P+'/auth/register/{kind}', status_code=201)
def register(kind: str, body: dict, db: Session = Depends(get_db)):
    if kind not in ['student', 'employee']: fail(404, 'not_found', 'Неизвестный тип аккаунта.')
    email = text_field(body, 'email', maximum=254).lower()
    if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email): fail(422, 'invalid_email', 'Введите корректный email.')
    password_valid(body.get('password'))
    if db.scalar(select(User).where(User.email == email)): fail(409, 'email_exists', 'Этот email уже зарегистрирован.')
    user = User(name=text_field(body, 'name', maximum=150), email=email, password_hash=hash_password(body['password']), account_type=kind, role='student' if kind == 'student' else 'pending')
    db.add(user); db.flush()
    audit(db, user, 'user.registered', 'user', user.id)
    tokens = issue_tokens(db, user)
    db.commit()
    return {**tokens, 'user': user_json(user)}

@app.post(P+'/auth/login')
def login(body: dict, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == str(body.get('email', '')).lower().strip()))
    if not user or not user.active or not check_password(str(body.get('password', '')), user.password_hash): fail(401, 'invalid_credentials', 'Неверный email или пароль.')
    tokens = issue_tokens(db, user); db.commit()
    return {**tokens, 'user': user_json(user)}

@app.post(P+'/auth/debug')
def debug_login(body: dict, db: Session = Depends(get_db)):
    if not settings.debug or not settings.seed_demo: fail(404, 'not_found', 'Режим недоступен.')
    role = body.get('role')
    user = db.scalar(select(User).where(User.role == 'owner')) if role == 'owner' else db.get(User, f'demo-{role}')
    if not user: fail(404, 'not_found', 'Демонстрационный аккаунт недоступен.')
    tokens = issue_tokens(db, user); db.commit()
    return {**tokens, 'user': user_json(user)}

@app.post(P+'/auth/refresh')
def refresh(body: dict, db: Session = Depends(get_db)):
    claims = decode_token(body.get('refreshToken', ''), 'refresh')
    sid = hashlib.sha256(claims['jti'].encode()).hexdigest()
    session = db.scalar(select(RefreshSession).where(RefreshSession.id == sid).with_for_update())
    if not session or session.revoked: fail(401, 'invalid_token', 'Сессия завершена.')
    count = db.execute(update(RefreshSession).where(RefreshSession.id == sid, RefreshSession.revoked == False).values(revoked=True)).rowcount
    if count != 1: fail(401, 'invalid_token', 'Сессия завершена.')
    user = get(db, User, claims['sub'])
    if not user.active: fail(401, 'unauthorized', 'Аккаунт недоступен.')
    tokens = issue_tokens(db, user); db.commit()
    return {**tokens, 'user': user_json(user)}

@app.post(P+'/auth/logout')
def logout(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    claims = decode_token(body.get('refreshToken', ''), 'refresh')
    if claims['sub'] != user.id: fail(403, 'forbidden', 'Сессия принадлежит другому пользователю.')
    session = db.get(RefreshSession, hashlib.sha256(claims['jti'].encode()).hexdigest())
    if session: session.revoked = True
    db.commit(); return {'ok': True}

@app.get(P+'/me')
def me(user: User = Depends(current_user)): return user_json(user)

@app.get(P+'/bootstrap')
def bootstrap(user: User = Depends(current_user), db: Session = Depends(get_db)):
    all_assignments = db.scalars(select(Assignment)).all()
    if user.role not in ADMIN: all_assignments = [a for a in all_assignments if a.course_id in (user.course_ids or [])]
    if user.role == 'expert': all_assignments = [a for a in all_assignments if db.get(Course, a.course_id).owner_expert_id == user.id]
    if user.role == 'pending': all_assignments = []
    aid = {a.id for a in all_assignments}
    courses = [c for c in db.scalars(select(Course)).all() if user.role in ADMIN or (c.id in (user.course_ids or []) and (user.role != 'expert' or c.owner_expert_id == user.id))]
    if user.role == 'pending': courses = []
    submissions = [s for s in db.scalars(select(Submission).order_by(Submission.submitted_at.desc())).all() if s.assignment_id in aid]
    reviews = db.scalars(select(Review).order_by(Review.created_at.desc())).all()
    if user.role == 'student': submissions = [s for s in submissions if s.student_id == user.id]
    if user.role == 'reviewer': submissions = [s for s in submissions if any(r.submission_id == s.id and r.reviewer_id == user.id for r in reviews)]
    sids = {s.id for s in submissions}
    reviews = [r for r in reviews if r.status != 'superseded' and r.submission_id in sids and (user.role != 'reviewer' or r.reviewer_id == user.id) and (user.role != 'student' or r.status == 'confirmed')]
    visible_users = {user.id} | {s.student_id for s in submissions} | {r.reviewer_id for r in reviews}
    users = db.scalars(select(User)).all()
    if user.role == 'coordinator': users = [u for u in users if u.id == user.id or set(u.course_ids or []) & set(user.course_ids or [])]
    elif user.role not in ADMIN: users = [u for u in users if u.id in visible_users]
    private = user.role in ADMIN | {'expert'}
    models = db.scalars(select(ModelEndpoint)).all() if private else []
    if user.role == 'expert': models = [m for m in models if m.enabled]
    configs = db.scalars(select(AgentConfig).where(AgentConfig.assignment_id.in_(aid))).all() if private and aid else []
    evals = db.scalars(select(EvalRun).where(EvalRun.assignment_id.in_(aid)).order_by(EvalRun.created_at.desc())).all() if private and aid else []
    notices = db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())).all()
    audits = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(100)).all() if user.role in ADMIN else []
    flags = db.scalars(select(RubricFlag).where(RubricFlag.assignment_id.in_(aid))).all() if private and aid else []
    return {'user': user_json(user, [c.id for c in courses]), 'users': [user_json(u, [c.id for c in courses]) for u in users], 'courses': [course_json(c) for c in courses], 'assignments': [assignment_json(db,a,private) for a in all_assignments], 'submissions': [submission_json(db,s,user.role != 'moderator') for s in submissions], 'reviews': [review_json(db,r,user.role == 'student') for r in reviews], 'models': [model_json(m,user.role in ADMIN) for m in models], 'configs': [config_json(c) for c in configs], 'evals': [eval_json(db,e) for e in evals], 'notifications': [{'id': n.id, 'userId': n.user_id, 'title': n.title, 'message': n.message, 'read': n.read, 'createdAt': iso(n.created_at), 'href': n.link} for n in notices], 'audit': [{'id': a.id, 'actorId': a.actor_id, 'action': a.action, 'entityId': a.entity_id, 'createdAt': iso(a.created_at)} for a in audits], 'flags': [{'id': f.id, 'assignmentId': f.assignment_id, 'criterionId': '', 'message': f.message, 'status': f.status, 'createdAt': ''} for f in flags], 'settings': get(db,PlatformSetting,'global').values, 'debug': settings.debug and settings.seed_demo}

@app.get(P+'/admin/employees')
def employees(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN)
    return [user_json(u) for u in db.scalars(select(User).where(User.account_type == 'employee')).all()]

@app.patch(P+'/admin/employees/{user_id}/roles')
def assign_role(user_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN)
    target = get(db, User, user_id)
    role = body.get('role')
    if role not in ROLES or role == 'owner': fail(422, 'invalid_role', 'Выберите одну допустимую роль.')
    if target.role == 'owner': fail(403, 'owner_protected', 'Роль Owner задаётся при запуске.')
    if target.account_type == 'student' and role != 'student': fail(403, 'student_role', 'Тип студенческого аккаунта менять нельзя.')
    if target.account_type != 'student' and role == 'student': fail(422, 'invalid_role', 'Выберите роль сотрудника.')
    if (role == 'admin' or target.role == 'admin') and user.role != 'owner': fail(403, 'owner_required', 'Только Owner назначает и снимает Admin.')
    if 'courseIds' in body: target.course_ids=validate_course_ids(db,body['courseIds'])
    old = target.role; target.role = role
    audit(db, user, 'employee.role_changed', 'user', target.id, {'before': old, 'after': role})
    db.add(Notification(user_id=target.id, title='Роль обновлена', message=f'Вам назначена роль {role}.'))
    db.commit(); return user_json(target)


def validate_course_ids(db,values):
    if not isinstance(values,list) or len(values)>100 or any(not isinstance(v,str) for v in values): fail(422,'invalid_scope','Передайте список курсов.')
    values=list(dict.fromkeys(values))
    for cid in values: get(db,Course,cid)
    return values

@app.patch(P+'/admin/users/{user_id}/scope')
def user_scope(user_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN); target=get(db,User,user_id)
    target.course_ids=validate_course_ids(db,body.get('courseIds',[]))
    audit(db,user,'user.scope_updated','user',target.id,{'courseIds':target.course_ids}); db.commit(); return user_json(target)

@app.post(P+'/owner/admins/{user_id}')
def grant_admin(user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, {'owner'}); return assign_role(user_id, {'role': 'admin'}, user, db)

@app.delete(P+'/owner/admins/{user_id}')
def revoke_admin(user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, {'owner'}); return assign_role(user_id, {'role': 'pending'}, user, db)

@app.post(P+'/courses', status_code=201)
def create_course(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN | {'coordinator', 'expert'})
    expert_id = user.id if user.role == 'expert' else body.get('expertId')
    if expert_id and get(db, User, expert_id).role not in {'expert', 'admin', 'owner'}: fail(422, 'invalid_expert', 'Назначьте владельцем эксперта.')
    course = Course(title=text_field(body, 'title', maximum=200), run=body.get('run', '2026'), owner_expert_id=expert_id)
    db.add(course); db.flush()
    if user.role not in ADMIN: user.course_ids=list(set([*(user.course_ids or []),course.id]))
    if expert_id:
        expert=get(db,User,expert_id); expert.course_ids=list(set([*(expert.course_ids or []),course.id]))
    audit(db, user, 'course.created', 'course', course.id); db.commit()
    return course_json(course)

@app.patch(P+'/courses/{course_id}')
def patch_course(course_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN | {'coordinator'})
    course = get(db, Course, course_id)
    if user.role not in ADMIN and course.id not in (user.course_ids or []): fail(403,'scope_forbidden','Курс не назначен вашему аккаунту.')
    for field in ['title', 'run', 'status']:
        if field in body: setattr(course, field, text_field(body, field, maximum=200))
    if 'expertId' in body:
        expert = get(db, User, body['expertId'])
        require(expert, ADMIN | {'expert'}); course.owner_expert_id = expert.id; expert.course_ids=list(set([*(expert.course_ids or []),course.id]))
    audit(db, user, 'course.updated', 'course', course.id); db.commit(); return course_json(course)

def fill_assignment(a, body):
    fields = {'title':'title', 'code':'code', 'taskText':'task_text', 'dueAt':'due_at', 'reviewDueAt':'review_due_at'}
    for incoming, field in fields.items():
        if incoming in body:
            value = body[incoming]
            if not isinstance(value, str) or len(value) > (100000 if incoming == 'taskText' else 1000): fail(422,'invalid_field',f'Проверьте поле {incoming}.')
            if incoming in ('dueAt', 'reviewDueAt') and value:
                try: datetime.fromisoformat(value.replace('Z', '+00:00'))
                except ValueError: fail(422, 'invalid_date', 'Некорректная дата.')
            setattr(a, field, value)
    if 'estimatedMinutes' in body:
        value = body['estimatedMinutes']
        if not isinstance(value, int) or not 1 <= value <= 1000: fail(422, 'invalid_estimate', 'Оценка времени: 1–1000 минут.')
        a.estimated_minutes = value

@app.post(P+'/courses/{course_id}/assignments', status_code=201)
def create_assignment(course_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN | {'expert', 'coordinator'})
    course = get(db, Course, course_id)
    if user.role not in ADMIN and course.id not in (user.course_ids or []): fail(403,'scope_forbidden','Курс не назначен вашему аккаунту.')
    if user.role == 'expert' and course.owner_expert_id != user.id: fail(403, 'scope_forbidden', 'Курс принадлежит другому эксперту.')
    a = Assignment(course_id=course_id, title=text_field(body,'title',maximum=200), code=body.get('code', 'ДЗ'))
    fill_assignment(a, body); db.add(a); db.flush()
    audit(db, user, 'assignment.created', 'assignment', a.id); db.commit(); return assignment_json(db,a,True)

@app.get(P+'/assignments/{assignment_id}')
def read_assignment(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get(db, Assignment, assignment_id); assignment_scope(db,user,a)
    return assignment_json(db,a,user.role in ADMIN | {'expert'})

@app.patch(P+'/assignments/{assignment_id}')
def patch_assignment(assignment_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get(db,Assignment,assignment_id); assignment_scope(db,user,a,True)
    fill_assignment(a,body); audit(db,user,'assignment.updated','assignment',a.id); db.commit(); return assignment_json(db,a,True)

def expert_scope(db,user,assignment_id):
    require(user, ADMIN | {'expert'})
    assignment = get(db, Assignment, assignment_id); assignment_scope(db,user,assignment,True)
    return assignment

def parse_criteria(body):
    items = body.get('criteria')
    if not isinstance(items,list) or not 1 <= len(items) <= 100: fail(422,'invalid_rubric','Добавьте от 1 до 100 критериев.')
    results = []
    for item in items:
        score = item.get('maxScore',item.get('max_score'))
        if not isinstance(score,(int,float)) or not 0 < score <= 1000: fail(422,'invalid_score','Максимум критерия должен быть больше нуля.')
        mode = item.get('mode',item.get('verification_mode','llm'))
        if mode not in ['llm','human','external','deterministic','deterministic_or_llm']: fail(422,'invalid_mode','Неизвестный способ проверки.')
        results.append({'id': item.get('id') or uid(), 'title': text_field(item,'title',maximum=200), 'description': str(item.get('description',''))[:10000], 'max_score': score, 'verification_mode': mode, 'required': bool(item.get('required',True))})
    if len({r['id'] for r in results}) != len(results): fail(422,'duplicate_criterion','Идентификаторы критериев должны быть уникальными.')
    return results

@app.post(P+'/assignments/{assignment_id}/rubrics', status_code=201)
def create_rubric(assignment_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expert_scope(db,user,assignment_id)
    version = (db.scalar(select(func.max(Rubric.version)).where(Rubric.assignment_id == assignment_id)) or 0)+1
    rubric = Rubric(assignment_id=assignment_id, version=version, criteria=parse_criteria(body))
    db.add(rubric); db.flush(); audit(db,user,'rubric.draft_created','rubric',rubric.id); db.commit(); return rubric_json(rubric)

@app.patch(P+'/rubrics/{rubric_id}')
def patch_rubric(rubric_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = get(db,Rubric,rubric_id); expert_scope(db,user,r.assignment_id)
    if r.status != 'draft': fail(409,'immutable_version','Опубликованная рубрика неизменяема. Создайте новую версию.')
    r.criteria = parse_criteria(body); audit(db,user,'rubric.updated','rubric',r.id); db.commit(); return rubric_json(r)

@app.post(P+'/rubrics/{rubric_id}/publish')
def publish_rubric(rubric_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r = get(db,Rubric,rubric_id); expert_scope(db,user,r.assignment_id)
    if r.status != 'draft' or not r.criteria: fail(409,'invalid_state','Опубликовать можно заполненный черновик рубрики.')
    for old in db.scalars(select(Rubric).where(Rubric.assignment_id==r.assignment_id,Rubric.status=='published')).all(): old.status = 'archived'
    r.status, r.published_at = 'published', now(); audit(db,user,'rubric.published','rubric',r.id); db.commit(); return rubric_json(r)

@app.post(P+'/assignments/{assignment_id}/references', status_code=201)
def add_reference(assignment_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = expert_scope(db,user,assignment_id)
    kind = body.get('type')
    if kind not in ['reference','weak','medium','good','guide']: fail(422,'invalid_type','Неизвестный тип материала.')
    url = text_field(body,'url',maximum=2000)
    if urlparse(url).scheme != 'https': fail(422,'invalid_url','Укажите HTTPS-ссылку.')
    ref = {'id':uid(),'type':kind,'name':text_field(body,'name',maximum=200),'url':url}
    match = re.match(r'^https://github.com/([^/]+/[^/]+)/(?:tree|blob)/([^/]+)/(.*)$',url)
    if match: ref.update(repository=match[1],ref=match[2],path=match[3],level=kind)
    a.references = [*a.references,ref]; audit(db,user,'reference.created','assignment',a.id); db.commit(); return ref

@app.delete(P+'/assignments/{assignment_id}/references/{reference_id}')
def delete_reference(assignment_id: str, reference_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = expert_scope(db,user,assignment_id); a.references = [r for r in a.references if r['id']!=reference_id]
    audit(db,user,'reference.deleted','assignment',a.id); db.commit(); return {'ok':True}

@app.post(P+'/assignments/{assignment_id}/late-policy')
def late_policy(assignment_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = get(db,Assignment,assignment_id); assignment_scope(db,user,a,True)
    value = body.get('value',0); interval = body.get('intervalDays',1)
    if body.get('type','fixed') not in ['fixed','percent'] or not isinstance(value,(float,int)) or value<0 or not isinstance(interval,int) or interval<1: fail(422,'invalid_policy','Некорректное правило просрочки.')
    if body.get('type')=='percent' and value>100: fail(422,'invalid_policy','Процент не должен превышать 100.')
    a.late_policy={'enabled':bool(body.get('enabled')), 'type':body.get('type','fixed'),'value':value,'intervalDays':interval}
    audit(db,user,'late_policy.updated','assignment',a.id); db.commit(); return a.late_policy

@app.get(P+'/assignments/{assignment_id}/agent-config')
def get_configs(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expert_scope(db,user,assignment_id)
    return [config_json(c) for c in db.scalars(select(AgentConfig).where(AgentConfig.assignment_id==assignment_id).order_by(AgentConfig.version.desc())).all()]

def validate_tasks(db,body):
    tasks = body.get('tasks',{})
    if not isinstance(tasks,dict): fail(422,'invalid_tasks','Задайте конфигурации задач.')
    result={}
    for name, task in tasks.items():
        if name not in TASK_TYPES: fail(422,'invalid_task','Неизвестный тип задачи.')
        model_id = task.get('modelId',task.get('model_id',''))
        model = db.get(ModelEndpoint,model_id)
        if name != 'integrity_reasoning' and (not model or not model.enabled): fail(422,'disabled_model','Выберите включённую модель для каждой задачи.')
        temp = task.get('temperature',task.get('params',{}).get('temperature',.2))
        top = task.get('topP',task.get('params',{}).get('top_p',.9))
        maximum = task.get('maxOutputTokens',task.get('params',{}).get('max_output_tokens',4000))
        if not isinstance(temp,(int,float)) or not 0<=temp<=2 or not isinstance(top,(int,float)) or not 0<top<=1 or not isinstance(maximum,int) or not 128<=maximum<=64000: fail(422,'invalid_params','Проверьте параметры inference.')
        forbidden = set(task.get('params',{}))-{'temperature','top_p','max_output_tokens'}
        if forbidden: fail(422,'restricted_params','Таймауты и retries задаются только в Model Registry.')
        prompt = task.get('prompt',task.get('prompt_template',''))
        if not isinstance(prompt,str) or not 1<=len(prompt)<=30000: fail(422,'invalid_prompt','Введите промпт длиной до 30 000 символов.')
        result[name]={'model_id':model_id,'prompt_template':prompt,'params':{'temperature':temp,'top_p':top,'max_output_tokens':maximum}}
    return result

@app.post(P+'/assignments/{assignment_id}/agent-config/versions', status_code=201)
def create_config(assignment_id: str, body: dict = {}, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expert_scope(db,user,assignment_id)
    active=active_config(db,assignment_id)
    version=(db.scalar(select(func.max(AgentConfig.version)).where(AgentConfig.assignment_id==assignment_id)) or 0)+1
    model=db.scalar(select(ModelEndpoint).where(ModelEndpoint.enabled==True))
    tasks=copy.deepcopy(active.tasks) if active else {name:{'model_id':model.id if model else '', 'prompt_template':'Используй только rubric и проверяемые evidence. При нехватке оснований откажись от оценки.', 'params':{'temperature':.2,'top_p':.9,'max_output_tokens':4000}} for name in TASK_TYPES}
    if body.get('tasks'): tasks=validate_tasks(db,body)
    c=AgentConfig(assignment_id=assignment_id,version=version,tasks=tasks,thresholds=copy.deepcopy(active.thresholds) if active else {'abstain':.6,'critic_confidence':.6},created_by=user.id)
    db.add(c); db.flush(); audit(db,user,'agent_config.draft_created','agent_config',c.id); db.commit(); return config_json(c)

def scoped_config(db,user,aid,version):
    expert_scope(db,user,aid)
    c=db.scalar(select(AgentConfig).where(AgentConfig.assignment_id==aid,AgentConfig.version==version).with_for_update())
    if not c: fail(404,'not_found','Версия конфигурации не найдена.')
    return c

@app.patch(P+'/assignments/{assignment_id}/agent-config/versions/{version}')
def patch_config(assignment_id: str, version: int, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c=scoped_config(db,user,assignment_id,version)
    if c.status not in ['draft','evaluated']: fail(409,'immutable_version','Опубликованная конфигурация неизменяема.')
    if db.scalar(select(EvalRun).where(EvalRun.agent_config_version_id==c.id,EvalRun.status.in_(['queued','running']))): fail(409,'eval_running','Дождитесь завершения eval перед изменением конфигурации.')
    if 'tasks' in body: c.tasks={**c.tasks,**validate_tasks(db,body)}
    if 'thresholds' in body:
        thresholds=body['thresholds']; abstain=thresholds.get('abstain',.6); critic=thresholds.get('critic',thresholds.get('critic_confidence',.6))
        if not all(isinstance(v,(int,float)) and 0<=v<=1 for v in [abstain,critic]): fail(422,'invalid_thresholds','Пороги должны быть от 0 до 1.')
        c.thresholds={'abstain':abstain,'critic_confidence':critic}
    c.status='draft'
    audit(db,user,'agent_config.updated','agent_config',c.id,{'hash':hashlib.sha256(json.dumps(c.tasks,sort_keys=True).encode()).hexdigest()}); db.commit(); return config_json(c)

@app.post(P+'/assignments/{assignment_id}/agent-config/versions/{version}/publish')
def publish_config(assignment_id: str, version: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c=scoped_config(db,user,assignment_id,version)
    if c.status not in ['draft','evaluated']: fail(409,'immutable_version','Версию нельзя повторно опубликовать.')
    if set(TASK_TYPES)-set(c.tasks): fail(422,'incomplete_config','Настройте все задачи агента.')
    validate_tasks(db,{'tasks':c.tasks})
    a=get(db,Assignment,assignment_id)
    if any(r.get('type') in ['weak','medium','good'] for r in a.references) and c.status!='evaluated': fail(409,'eval_required','Перед публикацией выполните eval на калибровочных примерах.')
    for previous in db.scalars(select(AgentConfig).where(AgentConfig.assignment_id==assignment_id,AgentConfig.status=='published')).all(): previous.status='archived'
    c.status,c.published_at='published',now()
    audit(db,user,'agent_config.published','agent_config',c.id); db.commit(); return config_json(c)

@app.post(P+'/assignments/{assignment_id}/agent-config/versions/{version}/archive')
def archive_config(assignment_id: str, version: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c=scoped_config(db,user,assignment_id,version)
    if c.status=='published': fail(409,'active_version','Сначала опубликуйте заменяющую версию.')
    c.status='archived'; audit(db,user,'agent_config.archived','agent_config',c.id); db.commit(); return config_json(c)

@app.get(P+'/models')
def list_models(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN | {'expert'})
    return [model_json(m,user.role in ADMIN) for m in db.scalars(select(ModelEndpoint).where(ModelEndpoint.enabled==True)).all()]

@app.get(P+'/admin/models')
def admin_models(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user, ADMIN); return [model_json(m,True) for m in db.scalars(select(ModelEndpoint)).all()]

def fill_model(m,body):
    connection_fields=('provider','base_url','model_name','api_key_env')
    previous_connection=tuple(getattr(m,field) for field in connection_fields)
    forbidden={'apiKey','api_key','token','secret','password'} & set(body)
    if forbidden: fail(422,'secret_not_allowed','Секрет задаётся только в окружении сервиса.')
    for incoming,field in {'name':'name','provider':'provider','group':'group','baseUrl':'base_url','modelName':'model_name','apiKeyEnv':'api_key_env'}.items():
        if incoming in body: setattr(m,field,text_field(body,incoming,maximum=500))
    if m.provider not in ['openai','openai_compatible','lm_studio','vllm','ollama','private','gemini']: fail(422,'invalid_provider','Неизвестный провайдер.')
    if not re.fullmatch(r'[A-Z][A-Z0-9_]{1,99}',m.api_key_env): fail(422,'invalid_env_ref','Укажите имя переменной окружения, например OPENAI_API_KEY.')
    url=urlparse(m.base_url)
    if url.scheme not in ['http','https'] or not url.hostname or url.username or url.password or url.query or url.fragment: fail(422,'invalid_endpoint','Укажите URL без пароля, query-параметров и фрагмента.')
    if 'enabled' in body: m.enabled=bool(body['enabled'])
    if 'defaultParams' in body:
        values=body['defaultParams']; result={}
        mapping={'temperature':'temperature','maxOutputTokens':'max_output_tokens','timeoutSeconds':'timeout_seconds','maxRetries':'max_retries'}
        for key,dest in mapping.items():
            if key in values: result[dest]=values[key]
        defaults={'temperature':.2,'max_output_tokens':4000,'timeout_seconds':90,'max_retries':2}
        result={**defaults,**result}
        bounds={'temperature':(0,2),'max_output_tokens':(128,64000),'timeout_seconds':(1,600),'max_retries':(0,5)}
        if any(not isinstance(result[k],(int,float)) or not lo<=result[k]<=hi for k,(lo,hi) in bounds.items()): fail(422,'invalid_params','Недопустимые параметры модели.')
        m.default_params=result
    if 'capabilities' in body:
        incoming=body['capabilities']
        if not isinstance(incoming,dict): fail(422,'invalid_capabilities','Передайте объект возможностей модели.')
        capabilities=copy.deepcopy(m.capabilities or {})
        aliases={'jsonSchema':'json_schema','jsonMode':'json_mode','zeroRetention':'zero_retention'}
        for source,destination in aliases.items():
            if source in incoming:
                if not isinstance(incoming[source],bool): fail(422,'invalid_capabilities',f'{source} должно быть true или false.')
                capabilities[destination]=incoming[source]
        maximum=incoming.get('maxContextTokens',capabilities.get('max_context_tokens',32000))
        if not isinstance(maximum,int) or isinstance(maximum,bool) or maximum<1000 or maximum>2000000: fail(422,'invalid_context','Проверьте размер контекстного окна.')
        capabilities['max_context_tokens']=maximum
        capabilities.setdefault('json_mode',not (m.provider=='gemini' or m.model_name.lower().startswith('gemma')))
        m.capabilities=capabilities
    if tuple(getattr(m,field) for field in connection_fields)!=previous_connection:
        m.health='unknown'

@app.post(P+'/admin/models', status_code=201)
def create_model(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN)
    m=ModelEndpoint(name='',provider='openai',group='balanced',base_url='',model_name='',api_key_env='OPENAI_API_KEY',enabled=True,default_params={},capabilities={})
    fill_model(m,body)
    if not m.name or not m.model_name: fail(422,'incomplete_model','Укажите название и model_name.')
    db.add(m); db.flush(); audit(db,user,'model_endpoint.created','model',m.id); db.commit(); return model_json(m,True)

@app.patch(P+'/admin/models/{model_id}')
def patch_model(model_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN); m=get(db,ModelEndpoint,model_id); fill_model(m,body)
    audit(db,user,'model_endpoint.updated','model',m.id,{'fields':sorted(body.keys())}); db.commit(); return model_json(m,True)

@app.get(P+'/admin/models/{model_id}/usage')
def model_usage(model_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN); get(db,ModelEndpoint,model_id)
    return [{'assignmentId':c.assignment_id,'configVersion':c.version,'configId':c.id,'status':c.status,'tasks':[name for name,value in c.tasks.items() if value['model_id']==model_id]} for c in db.scalars(select(AgentConfig)).all() if any(value['model_id']==model_id for value in c.tasks.values())]

@app.post(P+'/admin/models/{model_id}/disable')
def disable_model(model_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN); m=get(db,ModelEndpoint,model_id); m.enabled=False
    audit(db,user,'model_endpoint.disabled','model',m.id); db.commit(); return {'model':model_json(m,True),'affectedBindings':model_usage(model_id,user,db)}

@app.post(P+'/admin/models/{model_id}/probe')
async def probe_model(model_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    import httpx
    from .services.pipeline import PipelineError, validate_model_endpoint
    require(user,ADMIN); m=get(db,ModelEndpoint,model_id)
    if not m.enabled: fail(409,'disabled_model','Модель отключена.')
    key=os.getenv(m.api_key_env)
    if m.provider in {'openai','gemini'} and not key:
        m.health='missing'
    else:
        try:
            request_headers=validate_model_endpoint(model_python(m),app_env=settings.app_env,public_data=True)
            endpoint=m.base_url.rstrip('/')+'/models'
            if m.provider=='gemini':
                name=m.model_name.removeprefix('models/')
                endpoint+='/' + quote(name,safe='')
                request_headers={'x-goog-api-key':key}
            async with httpx.AsyncClient(timeout=15,follow_redirects=False) as client:
                response=await client.get(endpoint,headers=request_headers)
                m.health='ok' if response.status_code==200 else f'http_{response.status_code}'
                if m.provider=='gemini' and response.status_code==200:
                    metadata=response.json()
                    if not isinstance(metadata,dict):
                        m.health='invalid_response'
                    elif 'supportedGenerationMethods' in metadata:
                        methods=metadata['supportedGenerationMethods']
                        if not isinstance(methods,list) or 'generateContent' not in methods:
                            m.health='unsupported'
        except PipelineError as exc:
            m.health='missing' if str(exc)=='configuration_error:credential_missing' else 'blocked'
        except httpx.HTTPError:
            m.health='unavailable'
        except ValueError:
            m.health='invalid_response'
    audit(db,user,'model_endpoint.probed','model',m.id,{'health':m.health}); db.commit(); return model_json(m,True)

@app.patch(P+'/admin/settings')
def save_settings(body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN); s=get(db,PlatformSetting,'global'); values=copy.deepcopy(s.values)
    limits={'maxFileMb':(1,100),'maxFiles':(1,500),'maxReviewTokens':(1000,128000)}
    for key,(lo,hi) in limits.items():
        if key in body:
            if not isinstance(body[key],int) or not lo<=body[key]<=hi: fail(422,'invalid_limit',f'Проверьте {key}.')
            values[key]=body[key]
    s.values=values; audit(db,user,'settings.updated','settings','global'); db.commit(); return s.values

def choose_reviewer(db,assignment):
    reviewers=db.scalars(select(User).where(User.role=='reviewer',User.active==True,User.available==True)).all()
    counts={u.id:0 for u in reviewers}
    for r in db.scalars(select(Review).where(Review.status.not_in(['confirmed','superseded']))).all():
        if r.reviewer_id in counts:
            s=db.get(Submission,r.submission_id); a=db.get(Assignment,s.assignment_id); counts[r.reviewer_id]+=a.estimated_minutes
    eligible=[u for u in reviewers if assignment.course_id in (u.course_ids or []) and counts[u.id]+assignment.estimated_minutes<=u.capacity]
    return min(eligible,key=lambda u:(counts[u.id]/max(u.capacity,1),u.id)).id if eligible else None

def new_review(db,submission,reviewer_id=None):
    a=get(db,Assignment,submission.assignment_id); rubric=active_rubric(db,a.id); config=active_config(db,a.id)
    if not rubric: fail(409,'rubric_required','Эксперт должен опубликовать рубрику задания.')
    review=Review(submission_id=submission.id,reviewer_id=reviewer_id or choose_reviewer(db,a),rubric_id=rubric.id,agent_config_version_id=config.id if config else None,criterion_results=[{'criterion_id':c['id'],'suggested_score':None,'final_score':None,'confidence':0,'abstained':True,'reason':'Ожидает обработки','confirmed':False,'note':''} for c in rubric.criteria])
    db.add(review); db.flush(); return review

@app.post(P+'/submissions/github', status_code=202)
def submit_github(body: dict, request: Request, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from .services.pipeline import validate_pr_url
    require(user,{'student'})
    key,fp,old=idempotent(db,request,user,body)
    if old: return old
    assignment=get(db,Assignment,body.get('assignmentId','')); assignment_scope(db,user,assignment)
    pr_url=body.get('prUrl',body.get('url',''))
    try: validate_pr_url(pr_url)
    except Exception: fail(422,'invalid_pr','Укажите GitHub Pull Request: https://github.com/owner/repository/pull/123')
    existing=db.scalar(select(Submission).where(Submission.assignment_id==assignment.id,Submission.student_id==user.id,Submission.status.in_(['submitted','ingesting','pre_review_running'])))
    if existing: fail(409,'submission_busy','Предыдущая отправка ещё обрабатывается.')
    attempt=(db.scalar(select(func.max(Submission.attempt_no)).where(Submission.assignment_id==assignment.id,Submission.student_id==user.id)) or 0)+1
    submission=Submission(assignment_id=assignment.id,student_id=user.id,external_ref=pr_url,attempt_no=attempt,public_data=bool(body.get('publicData',settings.app_env=='dev_demo')))
    db.add(submission); db.flush(); review=new_review(db,submission); job=enqueue(db,'ingest',review.id)
    response={'submissionId':submission.id,'reviewId':review.id,'jobId':job.id,'status':'submitted'}
    remember(db,key,fp,response); audit(db,user,'submission.created','submission',submission.id); db.commit(); background.add_task(dispatch,job.id); return response

@app.get(P+'/submissions/{submission_id}')
def read_submission(submission_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s=get(db,Submission,submission_id)
    assignment_scope(db,user,get(db,Assignment,s.assignment_id))
    if user.role=='student':
        if s.student_id!=user.id: fail(403,'scope_forbidden','Это работа другого студента.')
    else:
        r=latest_review(db,s.id)
        if not r: fail(404,'not_found','Проверка не найдена.')
        review_scope(db,user,r)
    return submission_json(db,s,user.role!='moderator')

@app.post(P+'/submissions/{submission_id}/reprocess', status_code=202)
def reprocess(submission_id: str, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s=get(db,Submission,submission_id); previous=latest_review(db,s.id)
    assignment_scope(db,user,get(db,Assignment,s.assignment_id))
    if user.role=='student':
        if s.student_id!=user.id: fail(403,'scope_forbidden','Это работа другого студента.')
    else: review_scope(db,user,previous,True)
    if s.status in ['ingesting','pre_review_running','submitted']: fail(409,'busy','Обработка уже запущена.')
    if previous and previous.status=='confirmed': fail(409,'review_locked','Создайте новую отправку для повторной проверки.')
    review=new_review(db,s,previous.reviewer_id if previous else None)
    if previous: previous.status='superseded'
    s.status='submitted'; s.error=None
    job=enqueue(db,'ingest',review.id); audit(db,user,'submission.reprocessed','submission',s.id); db.commit(); background.add_task(dispatch,job.id); return {'jobId':job.id,'reviewId':review.id}

@app.post(P+'/submissions/{submission_id}/pre-review', status_code=202)
def prerun(submission_id: str, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    s=get(db,Submission,submission_id); previous=latest_review(db,s.id)
    if user.role=='expert': expert_scope(db,user,s.assignment_id)
    else: review_scope(db,user,previous,True)
    if previous.status=='confirmed': fail(409,'review_locked','Подтверждённый результат нельзя перезапустить.')
    if s.status in ['ingesting','pre_review_running','submitted']: fail(409,'busy','Обработка уже запущена.')
    if not s.artifacts: fail(409,'artifacts_required','Сначала загрузите файлы PR.')
    review=new_review(db,s,previous.reviewer_id); previous.status='superseded'; s.status='pre_review_running'; review.status='pre_review_running'; s.error=None
    job=enqueue(db,'review',review.id); audit(db,user,'review.rerun','review',review.id,{'previousReviewId':previous.id,'configId':review.agent_config_version_id}); db.commit(); background.add_task(dispatch,job.id); return {'jobId':job.id,'reviewId':review.id}

@app.post(P+'/integrations/github/webhook', status_code=202)
async def github_webhook(request: Request, background: BackgroundTasks, db: Session = Depends(get_db)):
    secret=os.getenv('GITHUB_WEBHOOK_SECRET','')
    if not secret: fail(503,'webhook_not_configured','Webhook не настроен.')
    raw=await request.body()
    expected='sha256='+hmac.new(secret.encode(),raw,hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected,request.headers.get('X-Hub-Signature-256','')): fail(401,'invalid_signature','Неверная подпись webhook.')
    try: body=json.loads(raw)
    except ValueError: fail(400,'invalid_json','Некорректный JSON.')
    # GitHub delivery ID is its idempotency key.
    delivery=request.headers.get('X-GitHub-Delivery') or request.headers.get('Idempotency-Key')
    if not delivery: fail(400,'idempotency_required','Требуется X-GitHub-Delivery.')
    key=hashlib.sha256(('webhook:'+delivery).encode()).hexdigest(); fp=hashlib.sha256(raw).hexdigest(); old=db.get(Idempotency,key)
    if old:
        if old.fingerprint!=fp: fail(409,'idempotency_conflict','Ключ уже использован.')
        return old.response
    jobs=[]
    if request.headers.get('X-GitHub-Event')=='pull_request' and body.get('action') in ['synchronize','reopened']:
        url=body.get('pull_request',{}).get('html_url')
        for s in db.scalars(select(Submission).where(Submission.external_ref==url)).all():
            previous=latest_review(db,s.id)
            if previous and previous.status!='confirmed' and s.status not in ['submitted','ingesting','pre_review_running']:
                r=new_review(db,s,previous.reviewer_id); previous.status='superseded'; s.status='submitted'; job=enqueue(db,'ingest',r.id); jobs.append(job.id)
    response={'jobIds':jobs,'accepted':True}; remember(db,key,fp,response); audit(db,None,'github.webhook','webhook',delivery[:64]); db.commit()
    for jid in jobs: background.add_task(dispatch,jid)
    return response

@app.get(P+'/reviewer/ledger')
def ledger(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'reviewer'})
    reviews=db.scalars(select(Review).order_by(Review.created_at.desc())).all()
    if user.role=='reviewer': reviews=[r for r in reviews if r.reviewer_id==user.id and get(db,Assignment,get(db,Submission,r.submission_id).assignment_id).course_id in (user.course_ids or [])]
    reviews=[r for r in reviews if r.status!='superseded']
    return [{'review':review_json(db,r),'submission':submission_json(db,get(db,Submission,r.submission_id))} for r in reviews]

@app.get(P+'/reviews/{review_id}/workspace')
def workspace(review_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=get(db,Review,review_id); review_scope(db,user,r)
    if user.role in ADMIN | {'reviewer'} and r.status!='confirmed' and not r.opened_at:
        r.opened_at=now(); audit(db,user,'review.opened','review',r.id); db.commit()
    s=get(db,Submission,r.submission_id)
    return {'review':review_json(db,r,user.role=='student'),'submission':submission_json(db,s),'assignment':assignment_json(db,get(db,Assignment,s.assignment_id))}

@app.patch(P+'/reviews/{review_id}/criteria/{criterion_id}')
def decide_criterion(review_id: str, criterion_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=edit_review(db,user,review_id); rubric=get(db,Rubric,r.rubric_id)
    criterion=next((c for c in rubric.criteria if c['id']==criterion_id),None)
    if not criterion: fail(404,'criterion_not_found','Критерий не найден в закреплённой рубрике.')
    results=copy.deepcopy(r.criterion_results); result=next((c for c in results if c['criterion_id']==criterion_id),None)
    if not result:
        result={'criterion_id':criterion_id,'suggested_score':None,'confidence':0,'abstained':True,'reason':'Ручная проверка'}; results.append(result)
    score=body.get('finalScore',result.get('final_score'))
    if not isinstance(score,(int,float)) or isinstance(score,bool) or not 0<=score<=criterion['max_score']: fail(422,'invalid_score',f'Балл должен быть от 0 до {criterion["max_score"]}.')
    result.update(final_score=score,confirmed=bool(body.get('confirmed',False)),note=str(body.get('note',result.get('note','')))[:10000])
    r.criterion_results=results; changed(r); get(db,Submission,r.submission_id).status='in_review'
    audit(db,user,'review.criterion_decided','review',r.id,{'criterionId':criterion_id,'score':score,'confirmed':result['confirmed']}); db.commit(); return review_json(db,r)

def normalize_anchor(db,r,anchor):
    if not isinstance(anchor,dict): fail(422,'invalid_anchor','Укажите привязку к исходному файлу.')
    result={'artifact_id':anchor.get('artifactId',anchor.get('artifact_id','')),'path':anchor.get('path',''),'start':str(anchor.get('start','')),'end':str(anchor.get('end',anchor.get('start',''))),'quote':str(anchor.get('quote',''))}
    submission=get(db,Submission,r.submission_id)
    artifact=next((a for a in submission.artifacts if (result['artifact_id'] and a.get('id')==result['artifact_id']) or (result['path'] and a.get('path')==result['path'])),None)
    if not artifact: fail(422,'invalid_anchor','Исходный файл не найден в работе.')
    result['artifact_id']=artifact.get('id',''); result['path']=artifact['path']
    text='\n'.join(s.get('text','') for s in artifact.get('segments',[]))
    if result['quote'] and result['quote'] not in text: fail(422,'invalid_quote','Цитата отсутствует в выбранном файле.')
    anchors=[]
    for segment in artifact.get('segments',[]):
        value=segment.get('anchor',{})
        anchors.append(value if isinstance(value,str) else str(value.get('start','')))
        if isinstance(value,dict) and value.get('end'): anchors.append(str(value['end']))
    if result['start'] not in anchors or result['end'] not in anchors: fail(422,'invalid_anchor','Указанный фрагмент отсутствует в файле.')
    return result

@app.patch(P+'/reviews/{review_id}/annotations/{annotation_id}')
def decide_annotation(review_id: str, annotation_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=edit_review(db,user,review_id); annotations=copy.deepcopy(r.annotations); a=next((a for a in annotations if a['id']==annotation_id),None)
    if not a: fail(404,'annotation_not_found','Замечание не найдено.')
    if 'status' in body:
        if body['status'] not in ['pending','accepted','edited','rejected']: fail(422,'invalid_status','Неизвестное решение.')
        a['status']=body['status']
    if 'message' in body:
        a['message']=text_field(body,'message',maximum=10000)
        if a['status']=='accepted': a['status']='edited'
    if 'criterionId' in body:
        if body['criterionId'] is not None and body['criterionId'] not in {c['id'] for c in get(db,Rubric,r.rubric_id).criteria}: fail(422,'invalid_criterion','Критерий отсутствует в рубрике.')
        a['criterion_id']=body['criterionId']
    if 'category' in body: a['category']=text_field(body,'category',maximum=100)
    if 'visibleToStudent' in body: a['visible_to_student']=bool(body['visibleToStudent'])
    if 'anchor' in body: a['source_anchor']=normalize_anchor(db,r,body['anchor'])
    r.annotations=annotations; changed(r); audit(db,user,'review.annotation_decided','review',r.id,{'annotationId':annotation_id,'status':a['status']}); db.commit(); return review_json(db,r)

@app.post(P+'/reviews/{review_id}/annotations', status_code=201)
def add_annotation(review_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=edit_review(db,user,review_id); criterion_id=body.get('criterionId')
    if criterion_id and criterion_id not in {c['id'] for c in get(db,Rubric,r.rubric_id).criteria}: fail(422,'invalid_criterion','Критерий отсутствует в рубрике.')
    anchor=normalize_anchor(db,r,body.get('anchor',{}))
    a={'id':uid(),'criterion_id':criterion_id,'category':text_field(body,'category',maximum=100) if 'category' in body else 'comment','source':'reviewer','status':'accepted','message':text_field(body,'message',maximum=10000),'visible_to_student':bool(body.get('visibleToStudent',True)),'source_anchor':anchor}
    r.annotations=[*r.annotations,a]; changed(r); audit(db,user,'review.annotation_created','review',r.id,{'annotationId':a['id']}); db.commit(); return review_json(db,r)

@app.post(P+'/reviews/{review_id}/integrity/{signal_id}/decision')
def integrity_decision(review_id: str, signal_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=get(db,Review,review_id); review_scope(db,user,r,True)
    fail(409,'integrity_mocked','Модуль выявления ИИ пока замокан и не формирует сигналы.')

@app.post(P+'/reviews/{review_id}/feedback/compose')
def compose_review_feedback(review_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=edit_review(db,user,review_id)
    confirmed=[a for a in r.annotations if a.get('status') in ['accepted','edited'] and a.get('visible_to_student',True)]
    criteria={c['id']:c for c in get(db,Rubric,r.rubric_id).criteria}
    scores=[c for c in r.criterion_results if c.get('confirmed') and c.get('final_score') is not None]
    lines=[f'{criteria[c["criterion_id"]]["title"]}: {c["final_score"]:g} / {criteria[c["criterion_id"]]["max_score"]:g}.' + (f' {c["note"]}' if c.get('note') else '') for c in scores]
    lines.extend(a['message'] for a in confirmed)
    r.feedback='\n\n'.join(lines); r.feedback_revision=r.revision
    audit(db,user,'review.feedback_composed','review',r.id,{'annotationIds':[a['id'] for a in confirmed]}); db.commit(); return review_json(db,r)

@app.post(P+'/reviews/{review_id}/confirm')
def confirm_review(review_id: str, body: dict, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    key,fp,old=idempotent(db,request,user,body)
    if old: return old
    r=db.scalar(select(Review).where(Review.id==review_id).with_for_update())
    if not r: fail(404,'not_found','Проверка не найдена.')
    review_scope(db,user,r,True)
    if r.status=='confirmed': return review_json(db,r)
    if r.status in ['ingesting','pre_review_running','submitted']: fail(409,'review_busy','Дождитесь завершения обработки.')
    if 'revision' in body and body['revision']!=r.revision: fail(409,'revision_conflict','Проверка изменилась. Обновите страницу.')
    rubric=get(db,Rubric,r.rubric_id)
    results={c['criterion_id']:c for c in r.criterion_results}
    if any(c['id'] not in results or not results[c['id']].get('confirmed') or results[c['id']].get('final_score') is None for c in rubric.criteria): fail(409,'scores_unconfirmed','Подтвердите итоговый балл каждого критерия.')
    if r.feedback_revision!=r.revision: fail(409,'stale_feedback','Пересоберите обратную связь после последних изменений.')
    if 'feedback' in body:
        if not isinstance(body['feedback'],str) or not body['feedback'].strip() or len(body['feedback'])>50000: fail(422,'invalid_feedback','Введите обратную связь.')
        r.feedback=body['feedback'].strip()
    if not r.feedback.strip(): fail(409,'feedback_required','Сначала соберите обратную связь.')
    score=sum(results[c['id']]['final_score'] for c in rubric.criteria)
    s=get(db,Submission,r.submission_id)
    penalty=late_penalty(db,r)
    score=max(0,score-penalty)
    # Lock finalization with a conditional write, also on SQLite development runs.
    claimed=db.execute(update(Review).where(Review.id==r.id,Review.status.not_in(['confirmed','superseded']),Review.revision==r.revision).values(status='confirmed',final_score=score,late_penalty_value=penalty,confirmed_at=now())).rowcount
    if claimed!=1: fail(409,'review_conflict','Проверка уже подтверждена другим запросом.')
    db.flush(); db.refresh(r); s=get(db,Submission,r.submission_id); s.status='confirmed'
    db.add(Notification(user_id=s.student_id,title='Работа проверена',message=get(db,Assignment,s.assignment_id).title,link=f'/student?submission={s.id}'))
    audit(db,user,'review.confirmed','review',r.id,{'score':score,'rubricId':r.rubric_id,'agentConfigId':r.agent_config_version_id})
    response=review_json(db,r); remember(db,key,fp,response); db.commit(); return response

@app.post(P+'/reviews/{review_id}/flags', status_code=201)
def flag_rubric(review_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=get(db,Review,review_id); review_scope(db,user,r,True)
    s=get(db,Submission,r.submission_id); flag=RubricFlag(assignment_id=s.assignment_id,review_id=r.id,message=text_field(body,'message',maximum=10000))
    db.add(flag); db.flush(); audit(db,user,'rubric.flag_created','rubric_flag',flag.id); db.commit(); return {'id':flag.id,'status':flag.status}

@app.post(P+'/expert/rubric-flags/{flag_id}/decision')
def decide_flag(flag_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    f=get(db,RubricFlag,flag_id); expert_scope(db,user,f.assignment_id)
    status=body.get('status',body.get('decision'))
    if status not in ['accepted','rejected']: fail(422,'invalid_status','Выберите принять или отклонить.')
    f.status=status; audit(db,user,'rubric.flag_decided','rubric_flag',f.id); db.commit(); return {'id':f.id,'status':f.status}

@app.get(P+'/coordinator/workload')
def workload(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'coordinator'})
    reviewers=db.scalars(select(User).where(User.role=='reviewer')).all(); result=[]
    for u in reviewers:
        if user.role not in ADMIN and not set(u.course_ids or []) & set(user.course_ids or []): continue
        reviews=db.scalars(select(Review).where(Review.reviewer_id==u.id,Review.status.not_in(['confirmed','superseded']))).all()
        if user.role not in ADMIN: reviews=[r for r in reviews if get(db,Assignment,get(db,Submission,r.submission_id).assignment_id).course_id in (user.course_ids or [])]
        minutes=sum(get(db,Assignment,get(db,Submission,r.submission_id).assignment_id).estimated_minutes for r in reviews)
        result.append({**user_json(u),'assignedCount':len(reviews),'assignedMinutes':minutes,'loadRatio':minutes/max(1,u.capacity)})
    return result

@app.patch(P+'/coordinator/reviewers/{reviewer_id}')
def reviewer_capacity(reviewer_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'coordinator'}); target=get(db,User,reviewer_id)
    if user.role not in ADMIN and not set(target.course_ids or []) & set(user.course_ids or []): fail(403,'scope_forbidden','Ревьюер не назначен вашим курсам.')
    if target.role!='reviewer': fail(422,'not_reviewer','Сотрудник не является ревьюером.')
    if 'capacityMinutes' in body:
        cap=body['capacityMinutes']
        if not isinstance(cap,int) or not 0<=cap<=10080: fail(422,'invalid_capacity','Допустимо 0–10080 минут в неделю.')
        target.capacity=cap
    if 'available' in body: target.available=bool(body['available'])
    audit(db,user,'reviewer.capacity_updated','user',target.id); db.commit(); return user_json(target)

@app.post(P+'/coordinator/submissions/{submission_id}/assign')
def assign_submission(submission_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'coordinator'}); s=get(db,Submission,submission_id); r=latest_review(db,s.id)
    assignment_scope(db,user,get(db,Assignment,s.assignment_id),True)
    if not r or r.status=='confirmed': fail(409,'review_locked','Назначить можно незавершённую проверку.')
    reviewer_id=body.get('reviewerId')
    if reviewer_id:
        target=get(db,User,reviewer_id)
        if get(db,Assignment,s.assignment_id).course_id not in (target.course_ids or []): fail(422,'reviewer_scope','Ревьюер не назначен этому курсу.')
        if target.role!='reviewer' or not target.active or not target.available: fail(422,'reviewer_unavailable','Выберите доступного ревьюера.')
        db.add(Notification(user_id=target.id,title='Назначена работа',message=get(db,Assignment,s.assignment_id).title,link=f'/review/{r.id}'))
    r.reviewer_id=reviewer_id; audit(db,user,'review.assigned','review',r.id,{'reviewerId':reviewer_id}); db.commit(); return review_json(db,r)

@app.post(P+'/coordinator/assignments/rebalance')
def rebalance(body: dict = {}, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'coordinator'})
    reviewers=db.scalars(select(User).where(User.role=='reviewer',User.available==True,User.active==True)).all()
    loads={u.id:0 for u in reviewers}; pending=[]
    for r in db.scalars(select(Review).where(Review.status.not_in(['confirmed','superseded']))).all():
        s=get(db,Submission,r.submission_id); a=get(db,Assignment,s.assignment_id)
        if r.reviewer_id in loads: loads[r.reviewer_id]+=a.estimated_minutes
        if user.role not in ADMIN and a.course_id not in (user.course_ids or []): continue
        if r.reviewer_id is None and (not body.get('assignmentId') or s.assignment_id==body['assignmentId']) and (not body.get('courseId') or a.course_id==body['courseId']): pending.append((r,s,a))
    proposals=[]; unassigned=[]
    for r,s,a in pending:
        candidates=[u for u in reviewers if a.course_id in (u.course_ids or []) and loads[u.id]+a.estimated_minutes<=u.capacity]
        if not candidates: unassigned.append(s.id); continue
        target=min(candidates,key=lambda u:(loads[u.id]/max(1,u.capacity),u.id))
        loads[target.id]+=a.estimated_minutes; proposals.append({'submissionId':s.id,'reviewerId':target.id})
    if body.get('preview'): return {'assignments':proposals,'unassignedIds':unassigned}
    requested=body.get('assignments',proposals)
    if not isinstance(requested,list) or len(requested)>1000: fail(422,'invalid_assignments','Некорректный список назначений.')
    changes=[]
    for item in requested:
        s=get(db,Submission,item.get('submissionId','')); r=latest_review(db,s.id); target=get(db,User,item.get('reviewerId',''))
        assignment_scope(db,user,get(db,Assignment,s.assignment_id),True)
        if get(db,Assignment,s.assignment_id).course_id not in (target.course_ids or []): fail(422,'reviewer_scope','Ревьюер не назначен этому курсу.')
        if not r or r.status=='confirmed' or target.role!='reviewer' or not target.active or not target.available: fail(409,'assignment_changed','Назначение изменилось. Обновите предложение.')
        r.reviewer_id=target.id; changes.append(r.id)
        db.add(Notification(user_id=target.id,title='Назначена работа',message=get(db,Assignment,s.assignment_id).title,link=f'/review/{r.id}'))
        audit(db,user,'review.assigned','review',r.id,{'reviewerId':target.id,'automatic':True})
    db.flush()
    for target in reviewers:
        current=db.scalars(select(Review).where(Review.reviewer_id==target.id,Review.status.not_in(['confirmed','superseded']))).all()
        minutes=sum(get(db,Assignment,get(db,Submission,r.submission_id).assignment_id).estimated_minutes for r in current)
        if any(get(db,Review,rid).reviewer_id==target.id for rid in changes) and minutes>target.capacity: fail(409,'capacity_exceeded','Нагрузка ревьюера изменилась. Постройте новое предложение.')
    db.commit(); return {'assigned':len(changes),'reviewIds':changes,'assignments':requested,'unassignedIds':unassigned}

@app.post(P+'/notifications/{notification_id}/read')
@app.patch(P+'/notifications/{notification_id}/read')
def read_notification(notification_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    n=get(db,Notification,notification_id)
    if n.user_id!=user.id: fail(403,'scope_forbidden','Уведомление принадлежит другому пользователю.')
    n.read=True; audit(db,user,'notification.read','notification',n.id); db.commit(); return {'ok':True}

@app.post(P+'/notifications/read-all')
def read_all_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.execute(update(Notification).where(Notification.user_id==user.id).values(read=True))
    audit(db,user,'notifications.read','user',user.id); db.commit(); return {'ok':True}

@app.post(P+'/reviews/{review_id}/open')
@app.post(P+'/reviews/{review_id}/heartbeat')
def review_heartbeat(review_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=get(db,Review,review_id); review_scope(db,user,r,True)
    if r.status=='confirmed': return review_json(db,r)
    stamp=now()
    if r.last_active_at:
        elapsed=(stamp-r.last_active_at.replace(tzinfo=timezone.utc)).total_seconds()
        if 0<elapsed<=90: r.active_seconds=(r.active_seconds or 0)+elapsed
    else: audit(db,user,'review.opened','review',r.id)
    if not r.opened_at: r.opened_at=stamp
    r.last_active_at=stamp; db.commit(); return review_json(db,r)

@app.patch(P+'/reviews/{review_id}/feedback')
def edit_feedback(review_id: str, body: dict, user: User = Depends(current_user), db: Session = Depends(get_db)):
    r=edit_review(db,user,review_id); r.feedback=text_field(body,'feedback',maximum=50000)
    audit(db,user,'review.feedback_edited','review',r.id); db.commit(); return review_json(db,r)

@app.post(P+'/evals', status_code=202)
def create_eval(body: dict, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    assignment_id=body.get('assignmentId',''); a=expert_scope(db,user,assignment_id)
    version=body.get('configVersion')
    c=scoped_config(db,user,assignment_id,version) if version else active_config(db,assignment_id)
    if not c: fail(409,'config_required','Создайте конфигурацию агента.')
    if not active_rubric(db,assignment_id): fail(409,'rubric_required','Опубликуйте рубрику перед eval.')
    if not {'weak','medium','good'}.issubset({r.get('type') for r in a.references}): fail(409,'calibration_required','Добавьте примеры weak, medium и good.')
    repetitions=body.get('repetitions',3)
    if not isinstance(repetitions,int) or not 1<=repetitions<=10: fail(422,'invalid_repetitions','Допустимо 1–10 повторов.')
    if db.scalar(select(EvalRun).where(EvalRun.agent_config_version_id==c.id,EvalRun.status.in_(['queued','running']))): fail(409,'eval_running','Проверка этой версии уже запущена.')
    model_id=body.get('modelId')
    if model_id and not get(db,ModelEndpoint,model_id).enabled: fail(422,'disabled_model','Выбранная модель отключена.')
    e=EvalRun(assignment_id=assignment_id,agent_config_version_id=c.id,repetitions=repetitions,model_override_id=model_id)
    db.add(e); db.flush(); job=enqueue(db,'eval',e.id)
    audit(db,user,'eval.created','eval',e.id,{'configId':c.id}); db.commit(); background.add_task(dispatch,job.id); return {'jobId':job.id,'evalId':e.id,**eval_json(db,e)}

@app.post(P+'/assignments/{assignment_id}/agent-config/versions/{version}/eval', status_code=202)
def eval_config(assignment_id: str, version: int, body: dict, background: BackgroundTasks, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return create_eval({**body,'assignmentId':assignment_id,'configVersion':version},background,user,db)

@app.get(P+'/evals/{eval_id}')
def read_eval(eval_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    e=get(db,EvalRun,eval_id); expert_scope(db,user,e.assignment_id); return eval_json(db,e)

@app.get(P+'/jobs/{job_id}')
def job_status(job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    j=get(db,Job,job_id)
    if j.kind=='eval': expert_scope(db,user,get(db,EvalRun,j.entity_id).assignment_id)
    else:
        r=get(db,Review,j.entity_id); s=get(db,Submission,r.submission_id)
        if user.role=='student':
            if s.student_id!=user.id: fail(403,'scope_forbidden','Работа принадлежит другому студенту.')
        else: review_scope(db,user,r)
    return {'id':j.id,'status':j.status,'error':j.error,'createdAt':iso(j.created_at),'finishedAt':iso(j.finished_at)}

@app.get(P+'/expert/assignments/{assignment_id}/quality')
def quality(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    expert_scope(db,user,assignment_id)
    sids=db.scalars(select(Submission.id).where(Submission.assignment_id==assignment_id)).all()
    reviews=db.scalars(select(Review).where(Review.submission_id.in_(sids))).all()
    all_results=[c for r in reviews for c in r.criterion_results]
    confirmed=[c for c in all_results if c.get('confirmed') and c.get('suggested_score') is not None]
    annotations=[a for r in reviews for a in r.annotations]
    return {'reviewCount':len(reviews),'criterionEditRate':sum(c.get('final_score')!=c.get('suggested_score') for c in confirmed)/len(confirmed) if confirmed else None,'abstainRate':sum(c.get('abstained',False) for c in all_results)/len(all_results) if all_results else None,'annotationAcceptRate':sum(a.get('status')=='accepted' for a in annotations)/len(annotations) if annotations else None}

@app.get(P+'/analytics/overview')
def analytics(user: User = Depends(current_user), db: Session = Depends(get_db)):
    require(user,ADMIN | {'coordinator','expert','reviewer'})
    data=bootstrap(user,db); reviews=data['reviews']; confirmed=[r for r in reviews if r['status']=='confirmed']; calls=[]
    visible_ids={r['id'] for r in reviews}
    for r in db.scalars(select(Review).where(Review.id.in_(visible_ids))).all(): calls.extend(r.model_calls)
    durations=[]
    for r in confirmed:
        s=next(s for s in data['submissions'] if s['id']==r['submissionId'])
        durations.append((datetime.fromisoformat(r['confirmedAt'])-datetime.fromisoformat(s['submittedAt'])).total_seconds()/3600)
    durations.sort()
    def percentile(p): return durations[min(len(durations)-1,int((len(durations)-1)*p))] if durations else None
    return {'totalSubmissions':len(data['submissions']),'confirmedReviews':len(confirmed),'activeMinutes':sum(r['activeMinutes'] for r in confirmed),'submitToFeedbackP50Hours':percentile(.5),'submitToFeedbackP90Hours':percentile(.9),'modelCalls':len(calls),'modelTokens':sum((c.get('input_tokens') or 0)+(c.get('output_tokens') or 0) for c in calls),'evalRuns':len(data['evals']),'integrityStatus':'mock','source':'database'}

from .course_routes import router as course_router
app.include_router(course_router)
from .similarity_routes import router as similarity_router
app.include_router(similarity_router)
