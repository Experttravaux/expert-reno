"""Calibration de la caméra (fixe) par rapport au terrain.

À l'installation, sur une image de la caméra, on clique une dizaine de
repères dont on connaît la position 3D (coins, lignes de service, haut du
filet, haut des vitres du fond). On en déduit la matrice de projection P
(3x4) par DLT : elle relie tout point 3D du terrain à son pixel.

- Le plan du sol (z = 0) donne une homographie : position exacte des pieds
  des joueurs.
- P complète permet de reconstruire la trajectoire 3D de la balle
  (voir trajectory.py), et donc de distinguer un rebond d'une frappe.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .models import COURT_LENGTH, COURT_WIDTH, NET_Y

SERVICE_LINE_FROM_NET = 6.95
NET_HEIGHT_CENTER = 0.88
NET_HEIGHT_POST = 0.92
BACK_GLASS_HEIGHT = 3.0

# Repères à cliquer, (nom, x, y, z) en mètres. La caméra est sur le côté
# x < 0 (voir camera_model.py) ; « opposé » = côté x = 10.
REFERENCE_POINTS: list[tuple[str, float, float, float]] = [
    ("coin proche y=0", 0.0, 0.0, 0.0),
    ("coin opposé y=0", COURT_WIDTH, 0.0, 0.0),
    ("coin opposé y=20", COURT_WIDTH, COURT_LENGTH, 0.0),
    ("coin proche y=20", 0.0, COURT_LENGTH, 0.0),
    ("ligne de service proche y=3", 0.0, NET_Y - SERVICE_LINE_FROM_NET, 0.0),
    ("ligne de service opposée y=3", COURT_WIDTH, NET_Y - SERVICE_LINE_FROM_NET, 0.0),
    ("ligne de service proche y=17", 0.0, NET_Y + SERVICE_LINE_FROM_NET, 0.0),
    ("ligne de service opposée y=17", COURT_WIDTH, NET_Y + SERVICE_LINE_FROM_NET, 0.0),
    ("pied du filet proche", 0.0, NET_Y, 0.0),
    ("pied du filet opposé", COURT_WIDTH, NET_Y, 0.0),
    ("haut du filet proche", 0.0, NET_Y, NET_HEIGHT_POST),
    ("haut du filet milieu", COURT_WIDTH / 2, NET_Y, NET_HEIGHT_CENTER),
    ("haut du filet opposé", COURT_WIDTH, NET_Y, NET_HEIGHT_POST),
    ("haut vitre coin opposé y=0", COURT_WIDTH, 0.0, BACK_GLASS_HEIGHT),
    ("haut vitre coin opposé y=20", COURT_WIDTH, COURT_LENGTH, BACK_GLASS_HEIGHT),
]


def _normalizer(points: np.ndarray) -> np.ndarray:
    """Matrice de normalisation de Hartley (centrage + mise à l'échelle)."""
    mean = points.mean(axis=0)
    scale = np.sqrt(points.shape[1]) / (np.linalg.norm(points - mean, axis=1).mean() + 1e-12)
    dim = points.shape[1]
    t = np.eye(dim + 1)
    t[:dim, :dim] *= scale
    t[:dim, dim] = -scale * mean
    return t


def projection_from_points(world: np.ndarray, image: np.ndarray) -> np.ndarray:
    """Matrice de projection 3x4 par DLT normalisée (au moins 6 points non coplanaires)."""
    world = np.asarray(world, dtype=float)
    image = np.asarray(image, dtype=float)
    if len(world) < 6 or len(world) != len(image):
        raise ValueError("Il faut au moins 6 correspondances 3D/2D")
    if np.ptp(world[:, 2]) < 1e-6:
        raise ValueError("Les repères doivent inclure des points en hauteur (filet, vitres)")
    tw, ti = _normalizer(world), _normalizer(image)
    wn = (np.hstack([world, np.ones((len(world), 1))]) @ tw.T)
    im = (np.hstack([image, np.ones((len(image), 1))]) @ ti.T)
    rows = []
    for x, (u, v, _) in zip(wn, im):
        rows.append(np.concatenate([x, np.zeros(4), -u * x]))
        rows.append(np.concatenate([np.zeros(4), x, -v * x]))
    _, _, vt = np.linalg.svd(np.array(rows))
    pn = vt[-1].reshape(3, 4)
    p = np.linalg.inv(ti) @ pn @ tw
    # Signe choisi pour que la profondeur (3e ligne) soit positive devant la caméra.
    center = world.mean(axis=0)
    if p[2] @ np.append(center, 1.0) < 0:
        p = -p
    return p / np.linalg.norm(p[2, :3])


def project(p: np.ndarray, points: np.ndarray) -> np.ndarray:
    pts = np.atleast_2d(np.asarray(points, dtype=float))
    homog = np.hstack([pts, np.ones((len(pts), 1))]) @ p.T
    return homog[:, :2] / homog[:, 2:3]


@dataclass
class CourtCalibration:
    projection: np.ndarray  # P, 3x4

    def __post_init__(self) -> None:
        self.projection = np.asarray(self.projection, dtype=float)
        ground = self.projection[:, [0, 1, 3]]  # z = 0
        self._img_to_ground = np.linalg.inv(ground)

    @classmethod
    def from_clicks(cls, image_points: list[tuple[float, float]], names: list[str] | None = None) -> CourtCalibration:
        """Construit la calibration depuis les clics (dans l'ordre de REFERENCE_POINTS, ou nommés)."""
        refs = REFERENCE_POINTS if names is None else [r for n in names for r in REFERENCE_POINTS if r[0] == n]
        world = np.array([[x, y, z] for _, x, y, z in refs[: len(image_points)]])
        return cls(projection_from_points(world, np.array(image_points)))

    def to_image(self, x: float, y: float, z: float = 0.0) -> tuple[float, float]:
        u, v = project(self.projection, [[x, y, z]])[0]
        return float(u), float(v)

    def to_court(self, u: float, v: float) -> tuple[float, float]:
        """Pixel -> point du sol (valable pour les pieds d'un joueur, un rebond)."""
        g = self._img_to_ground @ np.array([u, v, 1.0])
        return float(g[0] / g[2]), float(g[1] / g[2])

    def reprojection_error(self, world: np.ndarray, image: np.ndarray) -> float:
        return float(np.linalg.norm(project(self.projection, world) - image, axis=1).mean())

    @staticmethod
    def inside(x: float, y: float, margin: float = 0.0) -> bool:
        return -margin <= x <= COURT_WIDTH + margin and -margin <= y <= COURT_LENGTH + margin

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps({"projection": self.projection.tolist()}, indent=2))

    @classmethod
    def load(cls, path: str | Path) -> CourtCalibration:
        return cls(np.array(json.loads(Path(path).read_text())["projection"]))
