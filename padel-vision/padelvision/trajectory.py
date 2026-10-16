"""Analyse de la trajectoire de la balle avec une seule caméra.

1. Découpage 2D : entre deux événements (frappe, rebond, vitre, filet), la
   trajectoire de la balle dans l'image est lisse. Une cassure (changement
   brusque de vitesse) trahit un événement. On la détecte en comparant la
   vitesse estimée juste avant et juste après chaque observation.

2. Lecture 3D de chaque cassure : une seule caméra ne donne pas la
   profondeur, mais à une cassure, la balle est forcément quelque part sur le
   rayon caméra -> pixel. On teste des hypothèses qui fixent ce point :
   au sol (rebond), à hauteur de raquette près d'un joueur (frappe), sur une
   vitre, dans le filet. Pour chacune, le point 3D étant fixé et la gravité
   connue, la vitesse de la balle avant/après se calcule par moindres carrés
   linéaires. On garde l'hypothèse qui explique le mieux les pixels tout en
   restant physiquement plausible.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .physics import BALL_DRAG, G

GRAVITY = np.array([0.0, 0.0, -G])


# --------------------------------------------------------------------------
# Géométrie caméra
# --------------------------------------------------------------------------


def camera_center(p: np.ndarray) -> np.ndarray:
    return -np.linalg.solve(p[:, :3], p[:, 3])


def pixel_ray(p: np.ndarray, u: float, v: float) -> tuple[np.ndarray, np.ndarray]:
    """Origine (centre caméra) et direction unitaire du rayon passant par le pixel."""
    d = np.linalg.solve(p[:, :3], np.array([u, v, 1.0]))
    d /= np.linalg.norm(d)
    if p[2, :3] @ d < 0:
        d = -d
    return camera_center(p), d


def ray_plane(origin: np.ndarray, d: np.ndarray, axis: int, value: float) -> np.ndarray | None:
    """Intersection du rayon avec le plan X[axis] = value (devant la caméra)."""
    if abs(d[axis]) < 1e-9:
        return None
    lam = (value - origin[axis]) / d[axis]
    if lam <= 0:
        return None
    return origin + lam * d


def ray_closest_to_vertical(origin: np.ndarray, d: np.ndarray, x: float, y: float) -> np.ndarray:
    """Point du rayon le plus proche (horizontalement) de la verticale passant par (x, y)."""
    dh = d[:2]
    lam = float((np.array([x, y]) - origin[:2]) @ dh / (dh @ dh + 1e-12))
    return origin + max(lam, 0.1) * d


# --------------------------------------------------------------------------
# 1. Détection des cassures en 2D
# --------------------------------------------------------------------------


@dataclass
class Kink:
    index: int  # indice de l'observation la plus proche
    t: float  # instant estimé de l'événement
    uv: tuple[float, float]  # pixel estimé de la balle à cet instant
    score: float


def _line_fit(t: np.ndarray, uv: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Droite (en temps) ajustée sur des pixels : (position en t=0, vitesse)."""
    a = np.vstack([np.ones_like(t), t]).T
    coef, *_ = np.linalg.lstsq(a, uv, rcond=None)
    return coef[0], coef[1]


def detect_kinks(
    t: np.ndarray,
    uv: np.ndarray,
    window: int = 4,
    min_jump_px_s: float = 150.0,
    min_relative_jump: float = 0.35,
) -> list[Kink]:
    """Instants où la vitesse 2D de la balle saute brutalement.

    À chaque observation i, on estime la vitesse juste avant (droite sur les
    `window` points précédents) et juste après. Un vrai événement donne un
    saut bien plus grand que l'effet de la gravité ou du bruit de détection.
    """
    n = len(t)
    jumps = np.zeros(n)
    fits: dict[int, tuple] = {}
    for i in range(window, n - window):
        pl, vl = _line_fit(t[i - window : i + 1] - t[i], uv[i - window : i + 1])
        pr, vr = _line_fit(t[i : i + window + 1] - t[i], uv[i : i + window + 1])
        jump = float(np.linalg.norm(vr - vl))
        speed = float((np.linalg.norm(vl) + np.linalg.norm(vr)) / 2)
        if jump >= max(min_jump_px_s, min_relative_jump * speed):
            jumps[i] = jump
            fits[i] = (pl, vl, pr, vr)
    kinks: list[Kink] = []
    half = window - 1
    for i in sorted(fits):
        if jumps[i] < jumps[max(0, i - half) : i + half + 1].max():
            continue
        if kinks and i - kinks[-1].index <= half:
            continue
        pl, vl, pr, vr = fits[i]
        # Instant précis : là où les deux droites (avant / après) se croisent.
        ts = np.linspace(t[i - 1] - t[i], t[i + 1] - t[i], 41)
        left = pl + np.outer(ts, vl)
        right = pr + np.outer(ts, vr)
        k = int(np.argmin(np.linalg.norm(left - right, axis=1)))
        mid = (left[k] + right[k]) / 2
        kinks.append(Kink(i, float(t[i] + ts[k]), (float(mid[0]), float(mid[1])), jumps[i]))
    return kinks


