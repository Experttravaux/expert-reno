"""Chaîne complète : observations (ou vidéo) -> échanges -> statistiques par joueur."""

from __future__ import annotations

from dataclasses import dataclass

from .court import CourtCalibration
from .events import EventExtractor, EventParams
from .identity import PlayerIdentifier, Tracks
from .models import FrameObservation, Player, PlayerStats, Rally
from .rally import apply_serve_rules, interpret_rally
from .stats import compute_stats


@dataclass
class MatchAnalysis:
    players: list[Player]
    rallies: list[Rally]
    stats: dict[str, PlayerStats]
    tracks: Tracks

    @property
    def score(self) -> dict[int, int]:
        out = {1: 0, 2: 0}
        for r in self.rallies:
            if r.winner_team:
                out[r.winner_team] += 1
        return out


def analyze_observations(
    observations: list[FrameObservation],
    players: list[Player],
    calibration: CourtCalibration,
    params: EventParams | None = None,
) -> MatchAnalysis:
    tracks = PlayerIdentifier(players, calibration).track(observations)
    rally_events = EventExtractor(calibration, params).extract(observations, tracks)
    by_id = {p.id: p for p in players}
    rallies = [interpret_rally(i, re, by_id, tracks) for i, re in enumerate(rally_events)]
    rallies = [r for r in rallies if r.shots]
    apply_serve_rules(rallies)
    return MatchAnalysis(players, rallies, compute_stats(players, rallies, tracks), tracks)


def analyze_video(
    video_path: str,
    players: list[Player],
    calibration: CourtCalibration,
    detector=None,
    params: EventParams | None = None,
    progress=None,
) -> MatchAnalysis:
    """Analyse d'un fichier vidéo enregistré par la borne (nécessite OpenCV)."""
    from .detection import observe_video

    observations = observe_video(video_path, detector=detector, progress=progress)
    return analyze_observations(observations, players, calibration, params)
