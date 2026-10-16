"""Événements de balle (frappes, rebonds, vitres, filet) à partir du suivi 2D."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .court import CourtCalibration
from .identity import Tracks
from .models import COURT_LENGTH, COURT_WIDTH, NET_Y, BallEvent, EventType, FrameObservation
from .trajectory import (
    AnchoredFit,
    BallSegment,
    anchored_fit,
    detect_kinks,
    pixel_ray,
    ray_closest_to_vertical,
    ray_plane,
    split_track,
)

WALLS = [(1, 0.0), (1, COURT_LENGTH), (0, 0.0), (0, COURT_WIDTH)]  # (axe, valeur)


@dataclass
class EventParams:
    segment_gap_s: float = 0.25  # trou de suivi qui coupe un segment de trajectoire
    rally_gap_s: float = 1.5  # balle absente plus longtemps : fin de l'échange
    hit_reach_m: float = 1.6  # distance max balle / joueur pour une frappe
    max_rms_px: float = 4.0  # au-delà, aucune hypothèse n'explique la cassure
    kink_window_s: float = 0.13  # durée de la fenêtre d'estimation de vitesse
    # Préférence a priori (pixels ajoutés au résidu) : vitres et filet sont
    # plus rares que frappes et rebonds, on ne les retient que s'ils
    # expliquent nettement mieux la trajectoire.
    prior_px: dict = None

    def __post_init__(self):
        if self.prior_px is None:
            self.prior_px = {EventType.HIT: 0.0, EventType.BOUNCE: 0.0, EventType.WALL: 0.1, EventType.NET: 0.1}


@dataclass
class RallyEvents:
    t_start: float
    t_end: float
    events: list[BallEvent]


@dataclass
class _Hypothesis:
    type: EventType
    anchor: np.ndarray
    rms: float
    v_in: np.ndarray | None
    v_out: np.ndarray | None
    player_id: str | None = None
    bounce_before: np.ndarray | None = None  # rebond au pied de la vitre (hypothèse composite)


def _fits(p, anchor, t_star, before, after) -> tuple[float, AnchoredFit | None, AnchoredFit | None] | None:
    fb = anchored_fit(p, anchor, t_star, *before) if before is not None else None
    fa = anchored_fit(p, anchor, t_star, *after) if after is not None else None
    parts = [f for f in (fb, fa) if f is not None]
    if not parts:
        return None
    n = sum(f.n for f in parts)
    rms = float(np.sqrt(sum(f.rms_px**2 * f.n for f in parts) / n))
    return rms, fb, fa


MAX_ENERGY_GAIN = 1.1  # un rebond (sol, vitre) ne peut pas accélérer la balle


def _loses_energy(v_in, v_out) -> bool:
    if v_in is None or v_out is None:
        return True
    return float(np.linalg.norm(v_out)) <= MAX_ENERGY_GAIN * float(np.linalg.norm(v_in))


def _plausible_bounce(v_in, v_out) -> bool:
    if not _loses_energy(v_in, v_out):
        return False
    if v_in is not None and v_in[2] > -0.5:
        return False
    if v_out is not None and v_out[2] < 0.3:
        return False
    if v_in is not None and v_out is not None and v_in[:2] @ v_out[:2] <= 0:
        return False
    return True


def _plausible_hit(v_out, player_y: float) -> bool:
    if v_out is None:
        return False
    toward_net = np.sign(NET_Y - player_y)
    speed = float(np.linalg.norm(v_out))
    return v_out[1] * toward_net > 0.5 and 2.0 < speed < 60.0


def _plausible_wall(v_in, v_out, axis: int, value: float, center: float) -> bool:
    if not _loses_energy(v_in, v_out):
        return False
    into = np.sign(value - center)
    if v_in is not None and v_in[axis] * into <= 0.3:
        return False
    if v_out is not None and v_out[axis] * into >= -0.1:
        return False
    return v_in is not None or v_out is not None


def _plausible_net(v_in, v_out, anchor) -> bool:
    if v_in is None:
        return False
    toward = np.sign(NET_Y - (anchor[1] - v_in[1] * 0.1))
    if v_in[1] * toward <= 0.5:
        return False
    return v_out is None or v_out[1] * toward < 0.4 * abs(v_in[1])


class EventExtractor:
    def __init__(self, calibration: CourtCalibration, params: EventParams | None = None):
        self.cal = calibration
        self.p = calibration.projection
        self.params = params or EventParams()

    # -- hypothèses ---------------------------------------------------------

    def _hypotheses(self, t_star, uv, before, after, tracks: Tracks) -> list[_Hypothesis]:
        origin, d = pixel_ray(self.p, *uv)
        out: list[_Hypothesis] = []

        def add(kind, anchor, check, player_id=None):
            res = _fits(self.p, anchor, t_star, before, after)
            if res is None:
                return
            rms, fb, fa = res
            v_in = fb.velocity if fb else None
            v_out = fa.velocity if fa else None
            if check(v_in, v_out):
                out.append(_Hypothesis(kind, anchor, rms, v_in, v_out, player_id))

        ground = ray_plane(origin, d, 2, 0.0)
        if ground is not None and self.cal.inside(ground[0], ground[1], margin=0.3):
            add(EventType.BOUNCE, ground, _plausible_bounce)

        for pid, (px, py) in tracks.positions(t_star).items():
            anchor = ray_closest_to_vertical(origin, d, px, py)
            reach = float(np.hypot(anchor[0] - px, anchor[1] - py))
            if reach <= self.params.hit_reach_m and 0.15 <= anchor[2] <= 3.2:
                add(EventType.HIT, anchor, lambda vi, vo, py=py: _plausible_hit(vo, py), pid)

        for axis, value in WALLS:
            anchor = ray_plane(origin, d, axis, value)
            if anchor is None or not (0.1 <= anchor[2] <= 4.5):
                continue
            other = 1 - axis
            limit = COURT_LENGTH if other == 1 else COURT_WIDTH
            if not (-0.2 <= anchor[other] <= limit + 0.2):
                continue
            center = COURT_LENGTH / 2 if axis == 1 else COURT_WIDTH / 2
            add(
                EventType.WALL,
                anchor,
                lambda vi, vo, a=axis, v=value, c=center: _plausible_wall(vi, vo, a, v, c),
            )

        net = ray_plane(origin, d, 1, NET_Y)
        if net is not None and 0.0 <= net[2] <= 1.0 and 0.0 <= net[0] <= COURT_WIDTH:
            add(EventType.NET, net, lambda vi, vo, a=net: _plausible_net(vi, vo, a))

        if ground is not None and before is not None and after is not None:
            out.extend(self._bounce_then_wall(t_star, origin, d, ground, before, after))
        return out

    def _bounce_then_wall(self, t_star, origin, d, ground, before, after) -> list[_Hypothesis]:
        """Rebond au sol puis vitre, trop rapprochés pour être séparés : une seule cassure.

        L'arrivée est ajustée en passant par le sol, le départ en passant par la vitre.
        """
        out = []
        for axis, value in WALLS:
            if abs(ground[axis] - value) > 2.0 or not self.cal.inside(ground[0], ground[1], margin=0.3):
                continue
            wall = ray_plane(origin, d, axis, value)
            if wall is None or not (0.0 <= wall[2] <= 1.5):
                continue
            fb = anchored_fit(self.p, ground, t_star, *before)
            fa = anchored_fit(self.p, wall, t_star, *after)
            if fb is None or fa is None:
                continue
            center = COURT_LENGTH / 2 if axis == 1 else COURT_WIDTH / 2
            into = np.sign(value - center)
            v_in, v_out = fb.velocity, fa.velocity
            if not (
                v_in[2] < -0.5
                and v_in[axis] * into > 0.3
                and v_out[axis] * into < -0.1
                and _loses_energy(v_in, v_out)
            ):
                continue
            n = fb.n + fa.n
            rms = float(np.sqrt((fb.rms_px**2 * fb.n + fa.rms_px**2 * fa.n) / n))
            out.append(_Hypothesis(EventType.WALL, wall, rms, v_in, v_out, bounce_before=ground))
        return out

    def _choose(self, hyps: list[_Hypothesis], t_star: float) -> list[BallEvent]:
        hyps = [h for h in hyps if h.rms <= self.params.max_rms_px]
        if not hyps:
            return []
        ranked = sorted(hyps, key=lambda x: x.rms + self.params.prior_px[x.type])
        events = [self._event(h, t_star) for h in ranked]
        events[0].alternatives = events[1:]
        best = ranked[0]
        if best.bounce_before is None:
            return [events[0]]
        # Hypothèse composite : rebond juste avant la vitre.
        v_h = float(np.linalg.norm(best.v_in[:2])) + 1e-6
        dt = float(np.linalg.norm(best.anchor[:2] - best.bounce_before[:2])) / v_h
        bounce = BallEvent(
            EventType.BOUNCE,
            t_star - dt,
            tuple(float(c) for c in best.bounce_before),
            v_in=tuple(float(c) for c in best.v_in),
            score=events[0].score,
        )
        return [bounce, events[0]]

    def _event(self, h: _Hypothesis, t_star: float) -> BallEvent:
        speed = float(np.linalg.norm(h.v_out)) * 3.6 if h.v_out is not None else 0.0
        return BallEvent(
            h.type,
            t_star,
            tuple(float(c) for c in h.anchor),
            speed,
            h.player_id,
            v_in=None if h.v_in is None else tuple(float(c) for c in h.v_in),
            v_out=None if h.v_out is None else tuple(float(c) for c in h.v_out),
            score=h.rms + self.params.prior_px[h.type],
        )

    # -- pipeline -----------------------------------------------------------

    def segment_events(self, seg: BallSegment, tracks: Tracks) -> list[BallEvent]:
        events: list[BallEvent] = []
        # Début de segment : la balle part souvent d'une raquette (service, relance).
        t0, uv0 = seg.t[0], (float(seg.uv[0, 0]), float(seg.uv[0, 1]))
        start = seg.start_points()
        hyps = [h for h in self._hypotheses(t0, uv0, None, start, tracks) if h.type == EventType.HIT]
        events.extend(self._choose(hyps, t0))
        for k, kink in enumerate(seg.kinks):
            before = seg.side_points(k, before=True)
            after = seg.side_points(k, before=False)
            events.extend(self._choose(self._hypotheses(kink.t, kink.uv, before, after, tracks), kink.t))
        return events

    def extract(self, observations: list[FrameObservation], tracks: Tracks) -> list[RallyEvents]:
        pts = [(o.t, o.ball) for o in observations if o.ball is not None]
        if not pts:
            return []
        t = np.array([p[0] for p in pts])
        uv = np.array([p[1] for p in pts], dtype=float)
        rallies: list[RallyEvents] = []
        dt = float(np.median(np.diff(t))) if len(t) > 1 else 1 / 30
        window = max(3, round(self.params.kink_window_s / dt))
        for ts, us in split_track(t, uv, max_gap=self.params.segment_gap_s):
            seg = BallSegment(ts, us, detect_kinks(ts, us, window=window))
            events = self.segment_events(seg, tracks)
            if rallies and ts[0] - rallies[-1].t_end < self.params.rally_gap_s:
                rallies[-1].events.extend(events)
                rallies[-1].t_end = float(ts[-1])
            else:
                rallies.append(RallyEvents(float(ts[0]), float(ts[-1]), events))
        return rallies