# --------------------------------------------------------------------------
# 2. Ajustement 3D ancré
# --------------------------------------------------------------------------


@dataclass
class AnchoredFit:
    velocity: np.ndarray  # m/s, à l'instant de l'ancre
    rms_px: float
    n: int


def anchored_fit(
    p: np.ndarray,
    anchor: np.ndarray,
    t_anchor: float,
    t: np.ndarray,
    uv: np.ndarray,
    drag: float = BALL_DRAG,
    iterations: int = 3,
) -> AnchoredFit | None:
    """Vitesse de la balle sachant qu'elle passe par `anchor` à `t_anchor`.

    Modèle X(τ) = anchor + v·τ + ½·a·τ², avec a = g − k·|v|·v (freinage de
    l'air évalué à la vitesse courante) : linéaire en v à a fixé, on itère.
    """
    if len(t) < 3:
        return None
    depth = max(float(p[2] @ np.append(anchor, 1.0)), 0.5)
    acc = GRAVITY.copy()
    vel = np.zeros(3)
    for _ in range(iterations):
        rows, rhs = [], []
        for ti, (u, v) in zip(t, uv):
            tau = ti - t_anchor
            base = anchor + 0.5 * acc * tau * tau
            for coord, line in ((u, p[0]), (v, p[1])):
                a = coord * p[2, :3] - line[:3]
                rows.append(tau * a / depth)
                rhs.append(-(a @ base + coord * p[2, 3] - line[3]) / depth)
        vel, *_ = np.linalg.lstsq(np.array(rows), np.array(rhs), rcond=None)
        acc = GRAVITY - drag * np.linalg.norm(vel) * vel
    taus = t - t_anchor
    pts = anchor + np.outer(taus, vel) + 0.5 * np.outer(taus**2, acc)
    h = np.hstack([pts, np.ones((len(pts), 1))]) @ p.T
    if np.any(h[:, 2] <= 0):
        return None
    res = np.linalg.norm(h[:, :2] / h[:, 2:3] - uv, axis=1)
    return AnchoredFit(vel, float(np.sqrt(np.mean(res**2))), len(t))


@dataclass
class BallSegment:
    """Une portion continue du suivi de la balle (sans trou important)."""

    t: np.ndarray
    uv: np.ndarray
    kinks: list[Kink]

    def side_points(self, k: int, before: bool, max_span: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
        """Observations entre la cassure k et la cassure voisine (avant ou après)."""
        kink = self.kinks[k]
        if before:
            lo_t = self.kinks[k - 1].t if k > 0 else -np.inf
            mask = (self.t < kink.t) & (self.t > lo_t + 0.02) & (self.t >= kink.t - max_span)
        else:
            hi_t = self.kinks[k + 1].t if k + 1 < len(self.kinks) else np.inf
            mask = (self.t > kink.t) & (self.t < hi_t - 0.02) & (self.t <= kink.t + max_span)
        return self.t[mask], self.uv[mask]

    def start_points(self, max_span: float = 0.5) -> tuple[np.ndarray, np.ndarray]:
        hi_t = self.kinks[0].t if self.kinks else np.inf
        mask = (self.t < hi_t - 0.02) & (self.t <= self.t[0] + max_span)
        return self.t[mask], self.uv[mask]


def split_track(
    t: np.ndarray, uv: np.ndarray, max_gap: float = 0.25, min_points: int = 6
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Coupe le suivi là où la balle disparaît trop longtemps."""
    if len(t) == 0:
        return []
    cuts = np.where(np.diff(t) > max_gap)[0] + 1
    out = []
    for ts, us in zip(np.split(t, cuts), np.split(uv, cuts)):
        if len(ts) >= min_points:
            out.append((ts, us))
    return out
