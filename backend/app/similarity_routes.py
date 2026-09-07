from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import current_user, require, ADMIN
from .course_routes import course_scope, latest_submissions
from .db import get_db
from .models import Assignment, Course, SimilarityRun, Submission, User, AuditEvent, now
from .serializers import iso
from .jobs import enqueue, dispatch
from .services.similarity import LANGUAGES, runtime, source_files, SimilarityError

router = APIRouter(prefix='/api/v1')
STAFF = ADMIN | {'expert', 'reviewer'}


def scope(db, user, assignment_id):
    require(user, STAFF)
    assignment = db.get(Assignment, assignment_id)
    if not assignment: raise HTTPException(404, 'Задание не найдено.')
    course_scope(db, user, db.get(Course, assignment.course_id))
    return assignment


def run_json(db, run, details=False):
    names = {u.id: u.name for u in db.scalars(select(User)).all()}
    sources = {s['id']: s for s in run.results.get('submissions', [])}
    submissions = {s.id:s for s in db.scalars(select(Submission).where(Submission.id.in_(run.submission_ids))).all()}
    pairs = []
    for pair in run.results.get('pairs', []):
        pairs.append({**{k: v for k, v in pair.items() if details or k != 'matches'},
                      'leftUrl': submissions[pair['leftId']].external_ref if pair['leftId'] in submissions else None,
                      'rightUrl': submissions[pair['rightId']].external_ref if pair['rightId'] in submissions else None,
                      'leftName': names.get(sources.get(pair['leftId'], {}).get('studentId'), 'Студент'),
                      'rightName': names.get(sources.get(pair['rightId'], {}).get('studentId'), 'Студент'),
                      'decision': (run.decisions or {}).get(pair['id'], {'status': 'pending', 'comment': ''})})
    return {'id': run.id, 'assignmentId': run.assignment_id, 'language': run.language, 'status': run.status,
            'createdAt': iso(run.created_at), 'error': run.error, 'engine': run.results.get('engine', 'JPlag 6.3.0'),
            'submissionCount': len(run.submission_ids), 'sources': list(sources.values()),
            'excludedIds': run.results.get('excludedIds', []), 'failedSubmissions': run.results.get('failedSubmissions', []),
            'pairs': pairs}


class StartComparison(BaseModel):
    language: str = 'go'


class Decision(BaseModel):
    status: str
    comment: str = Field(default='', max_length=4000)


@router.get('/assignments/{assignment_id}/similarity')
def list_runs(assignment_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    scope(db, user, assignment_id)
    installed = True
    try: runtime()
    except SimilarityError: installed = False
    runs = db.scalars(select(SimilarityRun).where(SimilarityRun.assignment_id == assignment_id)
                       .order_by(SimilarityRun.created_at.desc()).limit(20)).all()
    return {'installed': installed, 'languages': list(LANGUAGES), 'runs': [run_json(db, r) for r in runs]}


@router.post('/assignments/{assignment_id}/similarity', status_code=202)
def start_run(assignment_id: str, body: StartComparison, user: User = Depends(current_user), db: Session = Depends(get_db)):
    assignment = scope(db, user, assignment_id)
    # Lock assignment to prevent duplicate concurrent jobs for the same cohort.
    db.scalar(select(Assignment).where(Assignment.id == assignment_id).with_for_update())
    active = db.scalar(select(SimilarityRun).where(SimilarityRun.assignment_id == assignment_id, SimilarityRun.status.in_(['queued', 'running'])))
    if active: return run_json(db, active)
    if body.language not in LANGUAGES: raise HTTPException(422, 'Выберите поддерживаемый язык.')
    try: runtime()
    except SimilarityError as exc: raise HTTPException(503, str(exc)) from None
    enrolled = {u.id for u in db.scalars(select(User).where(User.role == 'student', User.active == True)).all() if assignment.course_id in (u.course_ids or [])}
    submissions = [s for s in latest_submissions(db, [assignment_id]).values() if s.student_id in enrolled]
    if any(s.status in {'submitted', 'ingesting', 'llm_processing', 'pre_review_running'} for s in submissions):
        raise HTTPException(409, 'Дождитесь окончания загрузки и обработки последних отправок.')
    if sum(bool(source_files(s, body.language)) for s in submissions) < 2:
        raise HTTPException(422, 'Нужны минимум две последние отправки разных студентов с кодом выбранного языка.')
    run = SimilarityRun(assignment_id=assignment_id, created_by=user.id, language=body.language,
                        submission_ids=[s.id for s in submissions])
    db.add(run); db.flush()
    job = enqueue(db, 'similarity', run.id)
    db.add(AuditEvent(actor_id=user.id, action='similarity.started', entity_type='similarity', entity_id=run.id,
                      payload_safe={'assignmentId': assignment_id, 'submissions': len(submissions)}))
    db.commit(); dispatch(job.id)
    return run_json(db, run)


@router.get('/similarity/{run_id}')
def get_run(run_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = db.get(SimilarityRun, run_id)
    if not run: raise HTTPException(404, 'Сравнение не найдено.')
    scope(db, user, run.assignment_id)
    return run_json(db, run, details=True)


@router.patch('/similarity/{run_id}/pairs/{pair_id}')
def decide(run_id: str, pair_id: str, body: Decision, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = db.scalar(select(SimilarityRun).where(SimilarityRun.id == run_id).with_for_update())
    if not run: raise HTTPException(404, 'Сравнение не найдено.')
    scope(db, user, run.assignment_id)
    if run.status != 'completed': raise HTTPException(409, 'Сравнение ещё не завершено.')
    if not any(p['id'] == pair_id for p in run.results.get('pairs', [])): raise HTTPException(404, 'Пара не найдена.')
    if body.status not in {'confirmed', 'dismissed', 'pending'}: raise HTTPException(422, 'Некорректное решение.')
    if body.status == 'confirmed' and not body.comment.strip(): raise HTTPException(422, 'Добавьте комментарий для студентов.')
    run.decisions = {**(run.decisions or {}), pair_id: {'status': body.status, 'comment': body.comment.strip(), 'actorId': user.id, 'updatedAt': iso(now())}}
    db.add(AuditEvent(actor_id=user.id, action='similarity.decision', entity_type='similarity', entity_id=run.id, payload_safe={'pairId': pair_id, 'status': body.status}))
    db.commit()
    return run_json(db, run, details=True)
