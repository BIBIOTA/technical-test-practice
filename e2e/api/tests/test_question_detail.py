import uuid

import pytest

from .conftest import db_execute, insert_question


@pytest.fixture(scope="module")
def detail_question_id():
    q_id = insert_question(
        text="What is dependency injection?",
        category="backend",
        difficulty="medium",
        reference_answer="Dependency injection is a technique where dependencies are provided externally.",
        tags=["di", "backend", "patterns"],
    )
    db_execute(
        "UPDATE questions SET key_points = %s::jsonb, common_mistakes = %s WHERE id = %s",
        (
            '[{"point": "Define DI", "weight": 0.5}, {"point": "Compare with service locator", "weight": 0.5}]',
            ["Confusing DI with service locator", "Not mentioning testability benefits"],
            q_id,
        ),
    )
    return q_id


def test_existing_question_returned(client, detail_question_id):
    response = client.get(f"/questions/{detail_question_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["question_id"] == detail_question_id
    assert body["question_text"] == "What is dependency injection?"
    assert body["category"] == "backend"
    assert body["difficulty"] == "medium"
    assert isinstance(body["tags"], list)
    assert "di" in body["tags"]
    assert "reference_answer" in body
    assert body["reference_answer"].startswith("Dependency injection")
    assert isinstance(body["key_points"], list)
    assert len(body["key_points"]) == 2
    assert isinstance(body["common_mistakes"], list)
    assert len(body["common_mistakes"]) == 2


def test_nonexistent_question(client):
    fake_id = str(uuid.uuid4())
    response = client.get(f"/questions/{fake_id}")

    assert response.status_code == 404
    assert response.json() == {"detail": "Question not found"}


def test_malformed_question_id(client):
    response = client.get("/questions/not-a-uuid")

    assert response.status_code == 422


def test_unauthorized_request(anon_client, detail_question_id):
    response = anon_client.get(f"/questions/{detail_question_id}")

    assert response.status_code == 401
