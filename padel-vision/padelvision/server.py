"""Serveur de la borne installée au bord du terrain (FastAPI).

Parcours :
1. sur l'écran tactile, les 4 joueurs saisissent leur prénom, se prennent
   en photo et acceptent le traitement de leur image ;
2. « Lancer la partie » -> la caméra du terrain enregistre ;
3. « Fin de partie » -> analyse automatique (quelques minutes) ;
4. l'écran affiche un QR code par joueur : on le scanne avec son téléphone,
   on paie 1 € (ou un seul paie 4 € pour tout le monde) et on lit son rapport.

Lancement : `python -m padelvision serve` (voir README).
"""

from __future__ import annotations

import html
import io
import json
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from .court import CourtCalibration
from .identity import appearance_from_crop
from .payments import MockProvider, PaymentProvider, provider_from_env
from .recorder import FakeRecorder, Recorder
from .report import CSS, player_report
from .store import Store

KIOSK_DIR = Path(__file__).resolve().parent.parent / "kiosk"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("PADEL_DATA_DIR", "data")))
    court_id: str = field(default_factory=lambda: os.environ.get("PADEL_COURT_ID", "terrain-1"))
    club_name: str = field(default_factory=lambda: os.environ.get("PADEL_CLUB_NAME", "Mon club de padel"))
    camera: str = field(default_factory=lambda: os.environ.get("PADEL_CAMERA", "0"))
    calibration_path: Path = field(default_factory=lambda: Path(os.environ.get("PADEL_CALIBRATION", "calibration.json")))
    public_url: str = field(default_factory=lambda: os.environ.get("PADEL_PUBLIC_URL", "http://localhost:8000"))
    price_cents: int = field(default_factory=lambda: int(os.environ.get("PADEL_PRICE_CENTS", "100")))
    demo: bool = field(default_factory=lambda: os.environ.get("PADEL_DEMO", "") == "1")
    demo_rallies: int = 24
    retention_days: float = field(default_factory=lambda: float(os.environ.get("PADEL_RETENTION_DAYS", "30")))


def _euros(cents: int) -> str:
    return f"{cents / 100:.2f}".replace(".", ",").replace(",00", "") + " €"


