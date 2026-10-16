"""Lecture des échanges : de la suite d'événements de balle aux coups et aux points.

Règles de padel utilisées (simplifiées) :
- après une frappe, la balle doit passer le filet et rebondir au sol dans le
  camp adverse avant de toucher une vitre ou une grille ;
- rebond dans son propre camp -> balle dans le filet (faute) ;
- vitre/grille avant le rebond -> dehors (faute) ;
- rebond chez l'adversaire et plus aucune frappe -> point gagnant, et la
  balle est « non rattrapée » par l'adversaire le plus proche du rebond.
"""

from __future__ import annotations

import numpy as np

from .events import RallyEvents
from .identity import Tracks
from .models import (
    COURT_LENGTH,
    COURT_WIDTH,
    NET_Y,
    BallEvent,
    EventType,
    Player,
    Rally,
    Shot,
    ShotOutcome,
    side_of,
)
from .physics import G, predict_flight

WELL_PLACED_BACK_M = 2.5  # rebond à moins de 2,5 m de la vitre du fond
WELL_PLACED_SIDE_M = 1.0  # ou à moins de 1 m d'une vitre latérale
NET_ZONE_M = 4.0
NET_DROP_M = 0.5  # rebond au pied du filet juste après la frappe : balle dans le filet  # « au filet » : à moins de 4 m du filet
FORCING_SPEED_KMH = 80.0


def is_well_placed(landing: tuple[float, float]) -> bool:
    x, y = landing
    from_back = y if y < NET_Y else COURT_LENGTH - y
    return bool(from_back <= WELL_PLACED_BACK_M or x <= WELL_PLACED_SIDE_M or x >= COURT_WIDTH - WELL_PLACED_SIDE_M)


def resolve_sequence(events: list[BallEvent], players: dict[str, Player], max_extra_px: float = 1.0) -> list[BallEvent]:
    """Corrige les lectures impossibles au padel : une équipe ne frappe jamais deux fois de suite.

    Quand deux frappes consécutives sont attribuées à la même équipe, l'une
    des deux est en réalité une vitre, un rebond, ou une frappe adverse. On
    remplace celle dont la meilleure lecture alternative coûte le moins.
    """
    events = sorted(events, key=lambda e: e.t)

    def team(e: BallEvent) -> int | None:
        return players[e.player_id].team if e.type == EventType.HIT else None

    for _ in range(len(events)):
        hits = [i for i, e in enumerate(events) if e.type == EventType.HIT]
        conflict = next((a for a, b in zip(hits, hits[1:]) if team(events[a]) == team(events[b])), None)
        if conflict is None:
            break
        b = hits[hits.index(conflict) + 1]
        best = None
        for i in (conflict, b):
            bad_team = team(events[i])
            for alt in events[i].alternatives:
                if alt.type == EventType.HIT and players[alt.player_id].team == bad_team:
                    continue
                extra = alt.score - events[i].score
                if extra <= max_extra_px and (best is None or extra < best[0]):
                    best = (extra, i, alt)
                break  # seule la meilleure alternative admissible compte
        if best is None:
            # Aucune autre lecture crédible : on garde la frappe la plus sûre.
            drop = conflict if events[conflict].score > events[b].score else b
            events.pop(drop)
            continue
        _, i, alt = best
        alt.alternatives = []
        events[i] = alt
    return _check_last_hit(events, max_extra_px + 0.5)


def _check_last_hit(events: list[BallEvent], max_extra_px: float) -> list[BallEvent]:
    """Dernière frappe d'un échange qui ne passerait même pas le filet.

    Souvent, c'est la balle gagnante qui touche la vitre près d'un joueur
    adverse et qu'on a prise pour une frappe molle. Si une autre lecture
    (vitre, rebond) est crédible, on la préfère.
    """
    hits = [i for i, e in enumerate(events) if e.type == EventType.HIT]
    if len(hits) < 2:
        return events
    i = hits[-1]
    hit = events[i]
    if hit.v_out is None:
        return events
    contact, _, point = predict_flight(hit.position, hit.v_out)
    crosses = contact in ("sol", "vitre") and side_of(point[1]) != side_of(hit.position[1])
    if crosses:
        return events
    for alt in hit.alternatives:
        if alt.type != EventType.HIT and alt.score - hit.score <= max_extra_px:
            alt.alternatives = []
            events[i] = alt
            break
    return events


