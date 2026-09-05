from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

def uid(): return str(uuid4())
def now(): return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    name: Mapped[str] = mapped_column(String(150))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(24), default='pending')
    account_type: Mapped[str] = mapped_column(String(24), default='employee')
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    course_ids: Mapped[list] = mapped_column(JSON, default=list)
    capacity: Mapped[int] = mapped_column(Integer, default=300)
    available: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class RefreshSession(Base):
    __tablename__ = 'refresh_sessions'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)

class Course(Base):
    __tablename__ = 'courses'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    title: Mapped[str] = mapped_column(String(200))
    run: Mapped[str] = mapped_column(String(100), default='2026')
    owner_expert_id: Mapped[str | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default='active')

class Assignment(Base):
    __tablename__ = 'assignments'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    course_id: Mapped[str] = mapped_column(ForeignKey('courses.id'))
    title: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(40))
    task_text: Mapped[str] = mapped_column(Text, default='')
    due_at: Mapped[str] = mapped_column(String(64), default='')
    review_due_at: Mapped[str] = mapped_column(String(64), default='')
    late_policy: Mapped[dict] = mapped_column(JSON, default=dict)
    references: Mapped[list] = mapped_column(JSON, default=list)
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=30)

class Rubric(Base):
    __tablename__ = 'rubrics'
    __table_args__ = (UniqueConstraint('assignment_id', 'version'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default='draft')
    criteria: Mapped[list] = mapped_column(JSON, default=list)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class AgentConfig(Base):
    __tablename__ = 'agent_configs'
    __table_args__ = (UniqueConstraint('assignment_id', 'version'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default='draft')
    tasks: Mapped[dict] = mapped_column(JSON, default=dict)
    thresholds: Mapped[dict] = mapped_column(JSON, default=lambda: {'abstain': .6, 'critic_confidence': .6})
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ModelEndpoint(Base):
    __tablename__ = 'model_endpoints'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(150))
    provider: Mapped[str] = mapped_column(String(40), default='openai')
    group: Mapped[str] = mapped_column(String(40), default='balanced')
    base_url: Mapped[str] = mapped_column(String(500))
    model_name: Mapped[str] = mapped_column(String(200))
    api_key_env: Mapped[str] = mapped_column(String(100), default='OPENAI_API_KEY')
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    default_params: Mapped[dict] = mapped_column(JSON, default=dict)
    capabilities: Mapped[dict] = mapped_column(JSON, default=dict)
    health: Mapped[str] = mapped_column(String(100), default='unknown')

class Submission(Base):
    __tablename__ = 'submissions'
    __table_args__ = (UniqueConstraint('assignment_id', 'student_id', 'attempt_no'),)
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'))
    student_id: Mapped[str] = mapped_column(ForeignKey('users.id'))
    attempt_no: Mapped[int] = mapped_column(Integer, default=1)
    external_ref: Mapped[str] = mapped_column(String(1000))
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    status: Mapped[str] = mapped_column(String(40), default='submitted')
    artifacts: Mapped[list] = mapped_column(JSON, default=list)
    git_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    public_data: Mapped[bool] = mapped_column(Boolean, default=False)

class Review(Base):
    __tablename__ = 'reviews'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    submission_id: Mapped[str] = mapped_column(ForeignKey('submissions.id'), index=True)
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey('users.id'), nullable=True)
    rubric_id: Mapped[str] = mapped_column(ForeignKey('rubrics.id'))
    agent_config_version_id: Mapped[str | None] = mapped_column(ForeignKey('agent_configs.id'), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default='submitted')
    criterion_results: Mapped[list] = mapped_column(JSON, default=list)
    annotations: Mapped[list] = mapped_column(JSON, default=list)
    integrity: Mapped[dict] = mapped_column(JSON, default=lambda: {'status': 'mocked', 'signals': []})
    model_calls: Mapped[list] = mapped_column(JSON, default=list)
    draft_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    late_penalty_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str] = mapped_column(Text, default='')
    revision: Mapped[int] = mapped_column(Integer, default=0)
    feedback_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active_seconds: Mapped[float] = mapped_column(Float, default=0)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    opened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class EvalRun(Base):
    __tablename__ = 'eval_runs'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'))
    agent_config_version_id: Mapped[str] = mapped_column(ForeignKey('agent_configs.id'))
    model_override_id: Mapped[str | None] = mapped_column(ForeignKey('model_endpoints.id'), nullable=True)
    repetitions: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(40), default='queued')
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    outputs: Mapped[list] = mapped_column(JSON, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Job(Base):
    __tablename__ = 'jobs'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(40), default='queued')
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class AuditEvent(Base):
    __tablename__ = 'audit_events'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    actor_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(64))
    payload_safe: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Notification(Base):
    __tablename__ = 'notifications'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    link: Mapped[str] = mapped_column(String(300), default='')
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)

class Idempotency(Base):
    __tablename__ = 'idempotency_keys'
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)

class RubricFlag(Base):
    __tablename__ = 'rubric_flags'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'))
    review_id: Mapped[str] = mapped_column(ForeignKey('reviews.id'))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(24), default='pending')

class PlatformSetting(Base):
    __tablename__ = 'platform_settings'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default='global')
    values: Mapped[dict] = mapped_column(JSON, default=lambda: {'maxPrFiles': 100, 'maxPrBytes': 10000000, 'weeklyCapacityMinutes': 300})

class SimilarityRun(Base):
    __tablename__ = 'similarity_runs'
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    assignment_id: Mapped[str] = mapped_column(ForeignKey('assignments.id'), index=True)
    created_by: Mapped[str] = mapped_column(ForeignKey('users.id'))
    status: Mapped[str] = mapped_column(String(24), default='queued')
    language: Mapped[str] = mapped_column(String(24))
    submission_ids: Mapped[list] = mapped_column(JSON, default=list)
    results: Mapped[dict] = mapped_column(JSON, default=dict)
    decisions: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
