from celery import Celery
from .config import settings

app = Celery('reviewer', broker=settings.redis_url, backend=settings.redis_url)
app.conf.update(task_serializer='json', result_serializer='json', accept_content=['json'], task_acks_late=True, worker_prefetch_multiplier=1, broker_connection_retry_on_startup=True)

@app.task(bind=True, name='execute_job', autoretry_for=(ConnectionError,), retry_backoff=True, max_retries=3)
def execute_job(self, job_id):
    from .jobs import run_job
    if self.request.delivery_info.get('redelivered'):
        from .db import SessionLocal
        from .models import Job
        with SessionLocal() as db:
            job=db.get(Job,job_id)
            if job and job.status=='running': job.status='queued'; db.commit()
    run_job(job_id)
