import uuid

import httpx
import psycopg2
import pytest

BASE_URL = "http://localhost:8001"
TOKEN = "test-token"
DB_DSN = "host=localhost port=5433 dbname=interview_practice_test user=interview password=interview"


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
    conn = psycopg2.connect(DB_DSN)
    cur = conn.cursor()
    q_id = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO questions (id, text, category, difficulty, reference_answer, tags)"
        " VALUES (%s, %s, %s, %s, %s, %s)",
        (
            q_id,
            "What is a REST API?",
            "backend",
            "easy",
            "REST stands for Representational State Transfer. It uses HTTP verbs.",
            ["api", "http"],
        ),
    )
    conn.commit()
    cur.close()
    conn.close()
    return q_id


@pytest.fixture
def session_id(client):
    response = client.post("/sessions", json={"mode": "single", "eval_provider": "openai"})
    assert response.status_code == 201
    return response.json()["session_id"]