def infer_hidden_bounces(events: list[BallEvent]) -> list[BallEvent]:
    """Rebonds trop proches d'un autre événement pour être vus : on les reconstitue.

    Typiquement une balle profonde qui rebondit puis touche la vitre 0,1 s
    après. Deux indices physiques :
    - une balle qui arrive sur une vitre en montant a forcément rebondi juste
      avant : on remonte sa trajectoire jusqu'au sol ;
    - sinon on prolonge la trajectoire mesurée à la sortie de la frappe
      (gravité + freinage) : si elle touche le sol avant la vitre, le rebond
      a bien eu lieu. Sans ce rebond, un point gagnant profond serait
      compté à tort comme une balle dehors.
    """
    events = sorted(events, key=lambda x: x.t)
    implied: list[BallEvent] = []
    hits = [i for i, e in enumerate(events) if e.type == EventType.HIT]
    for n, i in enumerate(hits):
        end = hits[n + 1] if n + 1 < len(hits) else len(events)
        window = events[i + 1 : end]
        first_wall = next((e for e in window if e.type == EventType.WALL), None)
        limit = first_wall.t if first_wall else (events[end].t if end < len(events) else events[i].t + 3.0)
        if any(e.type == EventType.BOUNCE and e.t < limit for e in window):
            continue
        found = _bounce_before_wall(first_wall) if first_wall else None
        found = found or _bounce_from_hit(events[i], limit)
        if found is not None:
            implied.append(found)
    return sorted(events + implied, key=lambda x: x.t)


def _bounce_before_wall(wall: BallEvent) -> BallEvent | None:
    if wall.v_in is None or wall.v_in[2] <= 0.5:
        return None
    vx, vy, vz = wall.v_in
    z0 = wall.position[2]
    tau = (vz - np.sqrt(vz * vz + 2 * G * z0)) / G  # instant (négatif) du contact au sol
    x, y = wall.position[0] + vx * tau, wall.position[1] + vy * tau
    if -0.2 <= x <= COURT_WIDTH + 0.2 and -0.2 <= y <= COURT_LENGTH + 0.2:
        return BallEvent(EventType.BOUNCE, wall.t + tau, (x, y, 0.0), implied=True)
    return None


def _bounce_from_hit(hit: BallEvent | None, before_t: float) -> BallEvent | None:
    if hit is None or hit.v_out is None:
        return None
    contact, dt, point = predict_flight(hit.position, hit.v_out)
    if contact != "sol" or hit.t + dt > before_t + 0.15:
        return None
    if side_of(point[1]) == side_of(hit.position[1]):
        return None  # retombe dans son camp : c'est le filet, pas un rebond caché
    return BallEvent(EventType.BOUNCE, hit.t + dt, (float(point[0]), float(point[1]), 0.0), implied=True)


