import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.models.attempt import Attempt
from app.models.interview_session import InterviewSession
from app.models.question import Question
from app.services.evaluation import get_provider
from app.services.sm2 import get_or_create_sm2_state, update_sm2

router = APIRouter(prefix="/attempts", tags=["attempts"])


class CreateAttemptRequest(BaseModel):
    session_id: uuid.UUID
    question_id: uuid.UUID
    transcript: str | None = None


@router.post("", status_code=202)
async def create_attempt(
    body: CreateAttemptRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    attempt = Attempt(
        session_id=body.session_id,
        question_id=body.question_id,
        transcript=body.transcript,
        status="pending_evaluation",
    )
    db.add(attempt)
    await db.commit()
    await db.refresh(attempt)

    background_tasks.add_task(_run_evaluation, attempt.id)

    return {"attempt_id": str(attempt.id), "status": attempt.status}


async def _run_evaluation(attempt_id: uuid.UUID) -> None:
    from app.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Attempt).where(Attempt.id == attempt_id))
        attempt = result.scalar_one_or_none()
        if attempt is None:
            return

        session_result = await db.execute(
            select(InterviewSession).where(InterviewSession.id == attempt.session_id)
        )
        session = session_result.scalar_one_or_none()

        question_result = await db.execute(
            select(Question).where(Question.id == attempt.question_id)
        )
        question = question_result.scalar_one_or_none()

        if session is None or question is None:
            attempt.status = "failed"
            await db.commit()
            return

        transcript = attempt.transcript or ""

        if not transcript.strip():
            attempt.status = "completed"
            attempt.score = 0
            attempt.evaluation = {
                "score": 0,
                "summary": "未提供任何回答，無法評分。",
                "missing_points": ["請提供完整的技術回答。"],
                "next_focus": ["嘗試用語音回答題目後再送出。"],
                "ideal_answer": "",
                "provider": "system",
                "model": "none",
            }
            attempt.completed_at = datetime.now(timezone.utc)
            await db.commit()
            return

        try:
            provider = get_provider(session.eval_provider)
            evaluation = await provider.evaluate(
                question=question.text,
                reference_answer=question.reference_answer,
                transcript=transcript,
            )

            attempt.status = "completed"
            attempt.score = evaluation.score
            attempt.evaluation = evaluation.model_dump()
            attempt.completed_at = datetime.now(timezone.utc)

            sm2_state = await get_or_create_sm2_state(db, question.id)
            update_sm2(sm2_state, evaluation.score)

            await db.commit()
        except Exception:
            attempt.status = "failed"
            await db.commit()


@router.get("/{attempt_id}/result")
async def get_attempt_result(
    attempt_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(select(Attempt).where(Attempt.id == attempt_id))
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")

    return {
        "attempt_id": str(attempt.id),
        "status": attempt.status,
        "score": attempt.score,
        "evaluation": attempt.evaluation,
    }


@router.get("/{attempt_id}/summary")
async def get_attempt_summary(
    attempt_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(select(Attempt).where(Attempt.id == attempt_id))
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")

    if attempt.status != "completed" or attempt.evaluation is None:
        raise HTTPException(status_code=404, detail="Evaluation not yet available")

    ev = attempt.evaluation
    return {
        "score": attempt.score,
        "summary": ev.get("summary"),
        "missing_points": ev.get("missing_points", []),
        "next_focus": ev.get("next_focus", []),
        "ideal_answer": ev.get("ideal_answer", ""),
    }
