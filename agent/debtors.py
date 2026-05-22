"""Debtor profile lookup. Kept in sync with src/data.ts on the frontend."""

from __future__ import annotations

from .state import DebtorProfile


DEBTORS: dict[str, DebtorProfile] = {
    "1": {
        "id": "1",
        "name": "John Smith",
        "amount": "$1,450.00",
        "creditor": "Citibank N.A. (CashRewards Card)",
        "ssn_suffix": "4321",
        "birth_year": "1982",
        "objection_summary": (
            "Financial hardship — lost job ~2 months ago. Willing to settle if "
            "a 40% discount ($870 lump) or $100/mo installment plan is offered."
        ),
    },
    "2": {
        "id": "2",
        "name": "Emily Davis",
        "amount": "$420.00",
        "creditor": "Metro Health Emergency Services",
        "ssn_suffix": "8812",
        "birth_year": "1994",
        "objection_summary": (
            "Disputed bill — believes BlueShield insurance should have covered "
            "the ER visit. Wants an itemized statement and a collections hold."
        ),
    },
    "3": {
        "id": "3",
        "name": "Marcus Vance",
        "amount": "$3,200.00",
        "creditor": "Capital Auto Finance",
        "ssn_suffix": "5678",
        "birth_year": "1975",
        "objection_summary": (
            "Already-paid claim — says a $500 check was mailed last Tuesday. "
            "Requests a 7-day hold while the carrier delivers."
        ),
    },
}

DEFAULT_DEBTOR_ID = "1"


def get_debtor(debtor_id: str | None) -> DebtorProfile:
    if not debtor_id or debtor_id not in DEBTORS:
        return DEBTORS[DEFAULT_DEBTOR_ID]
    return DEBTORS[debtor_id]
