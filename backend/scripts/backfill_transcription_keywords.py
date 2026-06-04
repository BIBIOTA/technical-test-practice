"""
Backfill transcription_keywords for existing questions.

Idempotent: only processes questions whose `transcription_keywords` is empty.
Failures are logged but do not abort the run.

Usage:
  cd backend && DATABASE_URL=postgresql+asyncpg://interview:interview@localhost:5432/interview_practice \
    python -m scripts.backfill_transcription_keywords
"""

import asyncio
import logging
import os
import sys

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_transcription_keywords")


async def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("DATABASE_URL not set")

    from app.models.question import Question
    from app.services.transcription_keywords import extract_transcription_keywords

    engine = create_async_engine(db_url, echo=False)
    try:
        Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async with Session() as session:
            result = await session.execute(
                select(Question).where(Question.transcription_keywords == [])
            )
            questions = list(result.scalars().all())
            logger.info("found %d questions with empty transcription_keywords", len(questions))

            success = 0
            failure = 0
            for q in questions:
                try:
                    keywords = await extract_transcription_keywords(
                        question_text=q.text,
                        reference_answer=q.reference_answer,
                        key_points=list(q.key_points or []),
                        common_mistakes=list(q.common_mistakes or []),
                    )
                    await session.execute(
                        update(Question)
                        .where(Question.id == q.id)
                        .values(transcription_keywords=keywords)
                    )
                    await session.commit()
                    logger.info("  %s -> %d keywords: %s", q.id, len(keywords), keywords)
                    success += 1
                except Exception as exc:
                    logger.warning("  %s FAILED: %s", q.id, exc)
                    await session.rollback()
                    failure += 1

            logger.info("done: %d succeeded, %d failed", success, failure)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
