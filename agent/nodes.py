"""Graph nodes.

Pipeline per user turn:
    route → generate → audit

`route` is the isolated classifier from `agent/router.py`. It owns all the
fuzzy interpretation work that used to live in regex helpers — verification,
objection detection, emotion, cease — and writes its decision into state.

`generate` is a pure speaking node: it reads the stage that `route` chose,
builds a per-stage system prompt over a stable cacheable prefix, and streams
tokens out to the LiveKit pipe.

`audit` is unchanged from before — a post-hoc compliance check on the agent's
candidate utterance.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage
from langgraph.config import get_stream_writer

from .compliance import review
from .debtors import get_debtor
from .llm import chat_model
from .router import classify_turn
from .state import CallState, DebtorProfile, Stage

_log = logging.getLogger("fish-recovery-agent.graph")


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------


def _extract_text(content: Any) -> str:
    """Flatten LangChain message content to a plain string.

    Gemini 3 with thinking returns content as a list of dict parts of shape
    `{"type": "text", "text": "...", "extras": {...}}` interleaved with
    thinking-signature parts. We keep only the "text" parts. With
    `thinking_budget=0` we typically just get a string, but we keep the
    parts-list handling so the path is robust if thinking is re-enabled.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "text" and "text" in item:
                    out.append(str(item["text"]))
                elif "text" in item and "type" not in item:
                    out.append(str(item["text"]))
            elif isinstance(item, str):
                out.append(item)
        return "".join(out).strip()
    return str(content)


