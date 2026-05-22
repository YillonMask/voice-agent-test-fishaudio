"""Conversation state persisted by the LangGraph checkpointer per LiveKit room.

Mirrors the design from the verified architecture doc Section 6: a `messages`
field with the `add_messages` reducer for LangChain message history, plus
business-state fields that the checkpointer carries across user turns.
"""

from __future__ import annotations

from typing import Literal, Optional, TypedDict

from langgraph.graph.message import add_messages
from typing_extensions import Annotated


Stage = Literal[
    "opening",
    "verify",
    "explain",
    "route",
    "hardship",
    "dispute",
    "paid",
    "cease",
    "plan",
    "commit",
    "recap",
    "deescalate",
    "handoff",
    "close",
]

Objection = Literal["no_money", "not_mine", "already_paid", "need_proof", "refuse"]
Emotion = Literal["neutral", "confused", "angry", "anxious"]


class DebtorProfile(TypedDict):
    id: str
    name: str
    amount: str
    creditor: str
    ssn_suffix: str
    birth_year: str
    objection_summary: str


class CallState(TypedDict, total=False):
    messages: Annotated[list, add_messages]

    debtor: DebtorProfile

    stage: Stage
    identity_verified: bool
    verify_attempts: int
    debt_disputed: bool
    cease_requested: bool

    objection: Optional[Objection]
    emotion: Emotion

    promised_amount: Optional[float]
    promised_date: Optional[str]

    # Per-turn pipeline scratch space.
    candidate: str            # last raw LLM utterance before compliance
    compliance_flags: list[str]
    compliance_feedback: str  # passed back to the generator on a rewrite
    rewrite_count: int
    must_handoff: bool
    final: str                # post-compliance text that the LLMAdapter speaks
