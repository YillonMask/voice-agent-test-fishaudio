"""Gemini 3.5 Flash factory.

Gemini 3.5 Flash (`gemini-3.5-flash`, released 2026-05-19) is the speak-node
model. The Gemini 3 family requires `temperature=1.0` per Google guidance —
langchain-google-genai sets that default automatically, but we pin it here so
the contract is explicit.
"""

from __future__ import annotations

import os
from functools import lru_cache

from langchain_core.runnables import Runnable
from langchain_google_genai import ChatGoogleGenerativeAI


# `gemini-3.5-flash` is GA on both Vertex AI and the Gemini API.
DEFAULT_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")


@lru_cache(maxsize=1)
def chat_model() -> ChatGoogleGenerativeAI:
    # Streaming is enabled so the `generate` node can iterate `astream()` and
    # forward each token to the LiveKit pipe in real time (see agent/nodes.py
    # and agent/main.py). The previous double-emit issue is avoided by
    # running the graph in `stream_mode="custom"`: only payloads explicitly
    # written via `get_stream_writer()` reach the LLMAdapter, so on_llm_*
    # callback events never leak into TTS.
    #
    # `thinking_budget=0` disables Gemini 3.x extended-reasoning so the model
    # returns the answer directly instead of streaming a draft + final pass.
    return ChatGoogleGenerativeAI(
        model=DEFAULT_MODEL,
        temperature=1.0,
        max_retries=2,
        thinking_budget=0,
    )


@lru_cache(maxsize=1)
def compliance_model() -> Runnable:
    # Same model, used by the audit node. With stream_mode="custom" its
    # tokens cannot reach TTS (only `get_stream_writer` payloads do), so the
    # historical "nostream" tag is no longer needed.
    return ChatGoogleGenerativeAI(
        model=DEFAULT_MODEL,
        temperature=1.0,
        max_retries=2,
        thinking_budget=0,
    )
