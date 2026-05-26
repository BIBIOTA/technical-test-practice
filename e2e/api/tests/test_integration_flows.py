import time
import uuid

from tests.conftest import (
    get_sm2_state,
    insert_completed_attempt,
    insert_question,
    insert_sm2_state,
)


def poll_completed(client, attempt_id: str, timeout_seconds: float = 10.0):
    deadline = time.monotonic() + timeout_seconds
    last_body = None
    while time.monotonic() < deadline:
        response = client.get(f"/attempts/{attempt_id}/result")
        assert response.status_code == 200
        last_body = response.json()
        if last_body["status"] in {"completed", "failed"}:
            return last_body
        time.sleep(0.25)
    raise AssertionError(f"attempt did not finish in time: {last_body}")


def test_single_question_flow_completes_evaluation_and_updates_sm2(client):
    question_id = insert_question(
        text="Explain idempotency in REST APIs.",
        reference_answer="Idempotent operations can be repeated without changing the result.",
        tags=["flow"],
    )
    session = client.post("/sessions", json={"mode": "single", "eval_provider": "openai"})
    assert session.status_code == 201
    session_id = session.json()["session_id"]

    next_question = client.get(f"/questions/next?session_id={session_id}&mode=single")
    assert next_question.status_code == 200

    attempt = client.post(
        "/attempts",
        json={
            "session_id": session_id,
            "question_id": question_id,
            "transcript": (
                "Idempotency means retrying the same request produces the same server state, "
                "which is why GET and PUT are usually idempotent."
            ),
        },
    )
    assert attempt.status_code == 202

    result = poll_completed(client, attempt.json()["attempt_id"])
    assert result["status"] == "completed"
    assert result["score"] is not None
    assert result["evaluation"]["provider"] == "openai"
    assert set(result["evaluation"]) == {
        "score",
        "summary",
        "missing_points",
        "next_focus",
        "provider",
        "model",
    }

    summary = client.get(f"/attempts/{attempt.json()['attempt_id']}/summary")
    assert summary.status_code == 200
    assert "provider" not in summary.json()
    assert get_sm2_state(question_id)[0] == result["score"]

    completed = client.post(f"/sessions/{session_id}/complete")
    assert completed.status_code == 200
    assert completed.json()["status"] == "completed"


def test_sm2_priority_and_session_deduplication(client):
    category = f"priority-flow-{uuid.uuid4()}"
    new_question = insert_question(category=category, text="New question")
    due_low = insert_question(category=category, text="Due low score")
    due_high = insert_question(category=category, text="Due high score")
    future_low = insert_question(category=category, text="Future low score")
    insert_sm2_state(due_low, last_score=35, next_review_delta_days=-2)
    insert_sm2_state(due_high, last_score=85, next_review_delta_days=-1)
    insert_sm2_state(future_low, last_score=20, next_review_delta_days=5)

    session = client.post("/sessions", json={"mode": "mock", "eval_provider": "openai"})
    assert session.status_code == 201
    session_id = session.json()["session_id"]

    first = client.get(f"/questions/next?session_id={session_id}&mode=mock&category={category}")
    assert first.status_code == 200
    assert first.json()["question_id"] == new_question

    insert_completed_attempt(
        session_id=session_id,
        question_id=new_question,
        score=80,
        summary="covered",
    )

    second = client.get(f"/questions/next?session_id={session_id}&mode=mock&category={category}")
    assert second.status_code == 200
    assert second.json()["question_id"] == due_low
    assert second.json()["question_id"] != new_question


def test_weak_review_returns_only_due_low_score_questions(client):
    category = f"weak-review-flow-{uuid.uuid4()}"
    due_low = insert_question(category=category, text="Due weak")
    due_high = insert_question(category=category, text="Due strong")
    future_low = insert_question(category=category, text="Future weak")
    insert_sm2_state(due_low, last_score=42, next_review_delta_days=-1)
    insert_sm2_state(due_high, last_score=88, next_review_delta_days=-1)
    insert_sm2_state(future_low, last_score=30, next_review_delta_days=2)

    session = client.post("/sessions", json={"mode": "weak_review", "eval_provider": "openai"})
    assert session.status_code == 201
    session_id = session.json()["session_id"]

    response = client.get(
        f"/questions/next?session_id={session_id}&mode=weak_review&category={category}"
    )

    assert response.status_code == 200
    assert response.json()["question_id"] == due_low


def test_session_summary_reports_completed_mock_attempts(client):
    q1 = insert_question(category="summary-flow", text="Summary q1")
    q2 = insert_question(category="summary-flow", text="Summary q2")
    session = client.post("/sessions", json={"mode": "mock", "eval_provider": "openai"})
    assert session.status_code == 201
    session_id = session.json()["session_id"]
    insert_completed_attempt(session_id=session_id, question_id=q1, score=70, summary="first")
    insert_completed_attempt(session_id=session_id, question_id=q2, score=90, summary="second")
    client.post(f"/sessions/{session_id}/complete")

    response = client.get(f"/sessions/{session_id}/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "mock"
    assert body["status"] == "completed"
    assert body["total_questions"] == 2
    assert body["average_score"] == 80.0
    assert [attempt["summary"] for attempt in body["attempts"]] == ["first", "second"]


def test_all_evaluation_providers_complete_with_fixed_schema(client):
    required_fields = {
        "score",
        "summary",
        "missing_points",
        "next_focus",
        "ideal_answer",
        "provider",
        "model",
    }

    for provider in ["openai", "claude", "gemini"]:
        question_id = insert_question(
            category=f"provider-{provider}",
            text=f"Provider test for {provider}",
            reference_answer="A complete answer mentions tradeoffs and examples.",
        )
        session = client.post("/sessions", json={"mode": "single", "eval_provider": provider})
        assert session.status_code == 201

        attempt = client.post(
            "/attempts",
            json={
                "session_id": session.json()["session_id"],
                "question_id": question_id,
                "transcript": "The answer includes tradeoffs, examples, and a clear conclusion.",
            },
        )
        assert attempt.status_code == 202

        result = poll_completed(client, attempt.json()["attempt_id"])
        assert result["status"] == "completed"
        assert set(result["evaluation"]) == required_fields
        assert result["evaluation"]["provider"] == provider
        assert 0 <= result["evaluation"]["score"] <= 100
        assert "離線模式" in result["evaluation"]["summary"]
        assert isinstance(result["evaluation"]["missing_points"], list)
        assert isinstance(result["evaluation"]["next_focus"], list)
        assert isinstance(result["evaluation"]["ideal_answer"], str)
