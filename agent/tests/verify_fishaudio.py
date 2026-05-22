"""Standalone smoke test: prove the worker actually calls Fish Audio.

Drives `_build_tts()` — the exact same factory the LiveKit worker uses — and
runs one short `synthesize()` round-trip against Fish Audio's API. Asserts:

1. The Fish Audio API key and voice id loaded from .env are valid (no
   401 / 404 / 422).
2. The plugin imported by the worker is `livekit.plugins.fishaudio`,
   not anything Gemini-flavored.
3. The synth call returns real PCM audio frames (not empty).

Usage:
    cd voice-agent-test-fishaudio
    source agent/.venv/bin/activate
    python -m agent.tests.verify_fishaudio
"""

from __future__ import annotations

import asyncio
import os
import sys

from dotenv import load_dotenv

# Walk up from agent/tests/ to repo root so .env loads regardless of CWD.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(REPO_ROOT, ".env"))

from livekit.agents import utils as lk_utils  # noqa: E402
from agent.main import _build_tts  # noqa: E402


async def _run() -> int:
    # The Fish Audio plugin shares an aiohttp session managed by the LiveKit
    # worker lifecycle. When we drive synthesize() outside the worker, we
    # bind one ourselves via http_context.open() — otherwise the plugin
    # raises "Attempted to use an http session outside of a job context".
    async with lk_utils.http_context.open():
        return await _run_inner()


async def _run_inner() -> int:
    tts = _build_tts()

    # 1. Confirm the actual class is the Fish Audio plugin, not anything else.
    cls = type(tts)
    module = cls.__module__
    print(f"plugin module    : {module}")
    print(f"plugin class     : {cls.__name__}")
    assert module.startswith("livekit.plugins.fishaudio"), (
        f"Expected livekit.plugins.fishaudio.*, got {module}"
    )

    # 2. Echo back the loaded credentials (masked) so it's clear which env
    #    values the worker would use.
    api_key = os.environ["FISHAUDIO_API_KEY"]
    voice_id = os.environ["FISHAUDIO_VOICE_ID"]
    print(f"api key (masked) : {api_key[:6]}…{api_key[-4:]}  (len={len(api_key)})")
    print(f"voice id         : {voice_id}")

    # 3. Round-trip a single short synth so we get a real 200 from
    #    api.fish.audio. Counts bytes of PCM audio received.
    text = "Hi, this is Rissa from Fish Recovery."
    print(f"\nsynthesize text  : {text!r}")
    print("calling Fish Audio…")

    total_bytes = 0
    frame_count = 0
    stream = tts.synthesize(text)
    try:
        async for chunk in stream:
            frame = getattr(chunk, "frame", None)
            if frame is None:
                continue
            data = frame.data
            total_bytes += len(data)
            frame_count += 1
    except Exception as e:
        # The plugin wraps connection failures as APIConnectionError; the
        # actual culprit is in __cause__.
        print(f"\nsynth FAILED: {type(e).__name__}: {e}")
        cause = e.__cause__
        depth = 0
        while cause is not None and depth < 5:
            print(f"  caused by {type(cause).__name__}: {cause}")
            cause = cause.__cause__
            depth += 1
        raise
    finally:
        await stream.aclose()

    print(f"frames received  : {frame_count}")
    print(f"bytes of PCM     : {total_bytes}")
    assert frame_count > 0, "No audio frames came back — the API call failed silently."
    assert total_bytes > 1000, (
        f"Only {total_bytes} bytes of audio — Fish Audio likely returned an error"
    )
    print("\nFISHAUDIO_VERIFIED_OK")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_run()))
