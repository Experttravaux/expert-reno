"""Statistiques par joueur, façon tableau de score de laser game."""

from __future__ import annotations

import numpy as np

from .identity import Tracks
from .models import COURT_WIDTH, NET_Y, Player, PlayerStats, Rally, ShotOutcome
from .rally import NET_ZONE_M

HEATMAP_ROWS = 4  # profondeur : du filet vers le fond, tranches de 2,5 m
HEATMAP_COLS = 4  # largeur : tranches de 2,5 m


def compute_stats(players: list[Player], rallies: list[Rally], tracks: Tracks) -> dict[str, PlayerStats]:
    stats = {p.id: PlayerStats(p.id, p.name, p.team) for p in players}

    for rally in rallies:
        if rally.winner_team is not None:
            for s in stats.values():
                s.points_played += 1
                if s.team == rally.winner_team:
                    s.points_won += 1
        for shot in rally.shots:
            s = stats[shot.player_id]
            s.shots += 1
            s.serves += shot.is_serve
            s.volleys += shot.is_volley
            s.well_placed += shot.well_placed
            s.max_speed_kmh = max(s.max_speed_kmh, shot.speed_kmh)
        if not rally.shots:
            continue
        last = rally.shots[-1]
        s = stats[last.player_id]
        if rally.ended_by == "serve_fault":
            s.serve_faults += 1
        elif last.outcome == ShotOutcome.WINNER:
            s.winners += 1
            if rally.unreturned_by in stats:
                stats[rally.unreturned_by].unreturned += 1
        elif last.outcome in (ShotOutcome.NET, ShotOutcome.OUT):
            if rally.ended_by == "double_fault":
                s.serve_faults += 1
            if last.forced_error:
                s.forced_errors += 1
            else:
                s.unforced_errors += 1
            if last.outcome == ShotOutcome.NET:
                s.net_errors += 1
            else:
                s.out_errors += 1

    for pid, s in stats.items():
        near_net = [
            abs(shot.position[1] - NET_Y) <= NET_ZONE_M
            for r in rallies
            for shot in r.shots
            if shot.player_id == pid and not shot.is_serve
        ]
        s.net_presence = float(np.mean(near_net)) if near_net else 0.0
        s.distance_m, s.heatmap = _movement(tracks, pid)
    return stats


def _movement(tracks: Tracks, pid: str, step_s: float = 0.5) -> tuple[float, list[list[int]]]:
    ts = tracks.times.get(pid)
    if not ts or len(ts) < 2:
        return 0.0, [[0] * HEATMAP_COLS for _ in range(HEATMAP_ROWS)]
    times = np.asarray(ts)
    xy = np.asarray(tracks.xy[pid])
    # Moyenne par tranche de 0,5 s : lisse le tremblement de la détection.
    bins = ((times - times[0]) // step_s).astype(int)
    counts = np.bincount(bins)
    keep = counts > 0
    pts = np.stack([np.bincount(bins, xy[:, 0])[keep], np.bincount(bins, xy[:, 1])[keep]], axis=1)
    pts /= counts[keep][:, None]
    steps = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    distance = float(steps[steps < 6.0].sum())  # ignore les sauts entre deux points
    heat = np.zeros((HEATMAP_ROWS, HEATMAP_COLS), dtype=int)
    for x, y in pts:
        depth = abs(y - NET_Y)  # distance au filet, quel que soit le côté
        r = min(int(depth / (NET_Y / HEATMAP_ROWS)), HEATMAP_ROWS - 1)
        c = min(max(int(x / (COURT_WIDTH / HEATMAP_COLS)), 0), HEATMAP_COLS - 1)
        heat[r, c] += 1
    return distance, heat.tolist()
