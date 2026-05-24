import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # single|mock|weak_review
    eval_provider: Mapped[str] = mapped_column(String(20), nullable=False)  # openai|claude|gemini
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attempts: Mapped[list["Attempt"]] = relationship("Attempt", back_populates="session")
    realtime_sessions: Mapped[list["RealtimeSession"]] = relationship(
        "RealtimeSession", back_populates="session"
    )
