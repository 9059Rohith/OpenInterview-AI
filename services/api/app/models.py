"""Normalized ownership schema. JSON is reserved for editable structured content."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, Boolean, Float, ForeignKey, UniqueConstraint, JSON, Index
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def uid(): return str(uuid.uuid4())
def now(): return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase): pass


class Record:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    updated_at: Mapped[str] = mapped_column(String(40), default=now, onupdate=now)


class User(Record, Base):
    __tablename__ = 'users'
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)


class Owned(Record):
    owner_id: Mapped[str] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)


class Profile(Owned, Base):
    __tablename__ = 'profiles'
    __table_args__ = (UniqueConstraint('owner_id'),)
    name: Mapped[str] = mapped_column(String(120), default='')
    role: Mapped[str] = mapped_column(String(120), default='')
    experience: Mapped[str] = mapped_column(String(120), default='')
    language: Mapped[str] = mapped_column(String(40), default='English')
    companies: Mapped[list] = mapped_column(JSON, default=list)
    education: Mapped[list] = mapped_column(JSON, default=list)
    resume_text: Mapped[str] = mapped_column(Text, default='')
    consent_cloud: Mapped[bool] = mapped_column(Boolean, default=False)


class Skill(Owned, Base):
    __tablename__ = 'skills'
    __table_args__ = (UniqueConstraint('owner_id', 'name'),)
    name: Mapped[str] = mapped_column(String(120))


class Project(Owned, Base):
    __tablename__ = 'projects'
    content: Mapped[dict] = mapped_column(JSON, default=dict)


class Preference(Owned, Base):
    __tablename__ = 'user_preferences'
    __table_args__ = (UniqueConstraint('owner_id'),)
    content: Mapped[dict] = mapped_column(JSON, default=dict)


class Device(Owned, Base):
    __tablename__ = 'devices'
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(80), default='Browser')
    expires_at: Mapped[str] = mapped_column(String(40))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class OAuthState(Record, Base):
    __tablename__ = 'oauth_states'
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    verifier: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[str] = mapped_column(String(40))


class RecoveryToken(Owned, Base):
    __tablename__ = 'recovery_tokens'
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[str] = mapped_column(String(40))
    used: Mapped[bool] = mapped_column(Boolean, default=False)


class Document(Owned, Base):
    __tablename__ = 'documents'
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(40), default='text/plain')
    text: Mapped[str] = mapped_column(Text)
    consent_cloud: Mapped[bool] = mapped_column(Boolean, default=False)


class Resume(Owned, Base):
    __tablename__ = 'resumes'
    name: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column(Text)
    sections: Mapped[dict] = mapped_column(JSON, default=dict)
    consent_cloud: Mapped[bool] = mapped_column(Boolean, default=False)


class ResumeVersion(Owned, Base):
    __tablename__ = 'resume_versions'
    __table_args__ = (UniqueConstraint('resume_id', 'version'),)
    resume_id: Mapped[str] = mapped_column(ForeignKey('resumes.id', ondelete='CASCADE'), index=True)
    version: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    sections: Mapped[dict] = mapped_column(JSON, default=dict)


class Company(Record, Base):
    __tablename__ = 'companies'
    name: Mapped[str] = mapped_column(String(120), unique=True)
    overview: Mapped[str] = mapped_column(Text, default='Illustrative preparation topics; not a verified hiring process.')


class Role(Record, Base):
    __tablename__ = 'roles'
    company_id: Mapped[str] = mapped_column(ForeignKey('companies.id', ondelete='CASCADE'), index=True)
    name: Mapped[str] = mapped_column(String(120))
    skills: Mapped[list] = mapped_column(JSON, default=list)


class QuestionSource(Record, Base):
    __tablename__ = 'question_sources'
    title: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(Text, default='')
    confidence: Mapped[str] = mapped_column(String(40), default='original')


class Question(Record, Base):
    __tablename__ = 'questions'
    owner_id: Mapped[str | None] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    company: Mapped[str] = mapped_column(String(120), default='General')
    role: Mapped[str] = mapped_column(String(120), default='Software Engineer')
    topic: Mapped[str] = mapped_column(String(120), index=True)
    difficulty: Mapped[str] = mapped_column(String(40), default='Intermediate')
    question: Mapped[str] = mapped_column(Text)
    expected_concepts: Mapped[list] = mapped_column(JSON, default=list)
    sample_answer: Mapped[str] = mapped_column(Text, default='')
    follow_ups: Mapped[list] = mapped_column(JSON, default=list)
    source_id: Mapped[str] = mapped_column(ForeignKey('question_sources.id'))
    original: Mapped[bool] = mapped_column(Boolean, default=True)


class QuestionReport(Owned, Base):
    __tablename__ = 'question_reports'
    question_id: Mapped[str] = mapped_column(ForeignKey('questions.id', ondelete='CASCADE'), index=True)
    reason: Mapped[str] = mapped_column(Text)


class Bookmark(Owned, Base):
    __tablename__ = 'bookmarks'
    __table_args__ = (UniqueConstraint('owner_id', 'question_id'),)
    question_id: Mapped[str] = mapped_column(ForeignKey('questions.id', ondelete='CASCADE'))


class InterviewSession(Owned, Base):
    __tablename__ = 'interview_sessions'
    title: Mapped[str] = mapped_column(String(200), default='Practice session')
    mode: Mapped[str] = mapped_column(String(20), default='Light Mode')
    category: Mapped[str] = mapped_column(String(80), default='Technical')
    company: Mapped[str] = mapped_column(String(120), default='General')
    role: Mapped[str] = mapped_column(String(120), default='Software Engineer')
    difficulty: Mapped[str] = mapped_column(String(40), default='Intermediate')
    status: Mapped[str] = mapped_column(String(40), default='active')
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_cloud: Mapped[bool] = mapped_column(Boolean, default=False)


class MockInterview(Owned, Base):
    __tablename__ = 'mock_interviews'
    session_id: Mapped[str] = mapped_column(ForeignKey('interview_sessions.id', ondelete='CASCADE'), unique=True)
    question_ids: Mapped[list] = mapped_column(JSON, default=list)
    cursor: Mapped[int] = mapped_column(Integer, default=0)


class Turn(Owned, Base):
    __tablename__ = 'transcripts'
    session_id: Mapped[str] = mapped_column(ForeignKey('interview_sessions.id', ondelete='CASCADE'), index=True)
    speaker: Mapped[str] = mapped_column(String(20))
    text: Mapped[str] = mapped_column(Text)
    evaluation: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class SessionNote(Owned, Base):
    __tablename__ = 'session_notes'
    session_id: Mapped[str] = mapped_column(ForeignKey('interview_sessions.id', ondelete='CASCADE'), unique=True)
    text: Mapped[str] = mapped_column(Text, default='')
    summary: Mapped[dict] = mapped_column(JSON, default=dict)


class AIResponse(Owned, Base):
    __tablename__ = 'ai_responses'
    session_id: Mapped[str | None] = mapped_column(ForeignKey('interview_sessions.id', ondelete='SET NULL'), nullable=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    # Metadata only: private prompts and completions are not retained implicitly.
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)


class Roadmap(Owned, Base):
    __tablename__ = 'learning_roadmaps'
    title: Mapped[str] = mapped_column(String(200))


class RoadmapItem(Record, Base):
    __tablename__ = 'roadmap_items'
    roadmap_id: Mapped[str] = mapped_column(ForeignKey('learning_roadmaps.id', ondelete='CASCADE'), index=True)
    topic: Mapped[str] = mapped_column(String(200))
    due_date: Mapped[str] = mapped_column(String(40), default='')
    completed: Mapped[bool] = mapped_column(Boolean, default=False)


class Progress(Owned, Base):
    __tablename__ = 'progress_records'
    topic: Mapped[str] = mapped_column(String(120))
    score: Mapped[float] = mapped_column(Float)
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)


class Subscription(Owned, Base):
    __tablename__ = 'subscriptions'
    provider_id: Mapped[str] = mapped_column(String(120), unique=True)
    plan: Mapped[str] = mapped_column(String(20))
    currency: Mapped[str] = mapped_column(String(3))
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(40), default='created')
    current_end: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_event_at: Mapped[int] = mapped_column(Integer, default=0)
    pending_plan: Mapped[str | None] = mapped_column(String(20), nullable=True)
    pending_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Payment(Owned, Base):
    __tablename__ = 'payments'
    provider_id: Mapped[str] = mapped_column(String(120), unique=True)
    subscription_id: Mapped[str] = mapped_column(ForeignKey('subscriptions.id'), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    status: Mapped[str] = mapped_column(String(40))
    invoice_id: Mapped[str | None] = mapped_column(String(120), nullable=True)


class PaymentEvent(Record, Base):
    __tablename__ = 'payment_events'
    provider_event_id: Mapped[str] = mapped_column(String(128), unique=True)
    body_hash: Mapped[str] = mapped_column(String(64))
    event_type: Mapped[str] = mapped_column(String(80))


class Usage(Owned, Base):
    __tablename__ = 'usage_records'
    __table_args__ = (UniqueConstraint('owner_id', 'period', 'kind'),)
    period: Mapped[str] = mapped_column(String(16))
    kind: Mapped[str] = mapped_column(String(40))
    count: Mapped[int] = mapped_column(Integer, default=0)


class Metric(Record, Base):
    __tablename__ = 'sanitized_metrics'
    route: Mapped[str] = mapped_column(String(180), index=True)
    status: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[int] = mapped_column(Integer)


class RateBucket(Base):
    __tablename__ = 'rate_limit_buckets'
    key_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(Integer, primary_key=True)
    expires_at: Mapped[int] = mapped_column(Integer, index=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
