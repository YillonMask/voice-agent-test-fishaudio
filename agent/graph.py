"""StateGraph wiring.

Pipeline per user turn:

    START → route → generate → audit → END

`route` is the isolated classifier (see `agent/router.py`); it owns all
fuzzy interpretation (verification, objection, emotion, cease) and writes the
decision into state. `generate` speaks. `audit` runs the post-hoc compliance
regex check.

A `MemorySaver` checkpointer keyed on `thread_id` (the LiveKit room name)
keeps `stage`, `identity_verified`, etc. from resetting between user turns.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from .nodes import audit, generate, route
from .state import CallState


def build_graph():
    builder = StateGraph(CallState)
    builder.add_node("route", route)
    builder.add_node("generate", generate)
    builder.add_node("audit", audit)

    builder.add_edge(START, "route")
    builder.add_edge("route", "generate")
    builder.add_edge("generate", "audit")
    builder.add_edge("audit", END)
    return builder


def compile_graph():
    return build_graph().compile(checkpointer=MemorySaver())
