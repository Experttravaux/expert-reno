"""Structures de données partagées par tout le pipeline.

Repère terrain (en mètres) :
    x ∈ [0, 10]  largeur du terrain
    y ∈ [0, 20]  longueur, filet à y = 10
    équipe 1 côté y < 10 (côté caméra), équipe 2 côté y > 10
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import numpy as np

COURT_WIDTH = 10.0
COURT_LENGTH = 20.0
NET_Y = 10.0


def side_of(y: float) -> int:
    """Équipe (1 ou 2) propriétaire de la moitié de terrain contenant y."""
    return 1 if y < NET_Y else 2


@dataclass
class Player:
    id: str
    name: str
    team: int  # 1 = côté caméra au début de la partie, 2 = côté opposé
    appearance: np.ndarray | None = None  # signature couleur des vêtements
    photo_path: str | None = None


@dataclass
class Box:
    """Boîte englobante en pixels."""

    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def feet(self) -> tuple[float, float]:
        return ((self.x1 + self.x2) / 2, self.y2)

    def expanded(self, ratio: float) -> Box:
        dx = (self.x2 - self.x1) * ratio
        dy = (self.y2 - self.y1) * ratio
        return Box(self.x1 - dx, self.y1 - dy, self.x2 + dx, self.y2 + dy)

    def contains(self, u: float, v: float) -> bool:
        return self.x1 <= u <= self.x2 and self.y1 <= v <= self.y2


@dataclass
class PersonDetection:
    box: Box
    appearance: np.ndarray | None = None
    score: float = 1.0


@dataclass
class FrameObservation:
    """Ce que le détecteur voit sur une image."""

    t: float
    ball: tuple[float, float] | None  # position pixel de la balle
    persons: list[PersonDetection] = field(default_factory=list)


@dataclass
class PlayerState:
    """Position d'un joueur identifié à un instant donné."""

    player_id: str
    box: Box
    court_xy: tuple[float, float]


class EventType(str, Enum):
    HIT = "hit"  # frappe d'un joueur
    BOUNCE = "bounce"  # rebond au sol
    NET = "net"  # balle dans le filet
    WALL = "wall"  # vitre ou grille


@dataclass
class BallEvent:
    type: EventType
    t: float
    position: tuple[float, float, float]  # position 3D de la balle (m)
    speed_kmh: float = 0.0  # vitesse de la balle juste après l'événement
    player_id: str | None = None  # frappeur (coup)
    v_in: tuple[float, float, float] | None = None  # vitesse 3D juste avant (m/s)
    v_out: tuple[float, float, float] | None = None  # vitesse 3D juste après (m/s)
    score: float = 0.0  # résidu (px) de l'hypothèse retenue, plus bas = plus sûr
    implied: bool = False  # déduit par la physique, pas observé directement
    alternatives: list[BallEvent] = field(default_factory=list)  # autres lectures possibles

    @property
    def court_xy(self) -> tuple[float, float]:
        return self.position[0], self.position[1]


class ShotOutcome(str, Enum):
    IN_PLAY = "in_play"  # la balle a été renvoyée
    WINNER = "winner"  # point gagnant
    NET = "net"  # filet
    OUT = "out"  # dehors
    UNKNOWN = "unknown"


@dataclass
class Shot:
    player_id: str
    team: int
    t: float
    position: tuple[float, float]  # position du frappeur sur le terrain
    is_serve: bool = False
    is_volley: bool = False
    speed_kmh: float = 0.0
    landing: tuple[float, float] | None = None
    outcome: ShotOutcome = ShotOutcome.IN_PLAY
    well_placed: bool = False
    forced_error: bool = False  # faute provoquée par une balle difficile


@dataclass
class Rally:
    index: int
    t_start: float
    t_end: float
    shots: list[Shot] = field(default_factory=list)
    winner_team: int | None = None
    ended_by: str = ""  # winner / net / out / unknown
    decisive_player: str | None = None  # auteur du coup gagnant ou de la faute
    unreturned_by: str | None = None  # joueur qui n'a pas rattrapé la balle


@dataclass
class PlayerStats:
    player_id: str
    name: str
    team: int
    shots: int = 0
    serves: int = 0
    volleys: int = 0
    winners: int = 0
    unforced_errors: int = 0
    forced_errors: int = 0
    net_errors: int = 0
    out_errors: int = 0
    unreturned: int = 0
    well_placed: int = 0
    points_won: int = 0  # points gagnés par son équipe
    points_played: int = 0
    max_speed_kmh: float = 0.0
    serve_faults: int = 0
    distance_m: float = 0.0
    net_presence: float = 0.0  # part des coups joués près du filet
    heatmap: list[list[int]] = field(default_factory=list)  # grille 5x10 de sa moitié

    @property
    def success_rate(self) -> float:
        """Part des coups qui ne finissent pas en faute."""
        if not self.shots:
            return 0.0
        return 1 - (self.unforced_errors + self.forced_errors) / self.shots

    def tips(self) -> list[str]:
        """Axes d'amélioration simples, déduits des chiffres."""
        out: list[str] = []
        if self.shots and self.unforced_errors / self.shots > 0.08:
            out.append(
                "Trop de fautes directes : privilégie la balle de sécurité "
                "(lob, bandeja) plutôt que le coup risqué."
            )
        if self.net_errors > self.out_errors and self.net_errors >= 2:
            out.append("La plupart de tes fautes vont dans le filet : frappe plus haut, ouvre la raquette.")
        if self.out_errors > self.net_errors and self.out_errors >= 2:
            out.append("Tes fautes sortent : moins de puissance, laisse travailler la vitre.")
        if self.unreturned >= 3:
            out.append(
                "Plusieurs balles non rattrapées dans ta zone : replace-toi "
                "plus vite après chaque coup et reste sur tes appuis."
            )
        if self.shots and self.net_presence < 0.25:
            out.append("Tu joues peu au filet : monte après un bon lob, c'est là que se gagnent les points.")
        if self.shots and self.well_placed / self.shots < 0.15:
            out.append("Peu de balles bien placées : vise les grilles, les pieds adverses et le fond du terrain.")
        if not out:
            out.append("Très bonne partie : continue comme ça !")
        return out
