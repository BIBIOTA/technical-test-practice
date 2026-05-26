import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db, verify_token
from app.models.interview_session import InterviewSession
from app.models.realtime_session import RealtimeSession

router = APIRouter(prefix="/realtime", tags=["realtime"])


class ClientSecretRequest(BaseModel):
    session_id: uuid.UUID


@router.post("/client-secret")
async def create_client_secret(
    body: ClientSecretRequest,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(verify_token),
) -> dict:
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.id == body.session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    try:
        response = await client.realtime.client_secrets.create(
            session={
                "type": "realtime",
                "model": "gpt-realtime-2025-08-28",
                "instructions": _build_system_prompt(session.mode),
                "tools": _get_tools(),
                "tool_choice": "auto",
                "audio": {"output": {"voice": "alloy"}},
            }
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI API error: {str(e)}")

    expires_at = datetime.fromtimestamp(response.expires_at, tz=timezone.utc)

    rt_session = RealtimeSession(
        session_id=body.session_id,
        openai_session_id=response.session.id,
        expires_at=expires_at,
    )
    db.add(rt_session)
    await db.commit()

    return {
        "client_secret": response.value,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "openai_session_id": response.session.id,
    }


def _build_system_prompt(mode: str) -> str:
    mode_desc = {
        "single": "單題練習模式 (Single Question Mode)",
        "mock": "模擬面試模式 (Mock Interview Mode)",
        "weak_review": "弱點複習模式 (Weak Review Mode)",
    }.get(mode, mode)

    return f"""你是一位資深後端工程師面試官，正在進行{mode_desc}技術面試。

規則：
1. 使用繁體中文進行全程對話
2. 每次只問一個問題，等待應試者完整回答
3. 絕對不透露參考答案
4. 若應試者主動要求提示，僅提供方向性提示
5. 應試者表示回答完畢後，呼叫 mark_answer_completed tool 記錄答案
6. 評分完成後，呼叫 get_evaluation_summary 取得評分結果，並以語音向應試者說明

工作流程：
1. 呼叫 get_next_question 取得題目
2. 以語音念出題目
3. 等待應試者回答
4. 應試者說「回答完畢」或類似語句後，呼叫 mark_answer_completed
5. 告知應試者正在評分（等待 AI 評分中）
6. 約10秒後呼叫 get_evaluation_summary 確認評分完成
7. 若評分未完成，每5秒重試一次，最多30秒
8. 以語音播報評分結果
9. 詢問是否繼續下一題"""


def _get_tools() -> list[dict]:
    return [
        {
            "type": "function",
            "name": "get_next_question",
            "description": "取得下一道面試題目，由 SM-2 算法決定出題順序",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Interview session UUID"},
                    "mode": {
                        "type": "string",
                        "description": "Interview mode: single, mock, or weak_review",
                    },
                    "category": {"type": "string", "description": "Optional category filter"},
                    "difficulty": {
                        "type": "string",
                        "description": "Optional difficulty filter: easy, medium, hard",
                    },
                },
                "required": ["session_id", "mode"],
            },
        },
        {
            "type": "function",
            "name": "mark_answer_completed",
            "description": "記錄應試者的回答並觸發 AI 評分",
            "parameters": {
                "type": "object",
                "properties": {
                    "session_id": {"type": "string", "description": "Interview session UUID"},
                    "question_id": {"type": "string", "description": "Question UUID"},
                    "transcript": {
                        "type": "string",
                        "description": "Candidate's answer transcript",
                    },
                },
                "required": ["session_id", "question_id", "transcript"],
            },
        },
        {
            "type": "function",
            "name": "get_evaluation_summary",
            "description": "取得評分結果摘要，供 AI 以語音播報給應試者",
            "parameters": {
                "type": "object",
                "properties": {
                    "attempt_id": {"type": "string", "description": "Attempt UUID"},
                },
                "required": ["attempt_id"],
            },
        },
    ]
