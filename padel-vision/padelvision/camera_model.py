"""Modèle de caméra sténopé, utilisé par le simulateur et pour dimensionner l'installation."""

from __future__ import annotations

import numpy as np


def look_at_projection(
    position: tuple[float, float, float],
    target: tuple[float, float, float],
    focal_px: float,
    size: tuple[int, int] = (1280, 720),
) -> np.ndarray:
    c = np.asarray(position, dtype=float)
    fwd = np.asarray(target, dtype=float) - c
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(fwd, right)
    r = np.vstack([right, down, fwd])
    k = np.array([[focal_px, 0, size[0] / 2], [0, focal_px, size[1] / 2], [0, 0, 1]])
    return k @ np.hstack([r, -(r @ c)[:, None]])


# Caméra type : sur le côté, à hauteur du filet, sur un mât à 8 m de haut et
# 6 m du grillage, objectif grand angle (~100° horizontal). La longueur du
# terrain est alors horizontale dans l'image : rebonds = « V » verticaux,
# frappes = demi-tours horizontaux, faciles à distinguer.
DEFAULT_CAMERA = dict(position=(-6.0, 10.0, 8.0), target=(5.0, 10.0, 0.5), focal_px=550.0)
