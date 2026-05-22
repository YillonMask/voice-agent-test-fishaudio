# Fish Recovery Voice Agent (LiveKit + LangGraph + Gemini)

Python worker that joins LiveKit rooms minted by `server.ts` and runs the
debt-collection dialogue graph.

## Stack

| Layer | Component |
|---|---|
| WebRTC + audio loop | LiveKit Agents (Python) with preemptive generation |
| STT | Deepgram Nova-3 (`interim_results`, `endpointing_ms=25`, `no_delay`) |
| VAD | Silero |
| Turn-taking | VAD + Deepgram endpointing (no ONNX turn detector) |
| Router LLM | Gemini 3.5 Flash w/ `with_structured_output(Route)`, `thinking_budget=0` |
| Generator LLM | Gemini 3.5 Flash via `langchain-google-genai`, streamed via `get_stream_writer()` |
| Dialogue logic | LangGraph (`route → generate → audit`) + `MemorySaver` (`thread_id = room.name`) |
| Compliance | Rule-first regex layer (`compliance.py`) post-hoc audit |
| TTS | Fish Audio via `livekit-plugins-fishaudio`, user-supplied voice id |
| TTS adapter | `ParallelSentenceStreamAdapter` overlaps sentence-level synthesis |

## Setup

```bash
cd agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Required environment (set in repo-root `.env`):

```
LIVEKIT_URL=wss://<your-project>.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
DEEPGRAM_API_KEY=...
GOOGLE_API_KEY=...           # Gemini API key for router + generator (langchain-google-genai)
FISHAUDIO_API_KEY=...        # Fish Audio API key (required)
FISHAUDIO_VOICE_ID=...       # Fish Audio reference voice id (required)
GEMINI_MODEL=gemini-3.5-flash          # optional override
GEMINI_ROUTER_MODEL=gemini-3.5-flash   # optional override (defaults to GEMINI_MODEL)
```

## Run

From the repo root:

```bash
python -m agent.main dev
```

The worker connects to your LiveKit project and auto-dispatches into rooms
the Node server creates. Room metadata carries `{"debtorId": "1"|"2"|"3"}`
which the entrypoint reads to seed `CallState.debtor`. After each assistant
turn the worker reads the LangGraph checkpointer and publishes a `signals`
data frame (stage, identity_verified, verify_attempts, emotion, objection,
cease_requested, must_handoff) so the frontend mirrors graph state without
scanning transcripts.
