import numpy as np

from padelvision.camera_model import DEFAULT_CAMERA, look_at_projection
from padelvision.court import REFERENCE_POINTS, CourtCalibration, project


def test_calibration_recovers_camera():
    p = look_at_projection(**DEFAULT_CAMERA)
    world = np.array([r[1:] for r in REFERENCE_POINTS])
    rng = np.random.default_rng(0)
    clicks = project(p, world) + rng.normal(0, 0.7, (len(world), 2))
    cal = CourtCalibration.from_clicks(clicks.tolist())
    # Un point quelconque en l'air se projette au bon pixel.
    probe = np.array([[3.0, 14.0, 1.2]])
    assert np.linalg.norm(project(cal.projection, probe) - project(p, probe)) < 2.0
    # Pixel -> sol : position des pieds à quelques centimètres près.
    u, v = project(p, [[6.0, 4.0, 0.0]])[0]
    x, y = cal.to_court(u, v)
    assert abs(x - 6.0) < 0.1 and abs(y - 4.0) < 0.1


def test_calibration_roundtrip(tmp_path):
    p = look_at_projection(**DEFAULT_CAMERA)
    world = np.array([r[1:] for r in REFERENCE_POINTS])
    cal = CourtCalibration.from_clicks(project(p, world).tolist())
    cal.save(tmp_path / "c.json")
    again = CourtCalibration.load(tmp_path / "c.json")
    assert np.allclose(again.projection, cal.projection)
