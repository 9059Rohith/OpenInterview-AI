from alembic import context
from sqlalchemy import engine_from_config, pool
from app.models import Base
from app.config import Settings

config = context.config
target_metadata = Base.metadata


def run(connection):
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True, render_as_batch=connection.dialect.name == 'sqlite')
    with context.begin_transaction(): context.run_migrations()


if context.is_offline_mode():
    context.configure(url=Settings().database_url, target_metadata=target_metadata, literal_binds=True, dialect_opts={'paramstyle': 'named'})
    with context.begin_transaction(): context.run_migrations()
elif config.attributes.get('connection') is not None:
    run(config.attributes['connection'])
else:
    config.set_main_option('sqlalchemy.url', Settings().database_url.replace('%', '%%'))
    engine = engine_from_config(config.get_section(config.config_ini_section), prefix='sqlalchemy.', poolclass=pool.NullPool)
    with engine.connect() as connection: run(connection)
