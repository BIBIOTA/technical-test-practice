import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, verify_token
from app.models.attempt import Attempt
from app.models.interview_session import InterviewSession

router = APIRouter(prefix="/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    mode: str  # single|mock|weak_review
    eval_provider: str = "openai"


class SessionResponse(BaseModel):
    session_id: uuid.UUID
    mode: str
    eval_provider: str
    status: str
    started_at: datetime


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> SessionResponse:
    session = InterviewSession(mode=body.mode, eval_provider=body.eval_provider)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return SessionResponse(
        session_id=session.id,
        mode=session.mode,
        eval_provider=session.eval_provider,
        status=session.status,
        started_at=session.started_at,
    )


@router.post("/{session_id}/complete")
async def complete_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status != "completed":
        session.status = "completed"
        session.completed_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(session)

    return {"session_id": str(session.id), "status": session.status}


@router.get("/{session_id}/summary")
async def session_summary(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    attempts_result = await db.execute(
        select(Attempt).where(Attempt.session_id == session_id, Attempt.status == "completed")
    )
    attempts = list(attempts_result.scalars().all())

    total_questions = len(attempts)
    average_score = (
        sum(a.score for a in attempts if a.score is not None) / total_questions
        if total_questions > 0
        else 0
    )

    breakdown = [
        {
            "attempt_id": str(a.id),
            "question_id": str(a.question_id),
            "score": a.score,
            "summary": a.evaluation.get("summary") if a.evaluation else None,
        }
        for a in attempts
    ]

    return {
        "session_id": str(session.id),
        "mode": session.mode,
        "status": session.status,
        "total_questions": total_questions,
        "average_score": round(average_score, 1),
        "attempts": breakdown,
    }
