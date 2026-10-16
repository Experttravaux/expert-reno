"""Paiement du rapport : 1 € par joueur, ou un seul paie pour les quatre.

Attention aux frais fixes : avec Stripe, une carte européenne coûte environ
0,25 € + 1,5 % par transaction, soit plus d'un quart d'un paiement de 1 €.
Le paiement groupé (4 € en une fois) réduit fortement ce coût ; à terme, un
porte-monnaie rechargeable (10 € = 10 analyses) ou une option ajoutée à la
réservation du terrain par le club est plus rentable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Checkout:
    url: str
    provider_ref: str


class PaymentProvider(Protocol):
    name: str

    def create_checkout(
        self, payment_id: str, amount_cents: int, description: str, success_url: str, cancel_url: str
    ) -> Checkout: ...

    def paid_payment_id(self, payload: bytes, headers: dict[str, str]) -> str | None:
        """Lit une notification (webhook) et renvoie l'identifiant du paiement réglé, sinon None."""
        ...


class MockProvider:
    """Développement et démo : un clic sur la page factice valide le paiement."""

    name = "mock"

    def __init__(self, base_url: str = ""):
        self.base_url = base_url

    def create_checkout(self, payment_id, amount_cents, description, success_url, cancel_url) -> Checkout:
        return Checkout(f"{self.base_url}/mock-pay/{payment_id}", payment_id)

    def paid_payment_id(self, payload, headers) -> str | None:
        return None


class StripeProvider:
    """Stripe Checkout : carte bancaire, Apple Pay, Google Pay."""

    name = "stripe"

    def __init__(self, secret_key: str, webhook_secret: str):
        import stripe

        self.stripe = stripe
        self.stripe.api_key = secret_key
        self.webhook_secret = webhook_secret

    def create_checkout(self, payment_id, amount_cents, description, success_url, cancel_url) -> Checkout:
        session = self.stripe.checkout.Session.create(
            mode="payment",
            line_items=[
                {
                    "price_data": {
                        "currency": "eur",
                        "unit_amount": amount_cents,
                        "product_data": {"name": description},
                    },
                    "quantity": 1,
                }
            ],
            metadata={"payment_id": payment_id},
            success_url=success_url,
            cancel_url=cancel_url,
        )
        return Checkout(session.url, session.id)

    def paid_payment_id(self, payload, headers) -> str | None:
        event = self.stripe.Webhook.construct_event(payload, headers.get("stripe-signature", ""), self.webhook_secret)
        if event["type"] != "checkout.session.completed":
            return None
        session = event["data"]["object"]
        if session.get("payment_status") != "paid":
            return None
        return session["metadata"].get("payment_id")


def provider_from_env(base_url: str) -> PaymentProvider:
    key = os.environ.get("STRIPE_SECRET_KEY")
    if key:
        return StripeProvider(key, os.environ.get("STRIPE_WEBHOOK_SECRET", ""))
    return MockProvider(base_url)
