import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from openai import AsyncOpenAI
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_db, verify_token
from app.models.interview_session import InterviewSession
from app.models.question import Question
from app.models.realtime_session import RealtimeSession

router = APIRouter(prefix="/realtime", tags=["realtime"])


class ClientSecretRequest(BaseModel):
    session_id: uuid.UUID
    pinned_question_id: uuid.UUID | None = None


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

    keywords: list[str] = []
    if body.pinned_question_id is not None:
        q_result = await db.execute(
            select(Question).where(Question.id == body.pinned_question_id)
        )
        question = q_result.scalar_one_or_none()
        if question is None:
            raise HTTPException(status_code=404, detail="Question not found")
        keywords = list(question.transcription_keywords or [])

    client = AsyncOpenAI(api_key=settings.openai_api_key)

    try:
        response = await client.realtime.client_secrets.create(
            session=_build_realtime_session_config(session.mode, keywords)
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
2. 語音風格需自然、沉穩、專業，使用台灣繁體中文面試官口吻；語速適中，避免簡體中文與中國用語
3. 每次只問一個問題，等待應試者完整回答
4. 絕對不透露參考答案
5. 若應試者主動要求提示，僅提供方向性提示
6. 【重要】只有在對話中出現「（送出答案）」文字訊號後，才能呼叫 mark_answer_completed。在此訊號出現之前，不論偵測到任何音訊，均不得呼叫 mark_answer_completed，也不得播放任何語音或輸出任何文字回覆。「（送出答案）」是系統內部訊號，不要讀出或重複。
7. 呼叫 mark_answer_completed 時，transcript 填入緊接在「（送出答案）」訊號後的音訊內容（繁體中文），不可翻譯成英文
8. 評分完成後，呼叫 get_evaluation_summary 取得評分結果，並以語音向應試者說明

工作流程：
1. 呼叫 get_next_question 取得題目
2. 以語音念出題目
3. 靜候，不得主動說話或回應。等待對話中出現「（送出答案）」訊號（由應試者按下介面按鈕觸發）
4. 看到「（送出答案）」訊號後，立即呼叫 mark_answer_completed，transcript 填入緊接的音訊繁體中文內容
5. 告知應試者正在評分（等待 AI 評分中）
6. 約10秒後呼叫 get_evaluation_summary 確認評分完成
7. 若評分未完成，每5秒重試一次，最多30秒
8. 以繁體中文語音播報評分結果，內容包含 AI 詳細反饋、待改善、優勢 / 下一步、正確完整回答建議
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
                        "description": "Candidate's answer transcript in the original language; preserve Traditional Chinese and do not translate to English.",
                    },
                },
                "required": ["session_id", "question_id", "transcript"],
            },
        },
        {
            "type": "function",
            "name": "get_evaluation_summary",
            "description": "取得繁體中文評分結果摘要，供 AI 以語音播報給應試者，包含 summary、missing_points、next_focus、ideal_answer",
            "parameters": {
                "type": "object",
                "properties": {
                    "attempt_id": {"type": "string", "description": "Attempt UUID"},
                },
                "required": ["attempt_id"],
            },
        },
    ]


TRANSCRIPTION_BASE_PROMPT = (
    "這是一場後端工程師中文技術面試，應試者使用台灣繁體中文回答。"
    "請完整保留英文術語的原文拼寫，不要翻譯成中文、不要替換成其他相近詞、"
    "不要轉成拼音或假名。聽不清楚時保留原狀，不要猜測。"
)


def _build_transcription_prompt(keywords: list[str]) -> str:
    if not keywords:
        return TRANSCRIPTION_BASE_PROMPT
    terms = ", ".join(keywords)
    return f"{TRANSCRIPTION_BASE_PROMPT} 本題可能會出現的英文術語：{terms}。"


def _build_realtime_session_config(mode: str, keywords: list[str]) -> dict:
    return {
        "type": "realtime",
        "model": "gpt-realtime-2025-08-28",
        "instructions": _build_system_prompt(mode),
        "tools": _get_tools(),
        "tool_choice": "auto",
        "audio": {
            "input": {
                "transcription": {
                    "model": "gpt-4o-transcribe",
                    "language": "zh",
                    "prompt": _build_transcription_prompt(keywords),
                },
            },
            "output": {"voice": "cedar"},
        },
    }
