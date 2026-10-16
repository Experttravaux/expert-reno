"""Simulateur de partie : génère ce que verrait la caméra, avec la vérité terrain.

Sert à développer et tester tout le moteur sans vidéo réelle : physique de
la balle (gravité, frottement de l'air, rebonds, vitres, filet), joueurs qui
se déplacent, caméra virtuelle, bruit de détection et balles perdues.
Les statistiques « vraies » sont calculées avec le même code que le moteur,
à partir des vrais coups : on compare donc exactement ce qui doit l'être.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .camera_model import DEFAULT_CAMERA, look_at_projection
from .court import REFERENCE_POINTS, CourtCalibration, project
from .identity import HIST_BINS, Tracks
from .models import (
    COURT_LENGTH,
    COURT_WIDTH,
    NET_Y,
    Box,
    FrameObservation,
    PersonDetection,
    Player,
    PlayerState,
    Rally,
    Shot,
    ShotOutcome,
    side_of,
)
from .physics import BALL_DRAG as DRAG
from .physics import NET_HEIGHT, G
from .rally import is_well_placed

IMAGE_SIZE = (1280, 720)


@dataclass
class _Ball:
    p: np.ndarray
    v: np.ndarray
    t: float


@dataclass
class _FlightLog:
    bounces: list[tuple[float, np.ndarray]] = field(default_factory=list)
    walls: list[tuple[float, np.ndarray]] = field(default_factory=list)
    net: list[tuple[float, np.ndarray]] = field(default_factory=list)
    stopped: bool = False


@dataclass
class SimResult:
    observations: list[FrameObservation]
    players: list[Player]
    calibration: CourtCalibration
    truth_rallies: list[Rally]
    truth_tracks: Tracks
    fps: int


def _color_signature(rng: np.random.Generator, main: int, second: int) -> np.ndarray:
    h = rng.random(HIST_BINS**3) * 0.02
    h[main] += 0.65
    h[second] += 0.3
    return h / h.sum()


class MatchSimulator:
    def __init__(
        self,
        seed: int = 0,
        n_rallies: int = 30,
        fps: int = 30,
        noise_px: float = 1.0,
        drop_rate: float = 0.03,
        names: tuple[str, str, str, str] = ("A", "B", "C", "D"),
    ):
        self.rng = np.random.default_rng(seed)
        self.n_rallies = n_rallies
        self.fps = fps
        self.noise = noise_px
        self.drop = drop_rate
        self.sub = 8
        self.dt = 1.0 / (fps * self.sub)
        self.P = look_at_projection(**DEFAULT_CAMERA, size=IMAGE_SIZE)
        colors = [(5, 21), (40, 63), (48, 12), (60, 2)]  # rouge, blanc, bleu, jaune
        self.players = [
            Player(f"p{i + 1}", name, team=1 if i < 2 else 2, appearance=_color_signature(self.rng, *colors[i]))
            for i, name in enumerate(names)
        ]
        self.lane = {"p1": 7.5, "p2": 2.5, "p3": 7.5, "p4": 2.5}
        self.ball_samples: dict[int, np.ndarray] = {}
        self.true_events: list[tuple[str, float, np.ndarray, str | None]] = []  # pour le débogage
        self._bounces_since_last: list[tuple[float, np.ndarray]] = []
        self._last_speed = 0.0
        self.waypoints: dict[str, list[tuple[float, float, float]]] = {p.id: [] for p in self.players}

    # -- géométrie --------------------------------------------------------

    def _team_side(self, team: int, swapped: bool) -> int:
        return team if not swapped else 3 - team

    @staticmethod
    def _y_at_depth(side: int, depth_from_net: float) -> float:
        return NET_Y - depth_from_net if side == 1 else NET_Y + depth_from_net

    def _home(self, pid: str, side: int, at_net: bool) -> tuple[float, float]:
        return self.lane[pid], self._y_at_depth(side, 3.0 if at_net else 7.5)

    # -- physique ---------------------------------------------------------

    def _step(self, b: _Ball, log: _FlightLog) -> None:
        acc = np.array([0.0, 0.0, -G]) - DRAG * np.linalg.norm(b.v) * b.v
        b.v = b.v + acc * self.dt
        prev = b.p.copy()
        b.p = b.p + b.v * self.dt
        b.t += self.dt
        if b.p[2] < 0:
            b.p[2] = -b.p[2]
            b.v[2] = -0.75 * b.v[2]
            b.v[:2] *= 0.85
            log.bounces.append((b.t, b.p.copy()))
            self.true_events.append(("bounce", b.t, b.p.copy(), None))
        if (prev[1] - NET_Y) * (b.p[1] - NET_Y) < 0 and b.p[2] < NET_HEIGHT:
            b.p[1] = prev[1]
            b.v[1] = -0.1 * b.v[1]
            b.v[0] *= 0.3
            log.net.append((b.t, b.p.copy()))
            self.true_events.append(("net", b.t, b.p.copy(), None))
        for axis, lo, hi in ((1, 0.0, COURT_LENGTH), (0, 0.0, COURT_WIDTH)):
            if b.p[axis] < lo or b.p[axis] > hi:
                b.p[axis] = 2 * (lo if b.p[axis] < lo else hi) - b.p[axis]
                b.v[axis] = -0.7 * b.v[axis]
                log.walls.append((b.t, b.p.copy()))
                self.true_events.append(("wall", b.t, b.p.copy(), None))
        k = round(b.t * self.fps * self.sub)
        if k % self.sub == 0:
            self.ball_samples[k // self.sub] = b.p.copy()

    def _fly(self, b: _Ball, stop, max_s: float = 3.0) -> _FlightLog:
        log = _FlightLog()
        t_end = b.t + max_s
        while b.t < t_end:
            self._step(b, log)
            if stop(b, log):
                log.stopped = True
                break
        return log

    def _velocity_to(self, p0: np.ndarray, target: np.ndarray, flight_s: float) -> np.ndarray:
        d = target - p0
        v = d / flight_s
        v[2] = (d[2] + 0.5 * G * flight_s**2) / flight_s
        # Compense grossièrement le freinage de l'air.
        return v * (1 + DRAG * np.linalg.norm(d[:2]) / 2)

    # -- un coup ----------------------------------------------------------

    def _target(self, own_side: int, well: bool) -> np.ndarray:
        opp = 3 - own_side
        if well:
            depth = self.rng.uniform(7.6, 9.2) if self.rng.random() < 0.6 else self.rng.uniform(4, 8)
            x = self.rng.uniform(1.5, 8.5) if depth > 7.5 else self.rng.choice([self.rng.uniform(0.4, 0.9), self.rng.uniform(9.1, 9.6)])
        else:
            depth = self.rng.uniform(3.5, 7.0)
            x = self.rng.uniform(1.8, 8.2)
        return np.array([x, self._y_at_depth(opp, depth), 0.0])

    def _launch_in_play(self, b: _Ball, own_side: int) -> None:
        well = self.rng.random() < 0.3
        lob = self.rng.random() < 0.2
        for _ in range(6):
            target = self._target(own_side, well)
            dist = np.linalg.norm(target[:2] - b.p[:2])
            flight = self.rng.uniform(1.5, 2.0) if lob else dist / self.rng.uniform(13, 19)
            v = self._velocity_to(b.p, target, flight)
            # Vérifie le passage du filet (trajectoire sans frottement).
            t_net = (NET_Y - b.p[1]) / v[1]
            z_net = b.p[2] + v[2] * t_net - 0.5 * G * t_net**2
            if z_net > NET_HEIGHT + 0.25:
                b.v = v
                return
            lob = True
        b.v = v

    # -- une partie -------------------------------------------------------

    def run(self) -> SimResult:
        truth: list[Rally] = []
        t = 2.0
        swapped = False
        server_order = ["p1", "p3", "p2", "p4"]
        server_i, points_on_serve, pending_fault = 0, 0, False
        for r in range(self.n_rallies):
            if r == self.n_rallies // 2:
                swapped = True
                t += 20.0  # changement de côté
            server = server_order[server_i % 4]
            rally, t, fault = self._rally(r, t, server, swapped, second_serve=pending_fault)
            truth.append(rally)
            if fault and not pending_fault:
                pending_fault = True
                t += self.rng.uniform(3.0, 6.0)  # le serveur récupère une balle
                continue
            pending_fault = False
            points_on_serve += 1
            if points_on_serve == 4:
                server_i, points_on_serve = server_i + 1, 0
            t += self.rng.uniform(5.0, 8.0)
        return self._render(truth, t + 2.0)

    def _team_of(self, pid: str) -> int:
        return next(p.team for p in self.players if p.id == pid)

    def _rally(self, index: int, t0: float, server: str, swapped: bool, second_serve: bool):
        t0 = round(t0 * self.fps) / self.fps
        serve_team = self._team_of(server)
        homes = {}
        for p in self.players:
            side = self._team_side(p.team, swapped)
            homes[p.id] = self._home(p.id, side, at_net=(p.team == serve_team and p.id != server))
        server_side = self._team_side(serve_team, swapped)
        homes[server] = (self.lane[server], self._y_at_depth(server_side, 9.0))
        for pid, (x, y) in homes.items():
            self.waypoints[pid].append((t0 - 1.0, x, y))

        fault_prob = 0.3 if second_serve else 0.1
        serve_fault = self.rng.random() < fault_prob
        n_shots = 1 if serve_fault else int(self.rng.geometric(1 / 6))
        if serve_fault:
            ending = "net"
        else:
            ending = self.rng.choice(["winner", "net", "out"], p=[0.45, 0.25, 0.30])
            if n_shots == 1 and ending != "winner":
                n_shots = 2  # un service raté seul est une faute de service, tirée à part

        hx, hy = homes[server]
        b = _Ball(np.array([hx - 0.4, hy, 0.9]), np.zeros(3), t0)
        hitter = server
        rally = Rally(index, t0, t0)
        for n in range(n_shots):
            own_side = side_of(b.p[1])
            self._hit_waypoint(hitter, b, homes)
            self.true_events.append(("hit", b.t, b.p.copy(), hitter))
            shot = Shot(hitter, self._team_of(hitter), b.t, (float(b.p[0] + 0.4), float(b.p[1])), is_serve=n == 0)
            if n > 0:
                shot.is_volley = not self._bounces_since_last
            last = n == n_shots - 1
            if not last:
                self._launch_in_play(b, own_side)
                shot.speed_kmh = float(np.linalg.norm(b.v)) * 3.6
                volley = self.rng.random() < 0.2
                log = self._fly(b, self._intercept_stop(own_side, volley))
                self._bounces_since_last = [x for x in log.bounces if side_of(x[1][1]) != own_side]
                landing = self._bounces_since_last[0][1] if self._bounces_since_last else None
                shot.landing = (float(landing[0]), float(landing[1])) if landing is not None else None
                shot.well_placed = shot.landing is not None and is_well_placed(shot.landing)
                if not log.stopped:  # balle injouable : point gagnant
                    shot.outcome = ShotOutcome.WINNER
                    rally.shots.append(shot)
                    self._close_rally(rally, shot, log, homes, swapped)
                    break
                shot.outcome = ShotOutcome.IN_PLAY
                rally.shots.append(shot)
                hitter = self._receiver(b, own_side, swapped)
                continue
            outcome, landing, log = self._finish(b, own_side, ending)
            shot.speed_kmh = self._last_speed
            shot.outcome = outcome
            shot.landing = landing
            shot.well_placed = landing is not None and is_well_placed(landing)
            rally.shots.append(shot)
            self._close_rally(rally, shot, log, homes, swapped)
        rally.t_end = b.t
        for pid, (x, y) in homes.items():
            self.waypoints[pid].append((b.t + 0.8, x, y))
        if serve_fault and not second_serve:
            rally.ended_by, rally.winner_team = "serve_fault", None
        elif serve_fault:
            rally.ended_by = "double_fault"
        return rally, b.t, serve_fault

    def _hit_waypoint(self, pid: str, b: _Ball, homes) -> None:
        wps = self.waypoints[pid]
        x, y = float(b.p[0] + 0.4), float(b.p[1])
        if wps[-1][0] < b.t - 0.9:
            wps.append((b.t - 0.9, *homes[pid]))
        wps.append((b.t, x, y))
        wps.append((b.t + 0.9, *homes[pid]))

    def _intercept_stop(self, own_side: int, volley: bool):
        opp = 3 - own_side

        def stop(b: _Ball, log: _FlightLog) -> bool:
            if side_of(b.p[1]) != opp:
                return False
            depth = abs(b.p[1] - NET_Y)
            if volley and not log.bounces and 2.5 < depth < 5.5 and 0.8 < b.p[2] < 2.0:
                return True
            if not log.bounces:
                return False
            # Le joueur laisse monter la balle (éventuellement après la vitre)
            # et la frappe quand elle redescend.
            last_event = max([log.bounces[-1][0]] + [w[0] for w in log.walls])
            if b.t - last_event < 0.3 or len(log.bounces) > 1:
                return False
            since = b.t - log.bounces[0][0]
            return (since > 0.35 and b.p[2] < 1.3 and b.v[2] < 0) or since > 0.6

        return stop

    def _receiver(self, b: _Ball, own_side: int, swapped: bool) -> str:
        opp_team = next(team for team in (1, 2) if self._team_side(team, swapped) != own_side)
        cands = [p.id for p in self.players if p.team == opp_team]
        return min(cands, key=lambda pid: abs(self.lane[pid] - b.p[0]))

    def _finish(self, b: _Ball, own_side: int, ending: str):
        opp = 3 - own_side
        if ending == "winner":
            self._launch_in_play(b, own_side)
            self._last_speed = float(np.linalg.norm(b.v)) * 3.6
            log = self._fly(b, lambda bb, lg: len(lg.bounces) >= 2 and bb.t - lg.bounces[1][0] > 0.15, max_s=2.5)
            first = next((x for x in log.bounces if side_of(x[1][1]) == opp), None)
            landing = (float(first[1][0]), float(first[1][1])) if first else None
            return ShotOutcome.WINNER, landing, log
        if ending == "net":
            target = np.array([self.rng.uniform(2, 8), NET_Y, self.rng.uniform(0.3, 0.6)])
            flight = np.linalg.norm(target[:2] - b.p[:2]) / self.rng.uniform(12, 17)
            b.v = self._velocity_to(b.p, target, flight)
            self._last_speed = float(np.linalg.norm(b.v)) * 3.6
            log = self._fly(b, lambda bb, lg: bool(lg.bounces) and bb.t - lg.bounces[0][0] > 0.4, max_s=2.0)
            return ShotOutcome.NET, None, log
        wall_y = 0.0 if opp == 1 else COURT_LENGTH
        target = np.array([self.rng.uniform(2, 8), wall_y, self.rng.uniform(3.0, 3.8)])
        flight = np.linalg.norm(target[:2] - b.p[:2]) / self.rng.uniform(17, 23)
        b.v = self._velocity_to(b.p, target, flight)
        self._last_speed = float(np.linalg.norm(b.v)) * 3.6
        log = self._fly(b, lambda bb, lg: bool(lg.bounces) and bb.t - lg.bounces[0][0] > 0.4, max_s=2.5)
        return ShotOutcome.OUT, None, log

    def _close_rally(self, rally: Rally, shot: Shot, log: _FlightLog, homes, swapped: bool) -> None:
        rally.decisive_player = shot.player_id
        rally.ended_by = shot.outcome.value
        if shot.outcome == ShotOutcome.WINNER:
            rally.winner_team = shot.team
            first = next(x for x in log.bounces if side_of(x[1][1]) != side_of(shot.position[1]))
            opponents = [p.id for p in self.players if p.team != shot.team]
            pos = {pid: self._player_pos(pid, first[0]) for pid in opponents}
            rally.unreturned_by = min(opponents, key=lambda pid: np.hypot(*(np.array(pos[pid]) - first[1][:2])))
        else:
            rally.winner_team = 3 - shot.team
            prev = rally.shots[-2] if len(rally.shots) > 1 else None
            shot.forced_error = prev is not None and (prev.well_placed or prev.speed_kmh >= 80.0)

    def _player_pos(self, pid: str, t: float) -> tuple[float, float]:
        w = sorted(self.waypoints[pid])
        ts = [x[0] for x in w]
        return float(np.interp(t, ts, [x[1] for x in w])), float(np.interp(t, ts, [x[2] for x in w]))

    # -- rendu caméra -----------------------------------------------------

    def _render(self, truth: list[Rally], t_end: float) -> SimResult:
        world = np.array([r[1:] for r in REFERENCE_POINTS])
        clicks = project(self.P, world) + self.rng.normal(0, 0.7, (len(world), 2))
        cal = CourtCalibration.from_clicks(clicks.tolist())
        n_frames = int(t_end * self.fps)
        wps = {pid: sorted(w) for pid, w in self.waypoints.items()}
        observations: list[FrameObservation] = []
        tracks = Tracks()
        for k in range(n_frames):
            t = k / self.fps
            ball = None
            if k in self.ball_samples and self.rng.random() > self.drop:
                u, v = project(self.P, [self.ball_samples[k]])[0] + self.rng.normal(0, self.noise, 2)
                if 0 <= u < IMAGE_SIZE[0] and 0 <= v < IMAGE_SIZE[1]:
                    ball = (float(u), float(v))
            persons = []
            for p in self.players:
                w = wps[p.id]
                ts = [x[0] for x in w]
                x = float(np.interp(t, ts, [q[1] for q in w]))
                y = float(np.interp(t, ts, [q[2] for q in w]))
                persons.append(self._person(x, y, p.appearance))
                tracks.add(PlayerState(p.id, persons[-1].box, (x, y)), t)
            persons.append(self._person(-2.0, 8.0 + np.sin(t / 7), _color_signature(self.rng, 30, 31)))
            self.rng.shuffle(persons)
            observations.append(FrameObservation(t, ball, persons))
        return SimResult(observations, self.players, cal, truth, tracks, self.fps)

    def _person(self, x: float, y: float, signature: np.ndarray) -> PersonDetection:
        feet = project(self.P, [[x, y, 0.0]])[0]
        head = project(self.P, [[x, y, 1.8]])[0]
        half_w = abs(project(self.P, [[x, y + 0.3, 0.9]])[0][0] - project(self.P, [[x, y - 0.3, 0.9]])[0][0]) / 2
        jitter = self.rng.normal(0, 1.0, 2)
        box = Box(feet[0] - half_w + jitter[0], head[1] + jitter[1], feet[0] + half_w + jitter[0], feet[1] + jitter[1])
        sig = np.clip(signature + self.rng.normal(0, 0.01, signature.shape), 0, None)
        return PersonDetection(box, sig / sig.sum())