def create_app(settings: Settings | None = None, provider: PaymentProvider | None = None) -> FastAPI:
    cfg = settings or Settings()
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    store = Store(cfg.data_dir / "padel.db")
    store.purge(cfg.retention_days)
    pay = provider or provider_from_env(cfg.public_url)
    recorder = FakeRecorder() if cfg.demo else Recorder(cfg.camera)
    app = FastAPI(title="PadelVision — borne")
    app.state.store, app.state.settings = store, cfg

    def require_session(sid: str):
        row = store.session(sid)
        if row is None:
            raise HTTPException(404, "Partie inconnue")
        return row

    # -- borne -------------------------------------------------------------

    @app.get("/")
    def kiosk():
        return FileResponse(KIOSK_DIR / "index.html")

    @app.get("/api/config")
    def config():
        return {"price_cents": cfg.price_cents, "club": cfg.club_name, "court": cfg.court_id, "demo": cfg.demo}

    @app.post("/api/sessions")
    def create_session():
        return {"id": store.create_session(cfg.court_id), "price_cents": cfg.price_cents}

    @app.post("/api/sessions/{sid}/players")
    async def add_player(
        sid: str,
        name: str = Form(...),
        team: int = Form(...),
        consent: bool = Form(False),
        photo: UploadFile | None = File(None),
    ):
        session = require_session(sid)
        if session["status"] != "registering":
            raise HTTPException(409, "La partie a déjà commencé")
        if not consent:
            raise HTTPException(400, "Le joueur doit accepter l'analyse de son image")
        if team not in (1, 2) or not name.strip():
            raise HTTPException(400, "Prénom et équipe (1 ou 2) obligatoires")
        if len(store.players(sid)) >= 4:
            raise HTTPException(409, "4 joueurs déjà inscrits")
        photo_path, appearance = None, None
        if photo is not None:
            data = await photo.read()
            if data:
                photo_path, appearance = _save_photo(cfg.data_dir / "photos", sid, len(store.players(sid)), data)
        row = store.add_player(sid, name.strip()[:30], team, photo_path, appearance, consent)
        return _player_json(row, cfg)

    @app.post("/api/sessions/{sid}/start")
    def start(sid: str):
        session = require_session(sid)
        players = store.players(sid)
        if len(players) != 4 or sorted(p["team"] for p in players) != [1, 1, 2, 2]:
            raise HTTPException(400, "Il faut 4 joueurs : 2 par équipe")
        if session["status"] != "registering":
            raise HTTPException(409, "Partie déjà lancée")
        video = cfg.data_dir / "videos" / f"{sid}.mp4"
        recorder.start(video)
        store.set_status(sid, "recording", video_path=str(video))
        return {"status": "recording"}

    @app.post("/api/sessions/{sid}/stop")
    def stop(sid: str):
        session = require_session(sid)
        if session["status"] != "recording":
            raise HTTPException(409, "Aucun enregistrement en cours")
        recorder.stop()
        store.set_status(sid, "analyzing")
        threading.Thread(target=_analyze, args=(store, cfg, sid), daemon=True).start()
        return {"status": "analyzing"}

    @app.get("/api/sessions/{sid}")
    def session_status(sid: str):
        session = require_session(sid)
        result = store.result(sid)
        return {
            "id": sid,
            "status": session["status"],
            "error": session["error"],
            "score": result[1] if result else None,
            "price_cents": cfg.price_cents,
            "players": [_player_json(p, cfg) for p in store.players(sid)],
        }

    @app.get("/photos/{pid}.jpg")
    def photo(pid: str):
        row = store.player(pid)
        if not row or not row["photo_path"] or not Path(row["photo_path"]).exists():
            raise HTTPException(404)
        return FileResponse(row["photo_path"], media_type="image/jpeg")

    @app.get("/qr/{token}.svg")
    def qr(token: str):
        import segno

        if store.player_by_token(token) is None:
            raise HTTPException(404)
        buf = io.BytesIO()
        segno.make(f"{cfg.public_url}/r/{token}", error="m").save(buf, kind="svg", scale=6, border=2)
        return Response(buf.getvalue(), media_type="image/svg+xml")

    # -- téléphone du joueur ----------------------------------------------

    @app.get("/r/{token}", response_class=HTMLResponse)
    def report(token: str, paid: int = 0):
        row = store.player_by_token(token)
        if row is None:
            raise HTTPException(404, "Lien inconnu")
        session = store.session(row["session_id"])
        result = store.result(row["session_id"])
        if result is None:
            msg = "Analyse en cours, reviens dans quelques minutes." if session["status"] != "error" else "L'analyse a échoué."
            return _page("Analyse en cours", f"<h1>{html.escape(row['name'])}</h1><p>{msg}</p>", refresh=20)
        if not row["paid"] and paid:
            # Retour du paiement : la confirmation (webhook) peut avoir quelques secondes de retard.
            return _page("Paiement", "<h1>Paiement en cours de validation…</h1><p class='sub'>Ton rapport s'affiche dans un instant.</p>", refresh=3)
        if not row["paid"]:
            return _paywall(row, store, cfg)
        stats, _ = result
        player = store.to_player(row)
        label = f"{cfg.club_name} · {cfg.court_id}"
        return HTMLResponse(player_report(player, stats[row["id"]], stats, label))

    @app.post("/r/{token}/pay")
    def start_payment(token: str, scope: str = Form("me")):
        row = store.player_by_token(token)
        if row is None:
            raise HTTPException(404)
        players = store.players(row["session_id"])
        targets = [p["id"] for p in players if not p["paid"]] if scope == "all" else [row["id"]]
        amount = cfg.price_cents * len(targets)
        if not targets:
            return RedirectResponse(f"/r/{token}", status_code=303)
        pay_id = store.create_payment(row["session_id"], targets, amount)
        what = "Analyse de partie" + (f" ({len(targets)} joueurs)" if len(targets) > 1 else f" — {row['name']}")
        checkout = pay.create_checkout(
            pay_id, amount, what, f"{cfg.public_url}/r/{token}?paid=1", f"{cfg.public_url}/r/{token}"
        )
        store.set_provider_ref(pay_id, checkout.provider_ref)
        return RedirectResponse(checkout.url, status_code=303)

    @app.post("/api/payments/webhook")
    async def webhook(request: Request):
        payload = await request.body()
        try:
            pay_id = pay.paid_payment_id(payload, {k.lower(): v for k, v in request.headers.items()})
        except Exception as exc:  # signature invalide
            raise HTTPException(400, str(exc)) from exc
        if pay_id:
            store.mark_paid(pay_id)
        return {"ok": True}

    if isinstance(pay, MockProvider):

        @app.get("/mock-pay/{pay_id}", response_class=HTMLResponse)
        def mock_pay_page(pay_id: str):
            p = store.payment(pay_id)
            if p is None:
                raise HTTPException(404)
            body = (
                f"<h1>Paiement de démonstration</h1><p>Montant : <b>{_euros(p['amount_cents'])}</b></p>"
                f'<form method="post"><button class="btn">Payer (simulation)</button></form>'
                "<p class='sub'>En production, cette page est remplacée par Stripe (carte, Apple Pay, Google Pay).</p>"
            )
            return _page("Paiement", body)

        @app.post("/mock-pay/{pay_id}")
        def mock_pay(pay_id: str):
            p = store.payment(pay_id)
            if p is None:
                raise HTTPException(404)
            store.mark_paid(pay_id)
            first = store.player(json.loads(p["player_ids_json"])[0])
            return RedirectResponse(f"/r/{first['token']}?paid=1", status_code=303)

    return app


