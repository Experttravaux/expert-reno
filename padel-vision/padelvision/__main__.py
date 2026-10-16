"""Ligne de commande PadelVision.

    python -m padelvision demo        # simule une partie et écrit les 4 rapports HTML
    python -m padelvision evaluate    # mesure la précision du moteur sur des parties simulées
    python -m padelvision serve       # lance la borne (écran tactile + API)
    python -m padelvision calibrate   # calibre la caméra du terrain (clics sur une image)
    python -m padelvision analyze     # analyse une vidéo déjà enregistrée
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def cmd_demo(args) -> None:
    from .pipeline import analyze_observations
    from .report import write_reports
    from .simulate import MatchSimulator

    names = tuple(args.names.split(","))
    if len(names) != 4:
        sys.exit("--names attend 4 prénoms séparés par des virgules")
    print(f"Simulation d'une partie de {args.rallies} points ({args.fps} images/s)…")
    sim = MatchSimulator(seed=args.seed, n_rallies=args.rallies, fps=args.fps, names=names).run()
    res = analyze_observations(sim.observations, sim.players, sim.calibration)
    score = res.score
    print(f"Score (points) : équipe 1 {score[1]} – {score[2]} équipe 2")
    print(f"{'Joueur':10s} {'coups':>6s} {'gagn.':>6s} {'f.dir':>6s} {'non ratt.':>9s} {'bien pl.':>8s} {'vmax':>6s}")
    for s in res.stats.values():
        print(f"{s.name:10s} {s.shots:6d} {s.winners:6d} {s.unforced_errors:6d} {s.unreturned:9d} {s.well_placed:8d} {s.max_speed_kmh:5.0f}")
    paths = write_reports(sim.players, res.stats, args.out, "Partie simulée")
    print("Rapports :", *[str(p) for p in paths], sep="\n  ")


def cmd_evaluate(args) -> None:
    from .evaluate import evaluate

    ev = evaluate(list(range(args.seed, args.seed + args.matches)), n_rallies=args.rallies, fps=args.fps)
    print(ev.report())


def cmd_serve(args) -> None:
    import os

    import uvicorn

    if args.demo:
        os.environ["PADEL_DEMO"] = "1"
    from .server import create_app

    uvicorn.run(create_app(), host=args.host, port=args.port)


def cmd_calibrate(args) -> None:
    import cv2

    from .court import REFERENCE_POINTS, CourtCalibration

    cap = cv2.VideoCapture(int(args.camera) if str(args.camera).isdigit() else args.camera)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        sys.exit("Impossible de lire une image de la caméra")
    clicks: list[tuple[float, float]] = []
    names: list[str] = []
    i = 0
    win = "Calibration - clic gauche: placer, s: passer ce repère, Entrée: terminer"

    def on_mouse(event, x, y, *_):
        nonlocal i
        if event == cv2.EVENT_LBUTTONDOWN and i < len(REFERENCE_POINTS):
            clicks.append((float(x), float(y)))
            names.append(REFERENCE_POINTS[i][0])
            i += 1

    cv2.namedWindow(win)
    cv2.setMouseCallback(win, on_mouse)
    while True:
        img = frame.copy()
        for (x, y), n in zip(clicks, names):
            cv2.circle(img, (int(x), int(y)), 5, (0, 255, 0), -1)
            cv2.putText(img, n, (int(x) + 6, int(y) - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1)
        label = REFERENCE_POINTS[i][0] if i < len(REFERENCE_POINTS) else "terminé : Entrée"
        cv2.putText(img, f"Cliquer : {label}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
        cv2.imshow(win, img)
        key = cv2.waitKey(30) & 0xFF
        if key == ord("s") and i < len(REFERENCE_POINTS):
            i += 1
        if key in (13, 10) or (i >= len(REFERENCE_POINTS) and key != 255):
            break
    cv2.destroyAllWindows()
    cal = CourtCalibration.from_clicks(clicks, names)
    world = [r[1:] for n in names for r in REFERENCE_POINTS if r[0] == n]
    import numpy as np

    err = cal.reprojection_error(np.array(world), np.array(clicks))
    cal.save(args.out)
    print(f"Calibration enregistrée dans {args.out} ({len(clicks)} repères, erreur moyenne {err:.1f} px)")
    if err > 4:
        print("Erreur élevée : recommence en cliquant plus précisément.")


def cmd_analyze(args) -> None:
    from .court import CourtCalibration
    from .models import Player
    from .pipeline import analyze_video
    from .report import write_reports

    spec = json.loads(Path(args.players).read_text())
    players = [Player(p["id"], p["name"], p["team"], photo_path=p.get("photo")) for p in spec]
    res = analyze_video(args.video, players, CourtCalibration.load(args.calibration), progress=lambda f: print(f"{100 * f:.0f} %"))
    for p in write_reports(players, res.stats, args.out, Path(args.video).stem):
        print(p)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="padelvision", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("demo", help="simule une partie et écrit les rapports")
    p.add_argument("--names", default="Alex,Bilal,Chloé,Dylan")
    p.add_argument("--rallies", type=int, default=30)
    p.add_argument("--fps", type=int, default=60)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", default="rapports")
    p.set_defaults(func=cmd_demo)

    p = sub.add_parser("evaluate", help="précision du moteur sur des parties simulées")
    p.add_argument("--matches", type=int, default=4)
    p.add_argument("--rallies", type=int, default=30)
    p.add_argument("--fps", type=int, default=60)
    p.add_argument("--seed", type=int, default=10)
    p.set_defaults(func=cmd_evaluate)

    p = sub.add_parser("serve", help="lance la borne")
    p.add_argument("--host", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--demo", action="store_true", help="sans caméra : parties simulées")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("calibrate", help="calibre la caméra du terrain")
    p.add_argument("--camera", default="0")
    p.add_argument("--out", default="calibration.json")
    p.set_defaults(func=cmd_calibrate)

    p = sub.add_parser("analyze", help="analyse une vidéo enregistrée")
    p.add_argument("video")
    p.add_argument("--players", required=True, help='JSON : [{"id":"p1","name":"A","team":1,"photo":"a.jpg"}, …]')
    p.add_argument("--calibration", default="calibration.json")
    p.add_argument("--out", default="rapports")
    p.set_defaults(func=cmd_analyze)

    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
