"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-24 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notion_id", sa.Text, unique=True, nullable=True),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("difficulty", sa.String(10), nullable=False),
        sa.Column("reference_answer", sa.Text, nullable=False),
        sa.Column("tags", postgresql.ARRAY(sa.Text), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "interview_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("mode", sa.String(20), nullable=False),
        sa.Column("eval_provider", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "attempts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_sessions.id"),
            nullable=False,
        ),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id"),
            nullable=False,
        ),
        sa.Column("transcript", sa.Text, nullable=True),
        sa.Column("status", sa.String(30), nullable=False, server_default="pending_evaluation"),
        sa.Column("score", sa.Integer, nullable=True),
        sa.Column("evaluation", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "sm2_states",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "question_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("questions.id"),
            unique=True,
            nullable=False,
        ),
        sa.Column("ease_factor", sa.Float, nullable=False, server_default="2.5"),
        sa.Column("interval_days", sa.Integer, nullable=False, server_default="1"),
        sa.Column("repetitions", sa.Integer, nullable=False, server_default="0"),
        sa.Column("next_review_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_score", sa.Integer, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "realtime_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("interview_sessions.id"),
            nullable=False,
        ),
        sa.Column("openai_session_id", sa.Text, nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("realtime_sessions")
    op.drop_table("sm2_states")
    op.drop_table("attempts")
    op.drop_table("interview_sessions")
    op.drop_table("questions")