def _save_photo(folder: Path, sid: str, index: int, data: bytes) -> tuple[str, np.ndarray]:
    from PIL import Image

    folder.mkdir(parents=True, exist_ok=True)
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((640, 640))
    path = folder / f"{sid}-{index}.jpg"
    img.save(path, "JPEG", quality=85)
    return str(path), appearance_from_crop(np.asarray(img))


def _player_json(row, cfg: Settings) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "team": row["team"],
        "paid": bool(row["paid"]),
        "photo_url": f"/photos/{row['id']}.jpg" if row["photo_path"] else None,
        "report_url": f"{cfg.public_url}/r/{row['token']}",
        "qr_url": f"/qr/{row['token']}.svg",
    }


def _page(title: str, body: str, refresh: int | None = None) -> HTMLResponse:
    meta = f'<meta http-equiv="refresh" content="{refresh}">' if refresh else ""
    extra = (
        ".btn{display:block;width:100%;padding:16px;margin:10px 0;border:0;border-radius:12px;"
        "background:var(--accent);color:#000;font-size:1.1rem;font-weight:700}"
        ".btn.alt{background:var(--card);color:var(--ink);border:1px solid var(--line)}"
    )
    return HTMLResponse(
        f'<!doctype html><html lang="fr"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">{meta}'
        f"<title>{html.escape(title)}</title><style>{CSS}{extra}</style></head><body><main>{body}</main></body></html>"
    )


def _paywall(row, store: Store, cfg: Settings) -> HTMLResponse:
    players = store.players(row["session_id"])
    unpaid = [p for p in players if not p["paid"]]
    stats, score = store.result(row["session_id"])
    me = stats[row["id"]]
    teaser = (
        f"<div class='grid'><div class='tile acc'><div class='v'>{score.get(me.team, 0)}</div>"
        f"<div class='l'>points gagnés par ton équipe</div></div>"
        f"<div class='tile'><div class='v'>{me.shots}</div><div class='l'>coups joués</div></div>"
        f"<div class='tile'><div class='v'>?</div><div class='l'>fautes directes</div></div>"
        f"<div class='tile'><div class='v'>?</div><div class='l'>coups gagnants</div></div></div>"
    )
    all_btn = ""
    if len(unpaid) > 1:
        all_btn = (
            f'<form method="post" action="/r/{row["token"]}/pay"><input type="hidden" name="scope" value="all">'
            f'<button class="btn alt">Je paie pour les {len(unpaid)} : {_euros(cfg.price_cents * len(unpaid))}</button></form>'
        )
    body = (
        f"<h1>{html.escape(row['name'])}, ta partie est analysée</h1>{teaser}"
        "<h2>Débloque ton rapport complet</h2>"
        "<p class='sub'>Fautes directes, balles non rattrapées, coups gagnants, vitesse de frappe, "
        "zones de jeu et conseils pour progresser.</p>"
        f'<form method="post" action="/r/{row["token"]}/pay"><input type="hidden" name="scope" value="me">'
        f'<button class="btn">Mon rapport : {_euros(cfg.price_cents)}</button></form>{all_btn}'
    )
    return _page("Ton rapport", body)


def _analyze(store: Store, cfg: Settings, sid: str) -> None:
    try:
        rows = store.players(sid)
        players = [store.to_player(r) for r in rows]
        if cfg.demo:
            stats, score = _demo_analysis(players, sid, cfg.demo_rallies)
        else:
            from .pipeline import analyze_video

            calibration = CourtCalibration.load(cfg.calibration_path)
            result = analyze_video(store.session(sid)["video_path"], players, calibration)
            stats, score = result.stats, result.score
        store.save_result(sid, stats, score)
    except Exception as exc:  # l'écran doit afficher l'erreur, pas planter
        store.set_status(sid, "error", error=f"{type(exc).__name__}: {exc}")


def _demo_analysis(players, sid: str, n_rallies: int):
    """Mode démo : on simule une partie avec les prénoms des inscrits."""
    from .pipeline import analyze_observations
    from .simulate import MatchSimulator

    ordered = sorted(players, key=lambda p: p.team)
    sim = MatchSimulator(seed=abs(hash(sid)) % 10_000, n_rallies=n_rallies, names=tuple(p.name for p in ordered)).run()
    res = analyze_observations(sim.observations, sim.players, sim.calibration)
    stats = {}
    for sim_player, real in zip(sim.players, ordered):
        s = res.stats[sim_player.id]
        s.player_id = real.id
        stats[real.id] = s
    return stats, res.score
