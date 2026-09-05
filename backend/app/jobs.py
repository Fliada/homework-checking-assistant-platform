import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
from sqlalchemy import select, update
from .config import settings
from .db import SessionLocal
from .models import *
from .serializers import model_python
from .services.errors import pipeline_error_message

pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix='reviewer-jobs')

def dispatch(job_id):
    if settings.job_mode == 'celery':
        from .worker import execute_job
        try:
            execute_job.delay(job_id)
        except Exception:
            with SessionLocal() as db:
                job=db.get(Job,job_id)
                if job:
                    job.status,job.error='failed','Очередь Redis недоступна. Повторите запуск после восстановления.'
                    if job.kind=='similarity':
                        entity=db.get(SimilarityRun,job.entity_id); entity.status='failed'; entity.error=job.error
                    elif job.kind=='eval':
                        entity=db.get(EvalRun,job.entity_id); entity.status='failed'; entity.error=job.error
                    else:
                        review=db.get(Review,job.entity_id); review.status='needs_human'
                        submission=db.get(Submission,review.submission_id); submission.status='needs_human'; submission.error=job.error
                    db.commit()
    else:
        pool.submit(run_job, job_id)

def resume_pending():
    with SessionLocal() as db:
        # A local process crash is recoverable; already finished reviews are not rerun.
        jobs = db.scalars(select(Job).where(Job.status.in_(['queued', 'running']))).all()
        for job in jobs:
            job.status = 'queued'
        db.commit()
        for job in jobs:
            dispatch(job.id)

def enqueue(db, kind, entity_id):
    job = Job(kind=kind, entity_id=entity_id)
    db.add(job)
    db.flush()
    return job

def config_input(c):
    return {'id': c.id, 'tasks': c.tasks, 'thresholds': c.thresholds, 'version': c.version} if c else {'tasks': {}, 'thresholds': {}}

def assignment_input(a):
    return {'id': a.id, 'title': a.title, 'task_text': a.task_text, 'references': a.references}

def safe_error(exc, *, source='model'):
    from .services.pipeline import PipelineError
    if isinstance(exc, PipelineError):
        return pipeline_error_message(str(exc), source=source)
    return 'Внутренняя ошибка обработки. Повторите запуск или обратитесь к администратору.'

def run_job(job_id):
    with SessionLocal() as db:
        claimed = db.execute(update(Job).where(Job.id == job_id, Job.status == 'queued').values(status='running')).rowcount
        db.commit()
        if not claimed: return
        job = db.get(Job, job_id)
        try:
            if job.kind == 'similarity':
                from .services.similarity import process_similarity
                process_similarity(db, job)
            elif job.kind == 'eval':
                asyncio.run(process_eval(db, job))
            else:
                asyncio.run(process_submission(db, job))
            job.status = 'completed'
        except Exception as exc:
            db.rollback()
            job = db.get(Job, job_id)
            job.status, job.error = 'failed', safe_error(exc, source='github' if job.kind=='ingest' else 'model')
            if job.kind == 'similarity':
                entity = db.get(SimilarityRun, job.entity_id)
            elif job.kind == 'eval':
                entity = db.get(EvalRun, job.entity_id)
            else:
                review = db.get(Review, job.entity_id)
                entity = db.get(Submission, review.submission_id) if review else None
                if review: review.status = 'needs_human'
            if entity:
                entity.status, entity.error = 'failed' if job.kind in {'eval', 'similarity'} else 'needs_human', job.error
        job.finished_at = now()
        db.commit()

