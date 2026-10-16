import numpy as np

from padelvision.camera_model import DEFAULT_CAMERA, look_at_projection
from padelvision.court import project
from padelvision.physics import BALL_DRAG, G
from padelvision.trajectory import anchored_fit, detect_kinks, pixel_ray, ray_plane


def _flight(p0, v0, duration, fps=60, bounce=True):
    """Trajectoire physique échantillonnée (gravité, frottement, rebond)."""
    sub = 8
    dt = 1 / (fps * sub)
    p, v = np.array(p0, float), np.array(v0, float)
    ts, pts, bounces = [], [], []
    for k in range(int(duration * fps * sub)):
        v = v + (np.array([0, 0, -G]) - BALL_DRAG * np.linalg.norm(v) * v) * dt
        p = p + v * dt
        if bounce and p[2] < 0:
            p[2], v[2] = -p[2], -0.75 * v[2]
            v[:2] *= 0.85
            bounces.append(((k + 1) * dt, p.copy()))
        if k % sub == 0:
            ts.append((k + 1) * dt)
            pts.append(p.copy())
    return np.array(ts), np.array(pts), bounces


def test_bounce_is_located_on_the_ground():
    cam = look_at_projection(**DEFAULT_CAMERA)
    ts, pts, bounces = _flight([3, 2, 1.0], [0.5, 13, 4.0], 1.3)
    rng = np.random.default_rng(1)
    uv = project(cam, pts) + rng.normal(0, 1.0, (len(ts), 2))
    kinks = detect_kinks(ts, uv, window=8)
    assert len(kinks) == 1
    true_t, true_p = bounces[0]
    assert abs(kinks[0].t - true_t) < 0.03
    origin, d = pixel_ray(cam, *kinks[0].uv)
    ground = ray_plane(origin, d, 2, 0.0)
    assert np.hypot(*(ground[:2] - true_p[:2])) < 0.3


def test_anchored_fit_recovers_speed():
    cam = look_at_projection(**DEFAULT_CAMERA)
    v0 = np.array([1.0, 18.0, 3.0])
    ts, pts, _ = _flight([4, 2, 1.0], v0, 0.5, bounce=False)
    uv = project(cam, pts)
    fit = anchored_fit(cam, np.array([4, 2, 1.0]), 0.0, ts, uv)
    assert fit.rms_px < 1.0
    assert np.linalg.norm(fit.velocity - v0) < 0.5
