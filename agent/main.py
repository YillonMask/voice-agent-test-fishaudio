"""LiveKit agent worker entrypoint.

Run with:
    python -m agent.main dev
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
import os
import uuid
from collections.abc import AsyncIterable

from dotenv import load_dotenv
from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, ModelSettings, WorkerOptions, cli
from livekit.agents.llm import ChatMessage
from livekit.plugins import deepgram, fishaudio, langchain as lk_langchain, silero

from .debtors import get_debtor
from .graph import compile_graph
from .parallel_tts import ParallelSentenceStreamAdapter

load_dotenv()
logger = logging.getLogger("fish-recovery-agent")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


_GRAPH = compile_graph()


def _parse_room_metadata(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Room metadata was not valid JSON: %r", raw)
        return {}


def _build_tts():
    """Fish Audio TTS with a user-supplied voice id.

    Env vars:
        FISHAUDIO_API_KEY  — Fish Audio API key (required)
        FISHAUDIO_VOICE_ID — Fish reference voice id (required)
    """
    api_key = os.getenv("FISHAUDIO_API_KEY")
    voice_id = os.getenv("FISHAUDIO_VOICE_ID")
    if not api_key or not voice_id:
        raise RuntimeError(
            "FISHAUDIO_API_KEY and FISHAUDIO_VOICE_ID must both be set in .env "
            "before starting the worker."
        )
    logger.info("TTS: Fish Audio (voice_id=%s)", voice_id)
    return fishaudio.TTS(
        api_key=api_key,
        voice_id=voice_id,
        latency_mode="balanced",
        sample_rate=24000,
    )


class StreamingAgent(Agent):
    """Agent variant that taps the TTS text stream for live transcript publish.

    The default Agent emits the assistant transcript via the
    `conversation_item_added` event — which fires *after* the turn has fully
    completed (TTS finished playing). That guarantees the UI log trails the
    voice. Here we instead intercept each text delta on its way into the TTS
    node and publish a `transcript_delta` frame the instant it arrives.
    """

    def __init__(self, *, instructions: str, on_delta) -> None:
        super().__init__(instructions=instructions)
        self._on_delta = on_delta

    async def tts_node(
        self, text: AsyncIterable[str], model_settings: ModelSettings
    ) -> AsyncIterable[rtc.AudioFrame]:
        msg_id = f"AG_{uuid.uuid4().hex[:10]}"
        on_delta = self._on_delta

        async def _tap(stream: AsyncIterable[str]) -> AsyncIterable[str]:
            async for chunk in stream:
                if chunk:
                    on_delta(msg_id, chunk, False)
                yield chunk
            on_delta(msg_id, "", True)

        async for frame in Agent.default.tts_node(self, _tap(text), model_settings):
            yield frame


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()

    metadata = _parse_room_metadata(ctx.room.metadata)
    debtor = get_debtor(metadata.get("debtorId"))
    logger.info("Connected to room %s for debtor %s", ctx.room.name, debtor["name"])

    session = AgentSession(
        vad=silero.VAD.load(),
        # Defaults already favor latency (no_delay=True, endpointing_ms=25,
        # interim_results=True, vad_events=True). We pin them explicitly so
        # behavior doesn't drift if the plugin defaults change.
        stt=deepgram.STT(
            model="nova-3",
            language="en",
            interim_results=True,
            no_delay=True,
            endpointing_ms=25,
            filler_words=False,
        ),
        llm=lk_langchain.LLMAdapter(
            graph=_GRAPH,
            # `custom` mode means only payloads explicitly written via
            # `get_stream_writer()` reach the LLMAdapter. The audit node's
            # internal LLM calls therefore cannot leak into TTS — only the
            # tokens we forward from the generate node do.
            stream_mode="custom",
            config={
                "configurable": {"thread_id": ctx.room.name},
            },
        ),
        # Wrap the Gemini TTS in our parallel-per-sentence adapter so
        # sentence N+1's synthesize() request is kicked off as soon as the
        # sentence boundary is detected, instead of waiting for sentence N's
        # audio frames to fully arrive. Audio is still emitted in order.
        tts=ParallelSentenceStreamAdapter(tts=_build_tts(), max_parallel=4),
    )

    # Seed the per-room CallState with the debtor profile so the nodes can
    # build their system prompts. The checkpointer persists it across turns.
    graph_config = {"configurable": {"thread_id": ctx.room.name}}
    await _GRAPH.aupdate_state(
        graph_config,
        {"debtor": debtor, "stage": "opening", "verify_attempts": 0},
    )

    # ── outgoing data-channel plumbing ────────────────────────────────
    #
    # Every UI-bound event carries a monotonic `seq`. The frontend renders
    # by seq order rather than DataReceived arrival order, so chunks emitted
    # in the same millisecond from different code paths (LLM tap vs
    # conversation_item_added vs compliance audit) never visually reorder.
    seq_counter = itertools.count(1)

    def _publish(payload: dict) -> None:
        payload = {**payload, "seq": next(seq_counter)}

        async def _send() -> None:
            try:
                await ctx.room.local_participant.publish_data(
                    json.dumps(payload).encode("utf-8"),
                    reliable=True,
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to publish data frame")

        asyncio.create_task(_send())

    def _publish_agent_delta(msg_id: str, delta: str, done: bool) -> None:
        _publish({
            "type": "transcript_delta",
            "role": "agent",
            "id": msg_id,
            "delta": delta,
            "done": done,
        })

    # User STT publish — we synthesize a stable id per utterance so the
    # frontend can update the same bubble across interims and finalize on
    # the final transcript instead of stacking N greyed-out drafts.
    user_msg_id: dict[str, str | None] = {"id": None}

    def _publish_user_transcript(text: str, is_final: bool) -> None:
        if not text:
            return
        if user_msg_id["id"] is None:
            user_msg_id["id"] = f"US_{uuid.uuid4().hex[:10]}"
        _publish({
            "type": "transcript_delta" if not is_final else "transcript",
            "role": "user",
            "id": user_msg_id["id"],
            "text": text,
            "done": is_final,
        })
        if is_final:
            user_msg_id["id"] = None

    @session.on("user_input_transcribed")
    def _on_user_transcribed(event):  # noqa: ANN001
        text = (getattr(event, "transcript", "") or "").strip()
        if not text:
            return
        _publish_user_transcript(text, bool(getattr(event, "is_final", False)))

    # ── signals frame plumbing ────────────────────────────────────────
    #
    # After each turn the route node has rewritten state.stage and the
    # interpretive fields (emotion, objection, identity_verified, …). We
    # read the checkpointer and publish a single `signals` frame so the UI
    # can drive its hover cascade and orb tint from real classifications
    # rather than heuristics on the transcript text.
    SIGNAL_KEYS = (
        "stage",
        "identity_verified",
        "verify_attempts",
        "emotion",
        "objection",
        "cease_requested",
        "must_handoff",
    )

    last_signals: dict[str, object] = {}

    async def _publish_signals_if_changed() -> None:
        try:
            snapshot = await _GRAPH.aget_state(graph_config)
        except Exception:  # noqa: BLE001
            logger.exception("Failed to read graph state for signals")
            return
        values = snapshot.values or {}
        payload = {k: values.get(k) for k in SIGNAL_KEYS}
        # Default unset booleans to False / ints to 0 so the frontend
        # doesn't have to special-case missing keys.
        payload["identity_verified"] = bool(payload.get("identity_verified") or False)
        payload["cease_requested"] = bool(payload.get("cease_requested") or False)
        payload["must_handoff"] = bool(payload.get("must_handoff") or False)
        payload["verify_attempts"] = int(payload.get("verify_attempts") or 0)
        payload["stage"] = payload.get("stage") or "opening"
        if payload == last_signals:
            return
        last_signals.update(payload)
        _publish({"type": "signals", **payload})

    @session.on("conversation_item_added")
    def _on_item(event):  # noqa: ANN001 — livekit event payload is dynamic
        item = event.item
        if isinstance(item, ChatMessage) and item.role == "assistant":
            # Agent just finished a turn → route/generate/audit have run →
            # state.stage and the read-fields are fresh. Push them.
            asyncio.create_task(_publish_signals_if_changed())
            return
        # Backstop for system messages (agent text is streamed via tts_node tap,
        # user text via STT events).
        if not isinstance(item, ChatMessage) or item.role != "system":
            return
        text = item.text_content
        if not text:
            return
        _publish({
            "type": "transcript",
            "role": "system",
            "id": f"SY_{uuid.uuid4().hex[:10]}",
            "text": text,
            "done": True,
        })

    # The graph owns dialogue logic; this instruction only frames the voice
    # persona for any default behaviors LiveKit might invoke outside the graph.
    await session.start(
        agent=StreamingAgent(
            instructions=(
                "You are Rissa, an FDCPA-compliant debt-collection "
                "representative from Fish Recovery. Keep replies short and "
                "conversational."
            ),
            on_delta=_publish_agent_delta,
        ),
        room=ctx.room,
    )

    # Push the initial signals frame so the chip and orb leave `idle` the
    # moment the room is live, not when the agent has already finished speaking.
    await _publish_signals_if_changed()

    await session.generate_reply(
        instructions="Begin the call with the opening stage script."
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
