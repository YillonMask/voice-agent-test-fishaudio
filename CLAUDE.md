# CLAUDE.md — repo orientation

## One-line summary

Two-process voice agent: a Node portal mints LiveKit tokens; a Python worker runs an `AgentSession` whose LLM is a LangGraph compiled via `livekit-plugins-langchain` `LLMAdapter`.

## The single architectural rule (don't break)

**The graph owns dialogue logic. LiveKit owns the audio loop.** Anything about "what should the agent say" → a LangGraph node. Anything about "when does the agent speak" → LiveKit (turn detection, interruption, VAD). Compliance, audit, cease-contact → graph node, never a prompt instruction.

## Two processes

- `server.ts` (Node, port 3000): `/api/livekit/token` mints a JWT and **pre-creates** the LiveKit room with debtor JSON in `room.metadata`. Also `/api/agent-status`, `/api/compliance/logs`. No audio touches this process.
- `agent/main.py` (Python worker): joins the room, reads debtor from `ctx.room.metadata`, seeds CallState via `graph.aupdate_state`, then `AgentSession.start`. Plugins: Silero VAD, Deepgram Nova-3 STT, `LLMAdapter(graph=_GRAPH, stream_mode="custom", config={"configurable": {"thread_id": ctx.room.name}})`, Fish Audio TTS wrapped in `ParallelSentenceStreamAdapter`. Turn-taking is VAD + Deepgram endpointing — **never** add `livekit.plugins.turn_detector` (it pulls a local ONNX model from HuggingFace).

`thread_id = ctx.room.name` is what makes the `MemorySaver` checkpointer preserve `stage`, `identity_verified`, etc. across user turns. Without it the agent re-asks for verification every turn.

`stream_mode="custom"` is load-bearing: only payloads explicitly written via `get_stream_writer()` in `generate` reach the LLMAdapter / TTS. The router's and audit's internal LLM calls can never leak into voice.

## File map

| File | Owns |
|---|---|
| `agent/state.py` | `CallState` TypedDict (`messages` with `add_messages` reducer + business state: `stage`, `identity_verified`, `verify_attempts`, `emotion`, `objection`, `cease_requested`, `must_handoff`) |
| `agent/graph.py` | `build_graph()` (`START → route → generate → audit → END`) + `compile_graph()` (adds `MemorySaver`) |
| `agent/router.py` | `classify_turn()` — isolated Pydantic-typed Gemini classifier; sees ONLY the latest user utterance + state booleans (hard prompt-injection boundary); `thinking_budget=0` |
| `agent/nodes.py` | `route` (writes `stage` + emotion/objection/identity flags from the router), `generate` (stage-scoped Gemini call, streams via `get_stream_writer()`), `audit` (post-hoc compliance), per-stage prompt builders, `_extract_text` (flattens Gemini-3 parts-list content) |
| `agent/parallel_tts.py` | `ParallelSentenceStreamAdapter` — kicks off TTS synthesis for sentence N+1 while N's audio is still arriving; emits audio in order |
| `agent/compliance.py` | `review()` returns `ComplianceVerdict`; regex `RULES` + optional LLM classifier; `REWRITE_CAP=2`; `CANNED_SAFE_RESPONSE` |
| `agent/llm.py` | `chat_model()` — `ChatGoogleGenerativeAI(model="gemini-3.5-flash", temperature=1.0)`. Gemini 3 family **requires** temperature=1.0. |
| `agent/debtors.py` | Server-side mirror of `src/data.ts` — must stay in sync |
| `src/App.tsx` | LiveKit room lifecycle via imperative `Room` API; listens to `RoomEvent.DataReceived` for `transcript`, `transcript_delta`, `compliance`, `signals` frames. Holds a `Signals` object that drives the StageChip cascade, the FDCPA checklist, and the orb emotion tint |
| `src/components/InfoChips.tsx` | `StageChip` 3-card hover cascade (Pipeline / Debtor read / Identity) + `ComplianceChip` + `StackChip` |
| `src/components/AmbientOrb.tsx` & `AudioVisualizer.tsx` | Emotion-tinted orbs — paint set indexed by `signals.emotion`, sticky across listening |
| `startup.sh` | Unified entry: venv + deps + frees port + parallel launch + traps SIGINT |
| `agent/tests/test_graph_e2e.py` | Real Gemini calls. Run with `python -m agent.tests.test_graph_e2e` from the active venv. |

