from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.database import make_engine


def test_database_error_does_not_display_private_bound_values():
    engine = make_engine('sqlite:///:memory:')
    private_fixture = 'synthetic-private-resume-and-transcript-content'
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE privacy_fixture (value TEXT UNIQUE)'))
        connection.execute(text('INSERT INTO privacy_fixture (value) VALUES (:value)'), {'value': private_fixture})
    try:
        with engine.begin() as connection:
            connection.execute(text('INSERT INTO privacy_fixture (value) VALUES (:value)'), {'value': private_fixture})
    except IntegrityError as error:
        assert private_fixture not in str(error)
        assert 'hidden' in str(error)
    else:
        raise AssertionError('The duplicate fixture must exercise an actual database error')
    finally:
        engine.dispose()
