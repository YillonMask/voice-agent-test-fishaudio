"""FDCPA compliance gate.

Per Section 7 of the verified architecture doc: rule-first regex layer for the
obvious violations (~1ms), LLM classifier only on ambiguous output, and a
rewrite loop capped at 2 iterations before falling back to a canned safe line.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from langchain_core.messages import HumanMessage, SystemMessage

from .llm import compliance_model


REWRITE_CAP = 2

# Order matters: the first match wins, and the most severe violations come
# first so the audit log surfaces the right reason.
RULES: list[tuple[str, re.Pattern[str], str]] = [
    (
        "threat_of_arrest",
        re.compile(r"\b(?:arrest\w*|jail\w*|imprison\w*|prison\w*|prosecut\w*)\b", re.I),
        "FDCPA §807 prohibits threats of arrest or jail.",
    ),
    (
        "wage_garnishment_threat",
        re.compile(r"\b(garnish(?:ment|ed|ing)?|seize your wages)\b", re.I),
        "FDCPA §807 prohibits unauthorized wage-garnishment threats.",
    ),
    (
        "third_party_disclosure",
        re.compile(
            r"\b(tell|inform|notify|disclose to)\s+(?:your\s+)?(employer|family|friends|spouse|boss|coworker)s?\b",
            re.I,
        ),
        "FDCPA §805 prohibits disclosing the debt to third parties.",
    ),
    (
        "credit_score_threat",
        re.compile(r"\bruin (?:your )?credit\b|\bdestroy your credit\b", re.I),
        "FDCPA §807 bans misleading credit-impact threats.",
    ),
    (
        "obscene_language",
        re.compile(r"\b(idiot|stupid|moron|liar|deadbeat)\b", re.I),
        "FDCPA §806 prohibits abusive or obscene language.",
    ),
]


CANNED_SAFE_RESPONSE = (
    "I hear you. Let me be straightforward — I want to help you resolve this "
    "account in a way that works for you. Would you like to talk through a "
    "payment plan, or have an itemized statement mailed to you first?"
)


@dataclass
class ComplianceVerdict:
    approved: bool
    text: str
    flags: list[str]
    rewrite_feedback: str
    forced_handoff: bool = False


def _regex_check(text: str) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    for tag, pattern, reason in RULES:
        if pattern.search(text):
            hits.append((tag, reason))
    return hits


_LLM_PROMPT = SystemMessage(
    content=(
        "You are an FDCPA compliance reviewer for a debt-collection voice "
        "agent. Decide if the candidate utterance is COMPLIANT or UNSAFE. "
        "Unsafe includes: threats of legal action, arrest, wage garnishment; "
        "disclosure of debt to third parties; abusive language; calling at "
        "unusual hours; false statements about debt amount or legal status. "
        "Respond with a single line in the format 'VERDICT: <COMPLIANT|UNSAFE>' "
        "followed by an optional short reason on the next line."
    )
)


async def _llm_classify(text: str) -> tuple[bool, str]:
    """Returns (compliant, reason). Used only when regex was clean but the
    response is ambiguous (long-ish, hedging, or assertive)."""
    try:
        resp = await compliance_model().ainvoke(
            [_LLM_PROMPT, HumanMessage(content=f"CANDIDATE:\n{text}")]
        )
        body = (resp.content if isinstance(resp.content, str) else str(resp.content)).strip()
        first_line = body.splitlines()[0].upper()
        compliant = "COMPLIANT" in first_line and "UNSAFE" not in first_line
        reason = "\n".join(body.splitlines()[1:]).strip() or "ambiguous"
        return compliant, reason
    except Exception as e:  # noqa: BLE001
        # Fail-open on classifier errors but flag for audit.
        return True, f"classifier_unavailable:{e!s}"


def _is_ambiguous(text: str) -> bool:
    # Only worth spending classifier latency when the candidate has length
    # AND uses assertive collection vocabulary. Short empathetic lines skip.
    if len(text) < 80:
        return False
    triggers = ("must", "have to", "required", "consequences", "action", "legal")
    return any(t in text.lower() for t in triggers)


async def review(candidate: str, *, rewrite_count: int) -> ComplianceVerdict:
    flags = [tag for tag, _ in _regex_check(candidate)]
    if flags:
        reasons = "; ".join(reason for _, reason in _regex_check(candidate))
        if rewrite_count >= REWRITE_CAP:
            return ComplianceVerdict(
                approved=True,
                text=CANNED_SAFE_RESPONSE,
                flags=flags + ["forced_canned"],
                rewrite_feedback=reasons,
            )
        return ComplianceVerdict(
            approved=False,
            text=candidate,
            flags=flags,
            rewrite_feedback=(
                "Your previous draft violated FDCPA. " + reasons +
                " Rewrite the message without these violations, keeping it "
                "calm, professional, and brief."
            ),
        )

    if _is_ambiguous(candidate):
        ok, reason = await _llm_classify(candidate)
        if not ok:
            if rewrite_count >= REWRITE_CAP:
                return ComplianceVerdict(
                    approved=True,
                    text=CANNED_SAFE_RESPONSE,
                    flags=["classifier_unsafe", "forced_canned"],
                    rewrite_feedback=reason,
                )
            return ComplianceVerdict(
                approved=False,
                text=candidate,
                flags=["classifier_unsafe"],
                rewrite_feedback=(
                    "Compliance classifier flagged the draft as potentially "
                    "unsafe: " + reason + ". Rewrite more neutrally."
                ),
            )

    return ComplianceVerdict(approved=True, text=candidate, flags=[], rewrite_feedback="")
