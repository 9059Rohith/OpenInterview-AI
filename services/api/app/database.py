from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import Request


def make_engine(url):
    options = {'pool_pre_ping': True}
    if url.startswith('sqlite'):
        options['connect_args'] = {'check_same_thread': False, 'timeout': 30}
        if ':memory:' in url: options['poolclass'] = StaticPool
    engine = create_engine(url, **options)
    if url.startswith('sqlite'):
        @event.listens_for(engine, 'connect')
        def configure(dbapi_connection, _):
            dbapi_connection.execute('PRAGMA foreign_keys=ON')
            dbapi_connection.execute('PRAGMA busy_timeout=30000')
    return engine


def migrate(engine):
    from alembic import command
    from alembic.config import Config
    from .config import ROOT
    config = Config(str(ROOT / 'alembic.ini'))
    config.set_main_option('script_location', str(ROOT / 'alembic'))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')


def get_db(request: Request):
    with request.app.state.sessions() as db:
        yield db
