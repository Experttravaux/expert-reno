"""Stockage local de la borne (SQLite) : parties, joueurs, paiements."""

from __future__ import annotations

import json
import secrets
import sqlite3
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np

from .models import Player, PlayerStats

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    court_id TEXT NOT NULL,
    created_at REAL NOT NULL,
    status TEXT NOT NULL,            -- registering, recording, analyzing, ready, error
    video_path TEXT,
    result_json TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    name TEXT NOT NULL,
    team INTEGER NOT NULL,
    photo_path TEXT,
    appearance_json TEXT,
    token TEXT UNIQUE NOT NULL,      -- lien personnel (QR code) vers le rapport
    paid INTEGER NOT NULL DEFAULT 0,
    consent INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    player_ids_json TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL,            -- pending, paid
    provider_ref TEXT,
    created_at REAL NOT NULL
);
"""


def _plain(value):
    """Types numpy -> types Python, pour le JSON."""
    if isinstance(value, np.generic):
        return value.item()
    raise TypeError(f"Type non sérialisable : {type(value).__name__}")


def _id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript(SCHEMA)

    # -- parties -------------------------------------------------------------

    def create_session(self, court_id: str) -> str:
        sid = _id("s")
        self.db.execute("INSERT INTO sessions VALUES (?,?,?,?,?,?,?)", (sid, court_id, time.time(), "registering", None, None, None))
        self.db.commit()
        return sid

    def session(self, sid: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()

    def set_status(self, sid: str, status: str, **fields) -> None:
        sets = ", ".join(["status=?"] + [f"{k}=?" for k in fields])
        self.db.execute(f"UPDATE sessions SET {sets} WHERE id=?", (status, *fields.values(), sid))
        self.db.commit()

    def save_result(self, sid: str, stats: dict[str, PlayerStats], score: dict[int, int]) -> None:
        payload = {"stats": {k: asdict(v) for k, v in stats.items()}, "score": score}
        self.set_status(sid, "ready", result_json=json.dumps(payload, default=_plain))

    def result(self, sid: str) -> tuple[dict[str, PlayerStats], dict[int, int]] | None:
        row = self.session(sid)
        if not row or not row["result_json"]:
            return None
        data = json.loads(row["result_json"])
        stats = {k: PlayerStats(**v) for k, v in data["stats"].items()}
        return stats, {int(k): v for k, v in data["score"].items()}

    # -- joueurs -------------------------------------------------------------

    def add_player(self, sid: str, name: str, team: int, photo_path: str | None, appearance, consent: bool) -> sqlite3.Row:
        pid = _id("p")
        app = json.dumps(np.asarray(appearance).tolist()) if appearance is not None else None
        self.db.execute(
            "INSERT INTO players VALUES (?,?,?,?,?,?,?,?,?)",
            (pid, sid, name, team, photo_path, app, secrets.token_urlsafe(9), 0, int(consent)),
        )
        self.db.commit()
        return self.player(pid)

    def player(self, pid: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM players WHERE id=?", (pid,)).fetchone()

    def player_by_token(self, token: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM players WHERE token=?", (token,)).fetchone()

    def players(self, sid: str) -> list[sqlite3.Row]:
        return self.db.execute("SELECT * FROM players WHERE session_id=? ORDER BY team, rowid", (sid,)).fetchall()

    @staticmethod
    def to_player(row: sqlite3.Row) -> Player:
        app = np.array(json.loads(row["appearance_json"])) if row["appearance_json"] else None
        return Player(row["id"], row["name"], row["team"], app, row["photo_path"])

    # -- paiements -----------------------------------------------------------

    def create_payment(self, sid: str, player_ids: list[str], amount_cents: int) -> str:
        pay_id = _id("pay")
        self.db.execute(
            "INSERT INTO payments VALUES (?,?,?,?,?,?,?)",
            (pay_id, sid, json.dumps(player_ids), amount_cents, "pending", None, time.time()),
        )
        self.db.commit()
        return pay_id

    def payment(self, pay_id: str) -> sqlite3.Row | None:
        return self.db.execute("SELECT * FROM payments WHERE id=?", (pay_id,)).fetchone()

    def set_provider_ref(self, pay_id: str, ref: str) -> None:
        self.db.execute("UPDATE payments SET provider_ref=? WHERE id=?", (ref, pay_id))
        self.db.commit()

    def mark_paid(self, pay_id: str) -> None:
        pay = self.payment(pay_id)
        if not pay or pay["status"] == "paid":
            return
        self.db.execute("UPDATE payments SET status='paid' WHERE id=?", (pay_id,))
        for pid in json.loads(pay["player_ids_json"]):
            self.db.execute("UPDATE players SET paid=1 WHERE id=?", (pid,))
        self.db.commit()

    # -- vie privée ----------------------------------------------------------

    def purge(self, older_than_days: float) -> int:
        """Supprime photos et vidéos des parties anciennes (minimisation RGPD)."""
        limit = time.time() - older_than_days * 86400
        rows = self.db.execute("SELECT id, video_path FROM sessions WHERE created_at < ?", (limit,)).fetchall()
        for row in rows:
            for p in self.players(row["id"]):
                if p["photo_path"]:
                    Path(p["photo_path"]).unlink(missing_ok=True)
            if row["video_path"]:
                Path(row["video_path"]).unlink(missing_ok=True)
            self.db.execute("UPDATE players SET photo_path=NULL, appearance_json=NULL WHERE session_id=?", (row["id"],))
            self.db.execute("UPDATE sessions SET video_path=NULL WHERE id=?", (row["id"],))
        self.db.commit()
        return len(rows)
