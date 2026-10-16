"""Détection des joueurs et de la balle sur une vraie vidéo.

- Joueurs : YOLO (ultralytics), classe « person ».
- Balle : une balle de padel fait 3 à 8 pixels à l'image. Un YOLO générique
  (classe « sports ball ») la rate souvent : pour la production, il faut un
  modèle entraîné sur des images de padel (YOLO fine-tuné ou TrackNet).
  En attendant, `MotionBallDetector` repère les petits objets jaunes en
  mouvement par soustraction de fond : simple, rapide, sans GPU.

Dépendances optionnelles : `pip install opencv-python ultralytics`.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

import numpy as np

from .identity import appearance_from_crop
from .models import Box, FrameObservation, PersonDetection


class PersonDetector(Protocol):
    def persons(self, frame_bgr: np.ndarray) -> list[PersonDetection]: ...


class BallDetector(Protocol):
    def candidates(self, frame_bgr: np.ndarray) -> list[tuple[float, float, float]]:
        """Positions candidates (u, v, confiance)."""
        ...


class YoloPersonDetector:
    def __init__(self, model: str = "yolo11n.pt", conf: float = 0.4, device: str | None = None):
        from ultralytics import YOLO

        self.model = YOLO(model)
        self.conf = conf
        self.device = device

    def persons(self, frame_bgr: np.ndarray) -> list[PersonDetection]:
        result = self.model.predict(frame_bgr, classes=[0], conf=self.conf, device=self.device, verbose=False)[0]
        out = []
        for (x1, y1, x2, y2), score in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist()):
            crop = frame_bgr[int(y1) : int(y2), int(x1) : int(x2), ::-1]
            out.append(PersonDetection(Box(x1, y1, x2, y2), appearance_from_crop(crop) if crop.size else None, score))
        return out


class YoloBallDetector:
    """Balle par YOLO : modèle générique (classe 32) ou modèle entraîné sur le padel."""

    def __init__(self, model: str = "yolo11n.pt", ball_class: int = 32, conf: float = 0.15, imgsz: int = 1280):
        from ultralytics import YOLO

        self.model = YOLO(model)
        self.cls = ball_class
        self.conf = conf
        self.imgsz = imgsz

    def candidates(self, frame_bgr: np.ndarray) -> list[tuple[float, float, float]]:
        result = self.model.predict(frame_bgr, classes=[self.cls], conf=self.conf, imgsz=self.imgsz, verbose=False)[0]
        return [((x1 + x2) / 2, (y1 + y2) / 2, s) for (x1, y1, x2, y2), s in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist())]


class MotionBallDetector:
    """Petits objets jaune-vert en mouvement (soustraction de fond, OpenCV)."""

    def __init__(self, min_area: int = 3, max_area: int = 150):
        import cv2

        self.cv2 = cv2
        self.bg = cv2.createBackgroundSubtractorMOG2(history=120, varThreshold=24, detectShadows=False)
        self.min_area = min_area
        self.max_area = max_area

    def candidates(self, frame_bgr: np.ndarray) -> list[tuple[float, float, float]]:
        cv2 = self.cv2
        moving = self.bg.apply(frame_bgr)
        hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
        yellow = cv2.inRange(hsv, (22, 70, 90), (45, 255, 255))
        mask = cv2.morphologyEx(cv2.bitwise_and(moving, yellow), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
        n, _, stats, centroids = cv2.connectedComponentsWithStats(mask)
        out = []
        for i in range(1, n):
            area = stats[i, cv2.CC_STAT_AREA]
            if self.min_area <= area <= self.max_area:
                w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
                roundness = min(w, h) / max(w, h)
                out.append((float(centroids[i][0]), float(centroids[i][1]), float(roundness)))
        return out


class BallTracker:
    """Choisit, image après image, le candidat cohérent avec la trajectoire en cours."""

    def __init__(self, max_jump_px: float = 120.0, max_missing: int = 8):
        self.max_jump = max_jump_px
        self.max_missing = max_missing
        self.pos: np.ndarray | None = None
        self.vel = np.zeros(2)
        self.missing = 0

    def update(self, cands: list[tuple[float, float, float]]) -> tuple[float, float] | None:
        if not cands:
            self.missing += 1
            if self.missing > self.max_missing:
                self.pos = None
            return None
        pts = np.array([[c[0], c[1]] for c in cands])
        conf = np.array([c[2] for c in cands])
        if self.pos is None:
            best = int(np.argmax(conf))
        else:
            pred = self.pos + self.vel * (self.missing + 1)
            dist = np.linalg.norm(pts - pred, axis=1)
            best = int(np.argmin(dist - 20 * conf))
            if dist[best] > self.max_jump * (self.missing + 1):
                self.missing += 1
                if self.missing > self.max_missing:
                    self.pos = None
                return None
        new = pts[best]
        if self.pos is not None:
            self.vel = (new - self.pos) / (self.missing + 1)
        self.pos, self.missing = new, 0
        return float(new[0]), float(new[1])


def observe_video(
    path: str,
    detector: PersonDetector | None = None,
    ball_detector: BallDetector | None = None,
    person_every: int = 2,
    progress: Callable[[float], None] | None = None,
) -> list[FrameObservation]:
    """Lit la vidéo et produit les observations image par image."""
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise FileNotFoundError(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    detector = detector or YoloPersonDetector()
    ball_detector = ball_detector or MotionBallDetector()
    tracker = BallTracker()
    observations: list[FrameObservation] = []
    persons: list[PersonDetection] = []
    k = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if k % person_every == 0:  # les joueurs bougent moins vite que la balle
            persons = detector.persons(frame)
        ball = tracker.update(ball_detector.candidates(frame))
        observations.append(FrameObservation(k / fps, ball, list(persons)))
        k += 1
        if progress and k % 300 == 0:
            progress(min(k / total, 1.0))
    cap.release()
    return observations
