import uuid


def test_create_attempt(client, session_id, question_id):
    response = client.post(
        "/attempts",
        json={
            "session_id": session_id,
            "question_id": question_id,
            "transcript": "A REST API uses HTTP methods to interact with resources.",
        },
    )

    assert response.status_code == 202
    body = response.json()
    assert "attempt_id" in body
    assert body["status"] == "pending_evaluation"
    assert body["transcript"] == "A REST API uses HTTP methods to interact with resources."


def test_get_attempt_result(client, session_id, question_id):
    create = client.post(
        "/attempts",
        json={
            "session_id": session_id,
            "question_id": question_id,
            "transcript": "REST uses HTTP verbs like GET and POST.",
        },
    )
    assert create.status_code == 202
    attempt_id = create.json()["attempt_id"]

    result = client.get(f"/attempts/{attempt_id}/result")

    assert result.status_code == 200
    body = result.json()
    assert body["attempt_id"] == attempt_id
    assert "status" in body


def test_get_attempt_result_not_found(client):
    response = client.get(f"/attempts/{uuid.uuid4()}/result")

    assert response.status_code == 404


def test_create_attempt_no_token(anon_client, session_id, question_id):
    response = anon_client.post(
        "/attempts",
        json={"session_id": session_id, "question_id": question_id},
    )

    assert response.status_code == 401
