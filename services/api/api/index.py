"""Vercel ASGI entry. Cloud mode without PostgreSQL serves only public catalog/status."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('APP_ENV', 'production')
from app.main import app
