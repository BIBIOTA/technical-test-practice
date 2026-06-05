import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.deps import verify_token

router = APIRouter(prefix="/debug", tags=["debug"])

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "logs"
LOG_FILE = LOG_DIR / "transcript-debug.jsonl"


class DebugLogRequest(BaseModel):
    event: str
    data: dict


@router.post("/transcript-log", status_code=204)
async def transcript_log(
    body: DebugLogRequest,
    _: None = Depends(verify_token),
) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "event": body.event,
        "data": body.data,
    }
    with LOG_FILE.open("a") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


@router.post("/transcript-log/clear", status_code=204)
async def clear_log(
    _: None = Depends(verify_token),
) -> None:
    if LOG_FILE.exists():
        LOG_FILE.unlink()
