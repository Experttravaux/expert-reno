"""Constantes et intégration physique de la balle de padel."""

from __future__ import annotations

import numpy as np

from .models import COURT_LENGTH, COURT_WIDTH, NET_Y

G = 9.81
# Freinage aérodynamique quadratique a = -k·|v|·v, k = ρ·Cd·S / (2m).
# Balle de padel (~57 g, 6,5 cm) : k ≈ 0,01 à 0,02 /m selon la pression.
BALL_DRAG = 0.012
NET_HEIGHT = 0.9


def predict_flight(
    p0: tuple[float, float, float], v0: tuple[float, float, float], max_s: float = 3.0, dt: float = 1 / 240
) -> tuple[str, float, np.ndarray]:
    """Vol libre depuis (p0, v0) jusqu'au premier contact.

    Renvoie (« sol » | « vitre » | « filet » | « aucun »), durée, point de contact.
    """
    p = np.asarray(p0, dtype=float).copy()
    v = np.asarray(v0, dtype=float).copy()
    t = 0.0
    while t < max_s:
        prev = p.copy()
        v = v + (np.array([0.0, 0.0, -G]) - BALL_DRAG * np.linalg.norm(v) * v) * dt
        p = p + v * dt
        t += dt
        if p[2] <= 0:
            return "sol", t, np.array([p[0], p[1], 0.0])
        if (prev[1] - NET_Y) * (p[1] - NET_Y) < 0 and p[2] < NET_HEIGHT:
            return "filet", t, p
        if not (0.0 <= p[0] <= COURT_WIDTH and 0.0 <= p[1] <= COURT_LENGTH):
            return "vitre", t, p
    return "aucun", t, p
