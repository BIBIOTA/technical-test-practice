import uuid
from datetime import datetime, timedelta, timezone

import httpx
import psycopg2
import pytest

BASE_URL = "http://localhost:8001"
TOKEN = "test-token"
DB_DSN = "host=localhost port=5433 dbname=interview_practice_test user=interview password=interview"


def db_execute(sql: str, params: tuple = (), fetch: bool = False):
    conn = psycopg2.connect(DB_DSN)
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        rows = cur.fetchall() if fetch else None
        conn.commit()
        cur.close()
        return rows
    finally:
        conn.close()


def insert_question(
    *,
    text: str | None = None,
    category: str = "backend",
    difficulty: str = "easy",
    reference_answer: str = "A strong answer covers the main concepts clearly.",
    tags: list[str] | None = None,
    transcription_keywords: list[str] | None = None,
) -> str:
    q_id = str(uuid.uuid4())
    db_execute(
        "INSERT INTO questions "
        "(id, text, category, difficulty, reference_answer, tags, transcription_keywords)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            q_id,
            text or f"Test question {q_id}",
            category,
            difficulty,
            reference_answer,
            tags or ["test"],
            transcription_keywords or [],
        ),
    )
    return q_id


def insert_sm2_state(
    question_id: str,
    *,
    last_score: int,
    next_review_delta_days: int,
    repetitions: int = 1,
    interval_days: int = 1,
    ease_factor: float = 2.5,
) -> None:
    next_review_at = datetime.now(timezone.utc) + timedelta(days=next_review_delta_days)
    db_execute(
        "INSERT INTO sm2_states "
        "(id, question_id, ease_factor, interval_days, repetitions, next_review_at, last_score) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            str(uuid.uuid4()),
            question_id,
            ease_factor,
            interval_days,
            repetitions,
            next_review_at,
            last_score,
        ),
    )


def get_sm2_state(question_id: str):
    rows = db_execute(
        "SELECT last_score, repetitions, interval_days, ease_factor FROM sm2_states "
        "WHERE question_id = %s",
        (question_id,),
        fetch=True,
    )
    return rows[0] if rows else None


def insert_completed_attempt(
    *,
    session_id: str,
    question_id: str,
    score: int,
    summary: str,
) -> str:
    attempt_id = str(uuid.uuid4())
    db_execute(
        "INSERT INTO attempts "
        "(id, session_id, question_id, transcript, status, score, evaluation, completed_at) "
        "VALUES (%s, %s, %s, %s, 'completed', %s, %s::jsonb, NOW())",
        (
            attempt_id,
            session_id,
            question_id,
            "completed transcript",
            score,
            (
                '{"score": %d, "summary": "%s", "missing_points": [], '
                '"next_focus": [], "provider": "test", "model": "test-model"}'
            )
            % (score, summary),
        ),
    )
    return attempt_id


@pytest.fixture(scope="session")
def client():
    with httpx.Client(
        base_url=BASE_URL,
        headers={"Authorization": f"Bearer {TOKEN}"},
        timeout=10.0,
    ) as c:
        yield c


@pytest.fixture(scope="session")
def anon_client():
    with httpx.Client(base_url=BASE_URL, timeout=10.0) as c:
        yield c


@pytest.fixture(scope="session")
def question_id():
    """Insert a test question directly into the DB and return its UUID."""
    return insert_question(
        text="What is a REST API?",
        category="backend",
        difficulty="easy",
        reference_answer="REST stands for Representational State Transfer. It uses HTTP verbs.",
        tags=["api", "http"],
    )


@pytest.fixture
def question_with_transcription_keywords():
    keywords = ["TDD", "SQLAlchemy", "Alembic"]
    q_id = insert_question(
        text="How do you keep database migrations tested?",
        reference_answer="Use migrations with focused tests and deterministic fixtures.",
        transcription_keywords=keywords,
    )
    return q_id, keywords


@pytest.fixture
def session_id(client):
    response = client.post("/sessions", json={"mode": "single", "eval_provider": "openai"})
    assert response.status_code == 201
    return response.json()["session_id"]
