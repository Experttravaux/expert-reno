"""Qui est qui : relier chaque silhouette détectée à l'un des 4 joueurs inscrits.

À l'inscription, la borne prend une photo de chaque joueur en pied. On en
tire une signature couleur des vêtements (histogramme). Pendant la partie,
on associe à chaque image les silhouettes aux joueurs en combinant :
- la ressemblance de la signature couleur,
- la continuité de position (un joueur ne se téléporte pas).

Pas de reconnaissance faciale ici : à 10-20 m, un visage fait quelques
pixels, et la biométrie impose des contraintes RGPD lourdes. La photo sert
au rapport et à la signature vêtements, valable le temps d'une partie.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

import numpy as np

from .court import CourtCalibration
from .models import FrameObservation, Player, PlayerState

HIST_BINS = 4  # 4x4x4 = 64 cases de couleur


def appearance_from_crop(crop_rgb: np.ndarray) -> np.ndarray:
    """Signature couleur (histogramme RVB normalisé) du buste d'une silhouette."""
    h, w = crop_rgb.shape[:2]
    torso = crop_rgb[int(h * 0.2) : int(h * 0.6), int(w * 0.2) : int(w * 0.8)]
    if torso.size == 0:
        torso = crop_rgb
    q = (torso.reshape(-1, 3).astype(int) * HIST_BINS) // 256
    idx = q[:, 0] * HIST_BINS * HIST_BINS + q[:, 1] * HIST_BINS + q[:, 2]
    hist = np.bincount(idx, minlength=HIST_BINS**3).astype(float)
    return hist / max(hist.sum(), 1.0)


def appearance_distance(a: np.ndarray | None, b: np.ndarray | None) -> float:
    """Distance de Hellinger entre deux histogrammes (0 = identiques, 1 = disjoints)."""
    if a is None or b is None:
        return 0.5
    return float(np.sqrt(max(0.0, 1.0 - np.sum(np.sqrt(a * b)))))


@dataclass
class Tracks:
    """Trajectoires au sol des joueurs identifiés."""

    times: dict[str, list[float]] = field(default_factory=dict)
    xy: dict[str, list[tuple[float, float]]] = field(default_factory=dict)

    def add(self, state: PlayerState, t: float) -> None:
        self.times.setdefault(state.player_id, []).append(t)
        self.xy.setdefault(state.player_id, []).append(state.court_xy)

    def position(self, player_id: str, t: float) -> tuple[float, float] | None:
        ts = self.times.get(player_id)
        if not ts:
            return None
        arr = np.asarray(self.xy[player_id])
        x = float(np.interp(t, ts, arr[:, 0]))
        y = float(np.interp(t, ts, arr[:, 1]))
        return x, y

    def positions(self, t: float) -> dict[str, tuple[float, float]]:
        out = {}
        for pid in self.times:
            pos = self.position(pid, t)
            if pos is not None:
                out[pid] = pos
        return out


class PlayerIdentifier:
    def __init__(
        self,
        players: list[Player],
        calibration: CourtCalibration,
        appearance_weight: float = 4.0,
        max_speed: float = 8.0,
        court_margin: float = 1.0,
    ):
        self.players = players
        self.cal = calibration
        self.w_app = appearance_weight
        self.max_speed = max_speed
        self.margin = court_margin
        self.last: dict[str, tuple[float, tuple[float, float]]] = {}
        self.signatures = {p.id: p.appearance for p in players}

    def assign(self, obs: FrameObservation) -> list[PlayerState]:
        cands = []
        for det in obs.persons:
            xy = self.cal.to_court(*det.box.feet)
            if self.cal.inside(*xy, margin=self.margin):  # ignore le public hors du terrain
                cands.append((det, xy))
        if not cands:
            return []
        pids = [p.id for p in self.players]
        cost = np.array([[self._cost(pid, c, obs.t) for c in cands] for pid in pids])
        k = min(len(cands), len(pids))
        best, best_cost = None, np.inf
        for players_idx in itertools.combinations(range(len(pids)), k):
            for chosen in itertools.permutations(range(len(cands)), k):
                total = cost[players_idx, chosen].sum()
                if total < best_cost:
                    best, best_cost = [(pids[i], c) for i, c in zip(players_idx, chosen)], total
        states = []
        for pid, c in best:
            det, xy = cands[c]
            self.last[pid] = (obs.t, xy)
            states.append(PlayerState(pid, det.box, xy))
        return states

    def _cost(self, pid: str, cand, t: float) -> float:
        det, xy = cand
        cost = self.w_app * appearance_distance(self.signatures.get(pid), det.appearance)
        if pid in self.last:
            t_last, xy_last = self.last[pid]
            dist = float(np.hypot(xy[0] - xy_last[0], xy[1] - xy_last[1]))
            reach = self.max_speed * max(t - t_last, 1e-3) + 0.5
            cost += dist / reach + (10.0 if dist > reach else 0.0)
        return cost

    def track(self, observations: list[FrameObservation]) -> Tracks:
        tracks = Tracks()
        for obs in observations:
            for state in self.assign(obs):
                tracks.add(state, obs.t)
        return tracks
