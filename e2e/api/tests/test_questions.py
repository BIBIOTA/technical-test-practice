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


def test_get_next_question_returns_transcription_keywords(client, question_with_transcription_keywords):
    q_id, keywords = question_with_transcription_keywords
    response = client.get(f"/questions/next?question_id={q_id}&mode=single")

    assert response.status_code == 200
    body = response.json()
    assert body["question_id"] == q_id
    assert body["transcription_keywords"] == keywords


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


def test_get_next_question_by_id(client, question_id):
    response = client.get(f"/questions/next?question_id={question_id}&mode=single")

    assert response.status_code == 200
    body = response.json()
    assert body["question_id"] == question_id
    assert "question_text" in body
    assert "sm2" in body


def test_get_next_question_by_id_not_found(client):
    fake_id = "00000000-0000-0000-0000-000000000000"
    response = client.get(f"/questions/next?question_id={fake_id}&mode=single")

    assert response.status_code == 404


def test_list_questions(client, question_id):
    response = client.get("/questions")

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) >= 1

    ids = [q["question_id"] for q in body]
    assert question_id in ids

    first = next(q for q in body if q["question_id"] == question_id)
    assert "question_text" in first
    assert "category" in first
    assert "difficulty" in first
    assert isinstance(first["tags"], list)
    assert "sm2" in first
    assert "last_score" in first["sm2"]


def test_list_questions_filter_by_category(client, question_id):
    response = client.get("/questions?category=backend")

    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 1
    assert all(q["category"] == "backend" for q in body)


def test_list_questions_filter_by_difficulty(client, question_id):
    response = client.get("/questions?difficulty=easy")

    assert response.status_code == 200
    body = response.json()
    assert len(body) >= 1
    assert all(q["difficulty"] == "easy" for q in body)


def test_list_questions_no_token(anon_client):
    response = anon_client.get("/questions")

    assert response.status_code == 401
