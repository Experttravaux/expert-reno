import numpy as np

from padelvision.models import PlayerStats
from padelvision.store import Store


def test_result_with_numpy_values_is_saved(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    sid = store.create_session("t1")
    stats = {"p": PlayerStats("p", "A", 1, shots=np.int64(12), well_placed=np.int64(3), max_speed_kmh=np.float64(80.5))}
    store.save_result(sid, stats, {1: np.int64(5), 2: 3})
    loaded, score = store.result(sid)
    assert loaded["p"].shots == 12 and loaded["p"].well_placed == 3
    assert score == {1: 5, 2: 3}


def test_purge_removes_photos(tmp_path):
    store = Store(tmp_path / "db.sqlite")
    sid = store.create_session("t1")
    photo = tmp_path / "a.jpg"
    photo.write_bytes(b"x")
    store.add_player(sid, "A", 1, str(photo), np.ones(64) / 64, consent=True)
    assert store.purge(older_than_days=-1) == 1
    assert not photo.exists()
    assert store.players(sid)[0]["photo_path"] is None
