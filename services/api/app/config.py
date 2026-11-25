"""Configuration only reads server-owned secrets. Client keys are never accepted."""
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    database_url: str = field(default_factory=lambda: os.getenv('DATABASE_URL', 'sqlite:///./openinterview.db').replace('postgres://', 'postgresql+psycopg://', 1).replace('postgresql://', 'postgresql+psycopg://', 1))
    mode: str = field(default_factory=lambda: os.getenv('APP_MODE', 'cloud' if os.getenv('APP_ENV') == 'production' or os.getenv('VERCEL') else 'local'))
    secure_cookies: bool = field(default_factory=lambda: os.getenv('COOKIE_SECURE', 'false').lower() == 'true')
    origins: list[str] = field(default_factory=lambda: [s.strip() for s in os.getenv('ALLOWED_ORIGINS', os.getenv('CORS_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000,oi://app')).split(',') if s.strip()])
    session_days: int = 14
    max_body: int = 12 * 1024 * 1024
    google_id: str = field(default_factory=lambda: os.getenv('GOOGLE_CLIENT_ID', ''))
    google_secret: str = field(default_factory=lambda: os.getenv('GOOGLE_CLIENT_SECRET', ''))
    google_redirect: str = field(default_factory=lambda: os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:8000/api/v1/auth/google/callback'))
    frontend_url: str = field(default_factory=lambda: os.getenv('FRONTEND_URL', 'http://localhost:3000'))
    razorpay_id: str = field(default_factory=lambda: os.getenv('RAZORPAY_KEY_ID', ''))
    razorpay_secret: str = field(default_factory=lambda: os.getenv('RAZORPAY_KEY_SECRET', ''))
    webhook_secret: str = field(default_factory=lambda: os.getenv('RAZORPAY_WEBHOOK_SECRET', ''))
    runner_url: str = field(default_factory=lambda: os.getenv('ISOLATED_RUNNER_URL', os.getenv('CODE_RUNNER_URL', '')))
    runner_token: str = field(default_factory=lambda: os.getenv('ISOLATED_RUNNER_TOKEN', os.getenv('CODE_RUNNER_TOKEN', '')))
    auto_migrate: bool = field(default_factory=lambda: os.getenv('AUTO_MIGRATE', 'true').lower() == 'true')

    def validate(self):
        if self.mode not in {'local', 'cloud'}:
            raise ValueError('APP_MODE must be local or cloud')
        if '*' in self.origins:
            raise ValueError('Credentialed CORS requires explicit origins')
        if self.mode == 'cloud' and not self.secure_cookies:
            raise ValueError('Cloud mode requires COOKIE_SECURE=true')
        if self.mode == 'cloud' and os.getenv('DATABASE_URL') and not self.database_url.startswith('postgresql+psycopg://'):
            raise ValueError('Cloud account storage requires PostgreSQL')


ROOT = Path(__file__).resolve().parents[1]
