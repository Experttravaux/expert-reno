"""Enregistrement de la caméra du terrain pendant la partie (OpenCV)."""

from __future__ import annotations

import threading
import time
from pathlib import Path


class Recorder:
    """Enregistre un flux caméra (webcam USB ou flux RTSP d'une caméra IP) dans un fichier."""

    def __init__(self, source: str | int = 0, width: int = 1280, height: int = 720, fps: int = 60):
        self.source = int(source) if str(source).isdigit() else source
        self.size = (width, height)
        self.fps = fps
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.path: Path | None = None
        self.frames = 0
        self.error: str | None = None

    @property
    def recording(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, path: str | Path) -> None:
        if self.recording:
            raise RuntimeError("Enregistrement déjà en cours")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._stop.clear()
        self.frames, self.error = 0, None
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> Path | None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=10)
        return self.path

    def _run(self) -> None:
        import cv2

        cap = cv2.VideoCapture(self.source)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.size[0])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.size[1])
        cap.set(cv2.CAP_PROP_FPS, self.fps)
        if not cap.isOpened():
            self.error = f"Caméra introuvable : {self.source}"
            return
        real_fps = cap.get(cv2.CAP_PROP_FPS) or self.fps
        writer = cv2.VideoWriter(str(self.path), cv2.VideoWriter_fourcc(*"mp4v"), real_fps, self.size)
        try:
            while not self._stop.is_set():
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.01)
                    continue
                if (frame.shape[1], frame.shape[0]) != self.size:
                    frame = cv2.resize(frame, self.size)
                writer.write(frame)
                self.frames += 1
        finally:
            writer.release()
            cap.release()


class FakeRecorder(Recorder):
    """Mode démo : n'enregistre rien, l'analyse utilisera une partie simulée."""

    def start(self, path: str | Path) -> None:
        self.path = Path(path)
        self.started = time.time()

    def stop(self) -> Path | None:
        return self.path

    @property
    def recording(self) -> bool:
        return False
