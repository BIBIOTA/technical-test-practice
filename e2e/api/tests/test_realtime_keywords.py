import uuid

from .conftest import insert_question


def test_client_secret_accepts_pinned_question_id(client, session_id):
    q_id = insert_question(
        text="Keyword test question",
        transcription_keywords=["innerHTML", "DOMPurify"],
    )

    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id, "pinned_question_id": q_id},
    )
    # Either the OpenAI call succeeds (200 with a client_secret) or it fails
    # at the upstream API (502). What MUST NOT happen is a 422 (schema reject)
    # or 404 (question lookup fail).
    assert response.status_code in (200, 502), response.text


def test_client_secret_returns_404_for_unknown_pinned_question_id(client, session_id):
    fake_id = str(uuid.uuid4())
    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id, "pinned_question_id": fake_id},
    )
    assert response.status_code == 404


def test_client_secret_still_works_without_pinned_question_id(client, session_id):
    response = client.post(
        "/realtime/client-secret",
        json={"session_id": session_id},
    )
    assert response.status_code in (200, 502), response.text


def test_next_question_response_includes_transcription_keywords(client, session_id):
    q_id = insert_question(
        text="Another keyword test",
        transcription_keywords=["dangerouslySetInnerHTML"],
    )
    response = client.get(f"/questions/next?question_id={q_id}&mode=single")
    assert response.status_code == 200
    body = response.json()
    assert body["transcription_keywords"] == ["dangerouslySetInnerHTML"]
