import uuid


def test_create_session(client):
    response = client.post("/sessions", json={"mode": "single", "eval_provider": "openai"})

    assert response.status_code == 201
    body = response.json()
    assert "session_id" in body
    assert body["mode"] == "single"
    assert body["eval_provider"] == "openai"
    assert body["status"] == "active"


def test_create_session_no_token(anon_client):
    response = anon_client.post("/sessions", json={"mode": "single", "eval_provider": "openai"})

    assert response.status_code == 401


def test_create_session_wrong_token(anon_client):
    response = anon_client.post(
        "/sessions",
        json={"mode": "single", "eval_provider": "openai"},
        headers={"Authorization": "Bearer wrong-token"},
    )

    assert response.status_code == 401


def test_complete_session(client, session_id):
    response = client.post(f"/sessions/{session_id}/complete")

    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_complete_session_not_found(client):
    response = client.post(f"/sessions/{uuid.uuid4()}/complete")

    assert response.status_code == 404


def test_session_summary(client, session_id):
    response = client.get(f"/sessions/{session_id}/summary")

    assert response.status_code == 200
    body = response.json()
    assert "total_questions" in body
    assert "average_score" in body
    assert isinstance(body["attempts"], list)


def test_session_summary_not_found(client):
    response = client.get(f"/sessions/{uuid.uuid4()}/summary")

    assert response.status_code == 404
