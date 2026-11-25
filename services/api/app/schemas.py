from typing import Literal, Any
from pydantic import BaseModel, ConfigDict, Field, EmailStr, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Register(Strict):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(min_length=1, max_length=120)


class Login(Strict):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RecoveryRequest(Strict): email: EmailStr
class RecoveryConfirm(Strict):
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=12, max_length=128)


class ProfileIn(Strict):
    name: str = Field(default='', max_length=120)
    role: str = Field(default='', max_length=120)
    experience: str = Field(default='', max_length=120)
    language: str = Field(default='English', max_length=40)
    companies: list[str] = Field(default_factory=list, max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=100)
    education: list[dict[str, Any]] = Field(default_factory=list, max_length=30)
    projects: list[dict[str, Any]] = Field(default_factory=list, max_length=50)
    resumeText: str = Field(default='', max_length=200000)
    consentCloud: bool = False


class DocumentIn(Strict):
    name: str = Field(min_length=1, max_length=200)
    type: str = Field(default='text/plain', max_length=40)
    text: str = Field(default='', max_length=500000)
    consentCloud: bool = False


class ResumeIn(Strict):
    name: str = Field(min_length=1, max_length=200)
    text: str = Field(default='', max_length=200000)
    sections: dict[str, Any] = Field(default_factory=dict)
    consentCloud: bool = False


class Analyze(Strict):
    text: str = Field(min_length=1, max_length=200000)
    job_description: str = Field(default='', max_length=100000)
    consentCloud: bool = False


class SourceIn(Strict):
    title: str = Field(default='User contribution', max_length=200)
    url: str = Field(default='', max_length=2000)
    confidence: Literal['original', 'unverified', 'verified'] = 'unverified'

    @field_validator('url')
    @classmethod
    def safe_url(cls, value):
        if value and not value.startswith(('https://', 'http://')):
            raise ValueError('Source URL must use HTTP(S)')
        return value


class QuestionIn(Strict):
    company: str = Field(default='General', max_length=120)
    role: str = Field(default='Software Engineer', max_length=120)
    topic: str = Field(min_length=1, max_length=120)
    difficulty: Literal['Beginner', 'Intermediate', 'Advanced'] = 'Intermediate'
    question: str = Field(min_length=10, max_length=10000)
    expectedConcepts: list[str] = Field(default_factory=list, max_length=50)
    sampleAnswer: str = Field(default='', max_length=30000)
    followUps: list[str] = Field(default_factory=list, max_length=30)
    source: SourceIn = Field(default_factory=SourceIn)
    original: bool = False


class ReportIn(Strict): reason: str = Field(min_length=5, max_length=2000)
class SessionIn(Strict):
    title: str = Field(default='Practice session', min_length=1, max_length=200)
    mode: Literal['Light Mode', 'Shadow Mode'] = 'Light Mode'
    category: str = Field(default='Technical', max_length=80)
    company: str = Field(default='General', max_length=120)
    role: str = Field(default='Software Engineer', max_length=120)
    difficulty: Literal['Beginner', 'Intermediate', 'Advanced'] = 'Intermediate'
    status: Literal['active', 'completed', 'paused'] = 'active'
    notes: str = Field(default='', max_length=100000)
    archived: bool = False
    consentCloud: bool = False


class SessionPatch(Strict):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    status: Literal['active', 'completed', 'paused'] | None = None
    notes: str | None = Field(default=None, max_length=100000)
    archived: bool | None = None


class TurnIn(Strict):
    speaker: Literal['user', 'assistant', 'transcript']
    text: str = Field(min_length=1, max_length=50000)
    consentCloud: bool = False


class RoadmapItemIn(Strict):
    id: str | None = None
    topic: str = Field(min_length=1, max_length=200)
    dueDate: str = Field(default='', max_length=40)
    completed: bool = False


class RoadmapIn(Strict):
    title: str = Field(min_length=1, max_length=200)
    items: list[RoadmapItemIn] = Field(default_factory=list, max_length=200)


class ContextDocument(Strict):
    id: str = Field(max_length=120)
    text: str = Field(max_length=200000)


class ContextIn(Strict):
    query: str = Field(max_length=10000)
    documents: list[ContextDocument] = Field(max_length=100)
    budget: int = Field(default=4000, ge=32, le=16000)
    consentCloud: bool = False


class Message(Strict):
    role: Literal['system', 'user', 'assistant']
    content: str = Field(min_length=1, max_length=60000)


class Generate(Strict):
    provider: Literal['openai', 'gemini', 'claude', 'compatible', 'ollama']
    model: str = Field(min_length=1, max_length=120, pattern=r'^[\w.\-/:]+$')
    messages: list[Message] = Field(min_length=1, max_length=80)
    max_tokens: int = Field(default=1024, ge=1, le=4096)
    temperature: float = Field(default=0.5, ge=0, le=2)
    consentCloud: bool = False


class Checkout(Strict):
    plan: Literal['plus', 'pro']
    currency: Literal['INR', 'USD'] = 'INR'


class Verify(Strict):
    razorpay_payment_id: str = Field(pattern=r'^pay_[A-Za-z0-9]+$', max_length=120)
    razorpay_subscription_id: str = Field(pattern=r'^sub_[A-Za-z0-9]+$', max_length=120)
    razorpay_signature: str = Field(pattern=r'^[a-fA-F0-9]{64}$')


class CodeRun(Strict):
    language: Literal['c', 'cpp', 'python', 'java', 'javascript', 'typescript']
    code: str = Field(min_length=1, max_length=100000)
    stdin: str = Field(default='', max_length=10000)
    tests: list[dict[str, Any]] = Field(default_factory=list, max_length=50)

    @field_validator('tests')
    @classmethod
    def bounded_tests(cls, value):
        import json
        if len(json.dumps(value).encode('utf-8')) > 200000:
            raise ValueError('Combined test inputs must not exceed 200000 bytes')
        return value


class MockAnswer(Strict):
    text: str = Field(min_length=1, max_length=30000)
    consentCloud: bool = False
