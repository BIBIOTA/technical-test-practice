import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sm2_state import SM2State


def score_to_grade(score: int) -> int:
    if score >= 90:
        return 5
    elif score >= 75:
        return 4
    elif score >= 60:
        return 3
    elif score >= 40:
        return 2
    elif score >= 20:
        return 1
    return 0


def update_sm2(state: SM2State, score: int) -> SM2State:
    grade = score_to_grade(score)

    new_ef = max(1.3, state.ease_factor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))

    if grade >= 3:
        if state.repetitions == 0:
            new_interval = 1
        elif state.repetitions == 1:
            new_interval = 6
        else:
            new_interval = round(state.interval_days * state.ease_factor)
        new_repetitions = state.repetitions + 1
    else:
        new_interval = 1
        new_repetitions = 0

    state.ease_factor = new_ef
    state.interval_days = new_interval
    state.repetitions = new_repetitions
    state.last_score = score
    state.next_review_at = datetime.now(timezone.utc) + timedelta(days=new_interval)
    return state


async def get_or_create_sm2_state(db: AsyncSession, question_id: uuid.UUID) -> SM2State:
    result = await db.execute(select(SM2State).where(SM2State.question_id == question_id))
    state = result.scalar_one_or_none()
    if state is None:
        state = SM2State(question_id=question_id)
        db.add(state)
        await db.flush()
    return state


async def select_next_question(
    db: AsyncSession,
    session_id: uuid.UUID | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mode: str | None = None,
    question_id: uuid.UUID | None = None,
) -> dict | None:
    filters = ["1=1"]
    params: dict = {}

    if question_id:
        filters.append("q.id = :question_id")
        params["question_id"] = str(question_id)
    else:
        if category:
            filters.append("q.category = :category")
            params["category"] = category

        if difficulty:
            filters.append("q.difficulty = :difficulty")
            params["difficulty"] = difficulty

        if mode == "weak_review":
            filters.append("s.next_review_at <= NOW()")
            filters.append("s.last_score < 60")

        if session_id:
            filters.append(
                "q.id NOT IN (SELECT question_id FROM attempts WHERE session_id = :session_id)"
            )
            params["session_id"] = str(session_id)

    where_clause = " AND ".join(filters)

    query = text(f"""
        SELECT
            q.id,
            q.text,
            q.category,
            q.difficulty,
            q.reference_answer,
            q.tags,
            s.ease_factor,
            s.interval_days,
            s.repetitions,
            s.next_review_at,
            s.last_score
        FROM questions q
        LEFT JOIN sm2_states s ON s.question_id = q.id
        WHERE {where_clause}
        ORDER BY
            (s.id IS NULL) DESC,
            (s.next_review_at <= NOW()) DESC,
            s.next_review_at ASC NULLS FIRST,
            s.last_score ASC NULLS FIRST
        LIMIT 1
    """)

    result = await db.execute(query, params)
    row = result.mappings().first()
    if row is None:
        return None
    return dict(row)