def _last_user_text(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return _extract_text(m.content)
        role = getattr(m, "type", None) or getattr(m, "role", None)
        if role == "human" or role == "user":
            return _extract_text(getattr(m, "content", "") or "")
    return ""


# ---------------------------------------------------------------------------
# Prompts — kept scoped per stage. Stable prefix first (cacheable), variable
# stage instruction after.
# ---------------------------------------------------------------------------


_BASE_RULES = """\
You are Rissa, an FDCPA-compliant debt-collection representative from Fish Recovery.

Absolute rules:
- Never threaten arrest, jail, prosecution, or wage garnishment.
- Never disclose the debt to anyone other than the verified debtor.
- Never use abusive, sarcastic, or condescending language.
- Never claim consequences you cannot legally deliver.

Voice style: warm but professional, short sentences (one or two clauses),
no bulleted lists, no markdown. This is a phone call.
"""


def _debtor_context(debtor: DebtorProfile) -> str:
    return (
        f"Active debtor: {debtor['name']}\n"
        f"Outstanding balance: {debtor['amount']}\n"
        f"Original creditor: {debtor['creditor']}\n"
        f"Verification keys (do not volunteer them): last 4 SSN ending in "
        f"{debtor['ssn_suffix']}, birth year {debtor['birth_year']}.\n"
        f"Likely objection on file: {debtor['objection_summary']}"
    )


def _stage_instruction(stage: Stage, debtor: DebtorProfile) -> str:
    if stage == "opening":
        return (
            f"This is the opening. Introduce yourself by name (Rissa) and "
            f"ask to speak with {debtor['name']} by name. State that you "
            "represent Fish Recovery and that this is a business call "
            "regarding a personal financial matter. Do NOT mention the "
            "amount or original creditor yet."
        )
    if stage == "verify":
        return (
            "Verification stage. Politely ask the caller to confirm either "
            "the last four digits of their SSN or their birth year so you "
            "can discuss the account. If they refuse, explain the FDCPA "
            "privacy reason once and offer to send physical mail instead."
        )
    if stage == "explain":
        return (
            f"Identity confirmed. Briefly state: an outstanding balance of "
            f"{debtor['amount']} originally credited by {debtor['creditor']} "
            "is currently overdue. Ask how they would like to resolve it."
        )
    if stage == "route":
        return (
            "Listen for the debtor's objection or response and acknowledge "
            "it with a short empathetic sentence before proceeding."
        )
    if stage == "hardship":
        return (
            "Hardship path. Validate the hardship in one sentence. Offer a "
            "one-time settlement at roughly 40 percent off, OR a $100/month "
            "installment plan starting next month. Ask which sounds workable."
        )
    if stage == "dispute":
        return (
            "Dispute path. Validate the concern. Offer a 15-day collections "
            "hold and an itemized statement mailed to them. Ask if that is "
            "acceptable while they gather their records."
        )
    if stage == "paid":
        return (
            "Already-paid path. Thank them for telling you and place a "
            "7-day hold so the mail can arrive. Ask politely for a tracking "
            "number or check number if they have one."
        )
    if stage == "deescalate":
        return (
            "De-escalation. Acknowledge their frustration directly and "
            "calmly. Slow down. Ask one short, low-pressure question to "
            "move the conversation forward."
        )
    if stage == "cease":
        return (
            "Cease-and-desist requested. Confirm in one sentence that you "
            "will document the request, stop calling this number, and "
            "switch to physical mail. Then close the call warmly."
        )
    if stage == "plan":
        return (
            "Plan stage. Propose a concrete amount and date based on the "
            "conversation so far. Ask the debtor to confirm the figure."
        )
    if stage == "commit":
        return (
            "Commitment stage. Restate the agreed amount and date, then ask "
            "for a clear yes/no commitment from the debtor."
        )
    if stage == "recap":
        return (
            "Recap stage. Summarize the agreement in two short sentences "
            "and thank the debtor for their time."
        )
    if stage == "handoff":
        return (
            "Hand-off path. Politely explain that you cannot continue "
            "without identity verification, recommend they call back, and "
            "say goodbye."
        )
    # close
    return (
        "Close the call warmly in one short sentence. Do not introduce new "
        "topics."
    )


def _build_system_prompt(state: CallState, debtor: DebtorProfile, stage: Stage) -> SystemMessage:
    # Stable prefix (cacheable by Gemini): rules + debtor record. Identical
    # every turn of a given call, so prefix caching keeps the input-token
    # bill flat as the conversation grows.
    stable_prefix = "\n\n".join([_BASE_RULES, _debtor_context(debtor)])
    # Variable suffix: changes per stage.
    variable_suffix = "\n\n".join([
        f"Current stage: {stage}.",
        _stage_instruction(stage, debtor),
    ])
    feedback = state.get("compliance_feedback")
    if feedback:
        variable_suffix += f"\n\nCompliance feedback on your previous draft: {feedback}"
    return SystemMessage(content=f"{stable_prefix}\n\n---\n\n{variable_suffix}")


# ---------------------------------------------------------------------------
# Nodes.
# ---------------------------------------------------------------------------


async def route(state: CallState) -> dict[str, Any]:
    """Classify the latest user turn and update routing state.

    This is the only place that interprets user input. It calls the isolated
    router model (no history, single utterance) and writes the decision into
    state so `generate` can read it as a typed field rather than recomputing
    anything from regex.
    """
    debtor = state.get("debtor") or get_debtor(None)
    messages = state.get("messages", [])
    user_text = _last_user_text(messages)
    has_spoken = any(isinstance(m, AIMessage) for m in messages)
    current_stage: Stage = state.get("stage") or "opening"

    # First turn: agent has not spoken yet. No user utterance to classify.
    # Skip the LLM call entirely — opening is the only valid choice.
    if not has_spoken:
        return {
            "stage": "opening",
            "objection": state.get("objection"),
            "emotion": state.get("emotion") or "neutral",
        }

    route_decision = await classify_turn(
        debtor=debtor,
        current_stage=current_stage,
        identity_verified=bool(state.get("identity_verified", False)),
        verify_attempts=int(state.get("verify_attempts", 0)),
        cease_requested=bool(state.get("cease_requested", False)),
        has_spoken=has_spoken,
        user_utterance=user_text,
    )

    # Sticky state: once verified, stays verified. Once cease requested, stays.
    identity_verified = bool(state.get("identity_verified", False)) or route_decision.verification_provided_now
    cease_requested = bool(state.get("cease_requested", False)) or route_decision.wants_cease

    # Cease overrides the router's stage choice as a safety net — FDCPA
    # absolute right honored even if the LLM mis-routes.
    next_stage: Stage = "cease" if route_decision.wants_cease else route_decision.next_stage  # type: ignore[assignment]

    # Verify_attempts: increment iff we are about to ask for verification and
    # identity is still not established. This is the only counter — the
    # router doesn't manage it.
    verify_attempts = int(state.get("verify_attempts", 0))
    if next_stage == "verify" and not identity_verified:
        verify_attempts += 1

    # Auto-escalate to handoff if the verify counter trips and the LLM didn't
    # already route there.
    if (
        not identity_verified
        and not cease_requested
        and verify_attempts >= 3
        and next_stage == "verify"
    ):
        next_stage = "handoff"

    return {
        "stage": next_stage,
        "identity_verified": identity_verified,
        "cease_requested": cease_requested,
        "verify_attempts": verify_attempts,
        "objection": route_decision.objection or state.get("objection"),
        "emotion": route_decision.emotion,
        "must_handoff": next_stage == "handoff",
    }


async def generate(state: CallState) -> dict[str, Any]:
    """Speak the next turn using the stage the router chose."""
    debtor = state.get("debtor") or get_debtor(None)
    stage: Stage = state.get("stage") or "opening"

    sys_msg = _build_system_prompt(state, debtor, stage)
    history = [m for m in state.get("messages", []) if not isinstance(m, SystemMessage)]
    if not history:
        # Gemini requires non-empty user content. The very first turn (agent
        # opens the call before the debtor has said anything) needs a placeholder.
        history = [HumanMessage(content="(Call has just connected. Begin with the opening line.)")]

    # Stream tokens from Gemini and forward each one to the LLMAdapter via
    # LangGraph's custom stream channel. Running the graph in
    # stream_mode="custom" means only payloads we write here surface to
    # LiveKit — the router's and audit's internal LLM calls cannot leak into
    # TTS. A single stable message id is reused for every chunk so LiveKit's
    # pipeline groups them into one assistant utterance.
    writer = get_stream_writer()
    msg_id = f"LC_{uuid.uuid4().hex[:10]}"
    chunks: list[str] = []
    started = time.perf_counter()
    first_token_ms: float | None = None

    async for chunk in chat_model().astream([sys_msg, *history]):
        delta = _extract_text(chunk.content)
        if not delta:
            continue
        if first_token_ms is None:
            first_token_ms = (time.perf_counter() - started) * 1000
        chunks.append(delta)
        # livekit-plugins-langchain 1.5.x reads `BaseMessageChunk.text`
        # as a property, but on langchain-core 0.3.86 `.text` is a method,
        # so passing an AIMessageChunk stuffs a bound method into the
        # adapter's ChoiceDelta.content and pydantic rejects it. Writing
        # a plain string lands in the adapter's `str` branch, which
        # produces a valid ChatChunk every time.
        writer(delta)

    text = "".join(chunks).strip()
    _log.info(
        "[generate] stage=%s len=%d first_token_ms=%.0f total_ms=%.0f",
        stage, len(text),
        first_token_ms or -1,
        (time.perf_counter() - started) * 1000,
    )

    return {
        "messages": [AIMessage(content=text, id=msg_id)],
        "candidate": text,
    }


async def audit(state: CallState) -> dict[str, Any]:
    candidate = state.get("candidate", "")
    if not candidate:
        return {}
    verdict = await review(candidate, rewrite_count=state.get("rewrite_count", 0))
    return {
        "compliance_flags": verdict.flags,
        "final": verdict.text,
        "compliance_feedback": verdict.rewrite_feedback if not verdict.approved else "",
    }
