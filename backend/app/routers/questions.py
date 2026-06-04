import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.services.sm2 import get_question_detail as sm2_get_question_detail
from app.services.sm2 import list_questions as sm2_list_questions
from app.services.sm2 import select_next_question

router = APIRouter(prefix="/questions", tags=["questions"])


@router.get("")
async def get_questions(
    category: str | None = None,
    difficulty: str | None = None,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> list[dict]:
    return await sm2_list_questions(db, category=category, difficulty=difficulty)


@router.get("/next")
async def get_next_question(
    session_id: uuid.UUID | None = None,
    category: str | None = None,
    difficulty: str | None = None,
    mode: str | None = None,
    question_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    question = await select_next_question(
        db,
        session_id=session_id,
        category=category,
        difficulty=difficulty,
        mode=mode,
        question_id=question_id,
    )
    if question is None:
        raise HTTPException(status_code=404, detail="No available question")

    return {
        "question_id": str(question["id"]),
        "question_text": question["text"],
        "category": question["category"],
        "difficulty": question["difficulty"],
        "tags": question["tags"] or [],
        "sm2": {
            "ease_factor": question["ease_factor"],
            "interval_days": question["interval_days"],
            "next_review_at": str(question["next_review_at"]) if question["next_review_at"] else None,
            "last_score": question["last_score"],
        },
    }


@router.get("/{question_id}")
async def get_question(
    question_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    detail = await sm2_get_question_detail(db, question_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Question not found")
    return detail