async def process_submission(db, job):
    from .services.pipeline import ingest_github_pr, run_review_pipeline
    from .services.integrity_check import run_integrity_check
    review = db.get(Review, job.entity_id)
    if review.status == 'confirmed': return
    submission = db.get(Submission, review.submission_id)
    assignment = db.get(Assignment, submission.assignment_id)
    rubric = db.get(Rubric, review.rubric_id)
    config = db.get(AgentConfig, review.agent_config_version_id) if review.agent_config_version_id else None
    if job.kind == 'ingest':
        submission.status, review.status = 'ingesting', 'ingesting'
        db.commit()
        limits = db.get(PlatformSetting, 'global').values
        result = await ingest_github_pr(submission.external_ref, token=os.getenv('GITHUB_TOKEN') or None, allowed_repositories=[p.strip() for p in os.getenv('GITHUB_ALLOWED_REPOSITORIES', '').split(',') if p.strip()] or None, max_files=limits.get('maxFiles', 100), max_bytes=limits.get('maxFileMb', 10)*1000000, artifact_root=str(settings.artifact_root))
        artifacts = result.get('artifacts', [])
        for artifact in artifacts:
            artifact.setdefault('id', uid())
            for segment in artifact.get('segments', []):
                segment.setdefault('artifact_id', artifact['id'])
        submission.artifacts = artifacts
        submission.public_data = bool(submission.public_data and result.get('public', False))
        submission.git_metadata = {key: value for key, value in result.items() if key != 'artifacts'}
        submission.error = None
        review.integrity = run_integrity_check(submission.artifacts)
        db.commit()
    submission.status = review.status = 'llm_processing'
    db.commit()
    models = [model_python(m) for m in db.scalars(select(ModelEndpoint)).all()]
    # Public models can only receive explicitly declared public demonstration work.
    env = settings.app_env if submission.public_data else 'pilot_sensitive'
    result = await run_review_pipeline(assignment_input(assignment), {'id': rubric.id, 'version': rubric.version, 'criteria': rubric.criteria}, config_input(config), models, submission.artifacts, app_env=env)
    review.criterion_results = [{**c, 'criterion_id': c.get('criterion_id', c.get('id')), 'final_score': None, 'confirmed': False, 'note': ''} for c in result.get('criteria', [])]
    review.annotations = [{**a, 'id': a.get('id') or uid(), 'status': 'pending', 'source': 'ai', 'visible_to_student': True} for a in result.get('annotations', [])]
    if not review.integrity or review.integrity.get('status') == 'mocked':
        review.integrity = run_integrity_check(submission.artifacts)
    review.model_calls = result.get('model_calls', [])
    review.draft_score = result.get('draft_total')
    review.status = submission.status = result.get('status', 'draft_ready')
    submission.error = pipeline_error_message(result['error']) if result.get('error') else None
    if result.get('error'):
        if 'configuration_error' in result['error']: review.status = submission.status = 'configuration_error'
    if review.reviewer_id:
        db.add(Notification(user_id=review.reviewer_id, title='Работа готова к проверке', message=assignment.title, link=f'/review/{review.id}'))
    db.add(AuditEvent(action='review.draft_ready', entity_type='review', entity_id=review.id, payload_safe={'configId': review.agent_config_version_id, 'status': review.status}))
    db.commit()

async def process_eval(db, job):
    from .services.pipeline import run_evaluation
    run = db.get(EvalRun, job.entity_id)
    config = db.get(AgentConfig, run.agent_config_version_id)
    assignment = db.get(Assignment, run.assignment_id)
    rubric = db.scalar(select(Rubric).where(Rubric.assignment_id == assignment.id, Rubric.status == 'published').order_by(Rubric.version.desc()))
    run.status = 'running'
    db.commit()
    examples = [{**r, 'level': r.get('level', r.get('type'))} for r in assignment.references if r.get('type', r.get('level')) in ['weak', 'medium', 'good']]
    tasks = config_input(config)
    if run.model_override_id:
        tasks = {**tasks, 'tasks': {name: {**task, 'model_id': run.model_override_id} for name,task in tasks['tasks'].items()}}
    result = await run_evaluation(assignment_input(assignment), {'id': rubric.id, 'version': rubric.version, 'criteria': rubric.criteria}, tasks, [model_python(m) for m in db.scalars(select(ModelEndpoint)).all()], examples=examples, repetitions=run.repetitions, app_env=settings.app_env)
    run.metrics, run.outputs = result.get('metrics', {}), result.get('outputs', [])
    run.status, run.error = result.get('status', 'completed'), pipeline_error_message(result['error']) if result.get('error') else None
    if run.status == 'completed' and config.status == 'draft': config.status = 'evaluated'
    db.add(AuditEvent(action='eval.completed', entity_type='eval', entity_id=run.id, payload_safe={'status': run.status}))
    db.commit()