## Gotchas the test caught (don't reintroduce)

1. **Gemini rejects empty `messages`.** First turn (agent opens) needs a placeholder `HumanMessage` — see `agent/nodes.py::generate`.
2. **Gemini 3 returns `content` as a list of parts dicts** (`[{"type":"text","text":...}, ...]`) when thinking is on. Always go through `_extract_text(msg.content)`, never `str(msg.content)`.
3. **Regex word boundaries:** `\barrest\b` does **not** match "arrested". Use `arrest\w*` for inflected forms — see `RULES[0]` in `agent/compliance.py`.
4. **Cease-and-desist is honored at any stage** (FDCPA absolute right) — `route` overrides `next_stage` to `cease` whenever `wants_cease=True`, before any verification check.
5. **Sticky vs. fresh state.** The router answers "did THIS utterance verify / cease?"; `route` ORs it with prior sticky flags so once verified stays verified. Never make `next_stage` depend on `state.get("objection")` (which is the sticky one) — branch on the router's `objection` for this turn.
6. **Fish Audio TTS.** Set `FISHAUDIO_API_KEY` and `FISHAUDIO_VOICE_ID` in `.env`. `_build_tts` raises if either is missing. The TTS is wrapped in `ParallelSentenceStreamAdapter` (overlaps per-sentence synthesis) — keep that wrapper in place.

## Conventions

- LLM model: always `gemini-3.5-flash` via `langchain-google-genai` (env `GOOGLE_API_KEY`, fallback `GEMINI_API_KEY`).
- TTS: Fish Audio via `livekit-plugins-fishaudio` (`FISHAUDIO_API_KEY`, `FISHAUDIO_VOICE_ID`). `_build_tts` raises if either is missing.
- Never reintroduce Gemini TTS or Gemini Live for voice — Fish Audio is the only TTS path. See `_build_tts` in `agent/main.py`.
- Never add a custom WebSocket / chunker / interruption layer — LiveKit plugins handle it. The only adapter we own is `ParallelSentenceStreamAdapter`, which wraps the TTS plugin to overlap sentence-level synthesize calls; it does not chunk or interrupt.
- Compliance is a **graph node**, not a microservice or prompt instruction.
- Routing is the **router LLM**, not regex. `agent/router.py` returns a Pydantic `Route` object; `agent/nodes.py::route` consumes it and writes state.
- Frontend never opens raw WebSockets; it always goes through `livekit-client.Room`.
- UI state derives from the `signals` frame (per-turn snapshot of the graph checkpointer), never from transcript text scanning.

## Running things

- Full demo: `./startup.sh` → portal on `:3000`, logs at `.logs/{portal,agent}.log`.
- Graph test only (no LiveKit/audio deps needed): `source agent/.venv/bin/activate && python -m agent.tests.test_graph_e2e`.
- Type-check frontend + server: `npx tsc --noEmit`.

## When extending

- New stage → add to `Stage` literal in `agent/state.py` AND `Route.next_stage` literal in `agent/router.py`, prompt in `agent/nodes.py::_stage_instruction`, expected path in `agent/tests/test_graph_e2e.py`. UI bucket: update `stageIndex()` in `src/components/InfoChips.tsx` if the new stage doesn't fold into an existing column.
- New compliance rule → append to `RULES` in `agent/compliance.py` with a tagged regex + FDCPA citation, then add a row to `COMPLIANCE_CASES` in the test.
- New debtor → update both `agent/debtors.py::DEBTORS` and `src/data.ts::DEBTORS` (and `DEBTOR_PROFILES` in `server.ts`).
- New UI-surfaced state field → add to `CallState`, to `SIGNAL_KEYS` in `agent/main.py::_publish_signals_if_changed`, and to the `Signals` type in `src/App.tsx`. Don't add transcript heuristics.
