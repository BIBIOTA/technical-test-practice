def test_get_next_question(client, question_id, session_id):
    response = client.get(f"/questions/next?session_id={session_id}&mode=single")

    assert response.status_code == 200
    body = response.json()
    assert "question_id" in body
    assert "question_text" in body
    assert "category" in body
    assert "difficulty" in body
    assert isinstance(body["tags"], list)
    assert "sm2" in body


def test_get_next_question_with_filters(client, question_id, session_id):
    response = client.get(
        f"/questions/next?session_id={session_id}&mode=single&category=backend&difficulty=easy"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["category"] == "backend"
    assert body["difficulty"] == "easy"


def test_get_next_question_no_token(anon_client, session_id):
    response = anon_client.get(f"/questions/next?session_id={session_id}&mode=single")

    assert response.status_code == 401
