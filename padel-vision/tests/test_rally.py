from padelvision.events import RallyEvents
from padelvision.identity import Tracks
from padelvision.models import BallEvent, Box, EventType, Player, PlayerState, ShotOutcome
from padelvision.rally import apply_serve_rules, interpret_rally, is_well_placed

PLAYERS = {
    "a": Player("a", "A", 1),
    "b": Player("b", "B", 1),
    "c": Player("c", "C", 2),
    "d": Player("d", "D", 2),
}


def _tracks():
    tr = Tracks()
    pos = {"a": (2.5, 3.0), "b": (7.5, 7.0), "c": (2.5, 17.0), "d": (7.5, 17.0)}
    for t in (0.0, 100.0):
        for pid, xy in pos.items():
            tr.add(PlayerState(pid, Box(0, 0, 1, 1), xy), t)
    return tr


def hit(t, pid, y, v_out=None):
    return BallEvent(EventType.HIT, t, (5.0, y, 1.0), 60.0, pid, v_out=v_out)


def bounce(t, x, y):
    return BallEvent(EventType.BOUNCE, t, (x, y, 0.0))


def wall(t, y):
    return BallEvent(EventType.WALL, t, (5.0, y, 2.0))


def rally(events):
    return interpret_rally(0, RallyEvents(0.0, 10.0, events), PLAYERS, _tracks())


def test_winner_and_unreturned_ball():
    r = rally([hit(0, "a", 3), bounce(1, 2.4, 15), hit(1.5, "c", 17), bounce(2.5, 7.6, 4), bounce(3.0, 7.7, 2)])
    assert r.ended_by == "winner" and r.winner_team == 2
    assert r.decisive_player == "c"
    assert r.unreturned_by == "b"  # le plus proche du rebond, côté (7.5, 7)


def test_ball_in_the_net_is_an_error():
    r = rally([hit(0, "a", 3), bounce(1, 2.4, 15), hit(1.5, "c", 17), bounce(2.0, 5.0, 12)])
    assert r.ended_by == "net" and r.winner_team == 1 and r.decisive_player == "c"


def test_glass_before_ground_is_out():
    r = rally([hit(0, "a", 3), bounce(1, 2.4, 15), hit(1.5, "c", 17), wall(2.2, 0.0), bounce(2.5, 5, 2)])
    assert r.ended_by == "out" and r.winner_team == 1


def test_two_hits_same_team_uses_alternative_reading():
    fake = hit(1.2, "d", 19.0)
    fake.score = 1.4
    fake.alternatives = [BallEvent(EventType.WALL, 1.2, (5.0, 20.0, 1.0), score=1.3)]
    events = [hit(0, "a", 3), bounce(1, 2.4, 18), fake, hit(1.6, "c", 17), bounce(2.5, 7.6, 4)]
    r = rally(events)
    assert [s.player_id for s in r.shots] == ["a", "c"]


def test_deep_ball_is_well_placed():
    assert is_well_placed((5.0, 18.5))
    assert is_well_placed((0.5, 14.0))
    assert not is_well_placed((5.0, 14.0))


def test_double_fault():
    first = rally([hit(0, "a", 1.0), bounce(0.5, 5.0, 6.0)])
    second = rally([hit(0, "a", 1.0), bounce(0.5, 5.0, 6.0)])
    assert first.shots[0].outcome == ShotOutcome.NET
    apply_serve_rules([first, second])
    assert first.ended_by == "serve_fault" and first.winner_team is None
    assert second.ended_by == "double_fault" and second.winner_team == 2