def interpret_rally(
    index: int, rally_events: RallyEvents, players: dict[str, Player], tracks: Tracks
) -> Rally:
    rally = Rally(index, rally_events.t_start, rally_events.t_end)
    events = infer_hidden_bounces(resolve_sequence(rally_events.events, players))
    hit_idx = [i for i, e in enumerate(events) if e.type == EventType.HIT]
    if not hit_idx:
        rally.ended_by = "unknown"
        return rally

    for n, i in enumerate(hit_idx):
        hit = events[i]
        player = players[hit.player_id]
        own_side = side_of(hit.position[1])
        nxt = hit_idx[n + 1] if n + 1 < len(hit_idx) else len(events)
        following = events[i + 1 : nxt]
        prev_hit = hit_idx[n - 1] if n > 0 else None
        volley = prev_hit is not None and not any(e.type == EventType.BOUNCE for e in events[prev_hit + 1 : i])

        bounces = [e for e in following if e.type == EventType.BOUNCE]
        landing_ev = next((b for b in bounces if side_of(b.position[1]) != own_side), None)
        shot = Shot(
            player_id=player.id,
            team=player.team,
            t=hit.t,
            position=tracks.position(player.id, hit.t) or hit.court_xy,
            is_serve=n == 0,
            is_volley=volley,
            speed_kmh=hit.speed_kmh,
            landing=landing_ev.court_xy if landing_ev else None,
        )
        shot.well_placed = shot.landing is not None and is_well_placed(shot.landing)

        if nxt < len(events):
            shot.outcome = ShotOutcome.IN_PLAY
        else:
            shot.outcome, deciding = _last_shot_outcome(following, own_side)
            if shot.outcome == ShotOutcome.UNKNOWN:
                shot.outcome = _predicted_outcome(hit)
            if shot.outcome == ShotOutcome.WINNER and deciding is not None:
                rally.unreturned_by = _nearest_opponent(deciding, player, players, tracks)
        rally.shots.append(shot)

    last = rally.shots[-1]
    rally.decisive_player = last.player_id
    rally.ended_by = last.outcome.value
    if last.outcome == ShotOutcome.WINNER:
        rally.winner_team = last.team
    elif last.outcome in (ShotOutcome.NET, ShotOutcome.OUT):
        rally.winner_team = 3 - last.team
        prev = rally.shots[-2] if len(rally.shots) > 1 else None
        last.forced_error = prev is not None and (prev.well_placed or prev.speed_kmh >= FORCING_SPEED_KMH)
    return rally


def _last_shot_outcome(following: list[BallEvent], own_side: int) -> tuple[ShotOutcome, BallEvent | None]:
    first_bounce = next((e for e in following if e.type == EventType.BOUNCE), None)
    cutoff = first_bounce.t if first_bounce else np.inf
    before = [e for e in following if e.t < cutoff]
    if first_bounce is not None and (
        side_of(first_bounce.position[1]) == own_side or abs(first_bounce.position[1] - NET_Y) < NET_DROP_M
    ):
        return ShotOutcome.NET, None
    if any(e.type == EventType.WALL for e in before):
        return ShotOutcome.OUT, None
    if first_bounce is not None:
        return ShotOutcome.WINNER, first_bounce
    if any(e.type == EventType.NET for e in before):
        return ShotOutcome.NET, None
    return ShotOutcome.UNKNOWN, None


def _predicted_outcome(hit: BallEvent) -> ShotOutcome:
    """Plus rien d'observé après la dernière frappe : on se fie au vol prédit."""
    if hit.v_out is None:
        return ShotOutcome.UNKNOWN
    contact, _, point = predict_flight(hit.position, hit.v_out)
    own = side_of(hit.position[1])
    if contact == "filet" or (contact == "sol" and side_of(point[1]) == own):
        return ShotOutcome.NET
    if contact == "vitre":
        return ShotOutcome.OUT
    return ShotOutcome.UNKNOWN


def _nearest_opponent(bounce: BallEvent, hitter: Player, players: dict[str, Player], tracks: Tracks) -> str | None:
    best, best_d = None, np.inf
    for pid, pos in tracks.positions(bounce.t).items():
        if players[pid].team == hitter.team:
            continue
        d = float(np.hypot(pos[0] - bounce.position[0], pos[1] - bounce.position[1]))
        if d < best_d:
            best, best_d = pid, d
    return best


def apply_serve_rules(rallies: list[Rally]) -> None:
    """Deux services par point : une première faute ne donne pas le point."""
    pending: str | None = None
    for rally in rallies:
        if not rally.shots:
            continue
        first = rally.shots[0]
        serve_fault = len(rally.shots) == 1 and first.outcome in (ShotOutcome.NET, ShotOutcome.OUT)
        if serve_fault and pending != first.player_id:
            pending = first.player_id
            rally.ended_by = "serve_fault"
            rally.winner_team = None
            continue
        if serve_fault:
            rally.ended_by = "double_fault"
        pending = None
