"""Rapport de fin de partie, façon tableau de score de laser game.

Un rapport par joueur (débloqué après paiement), autonome : une seule page
HTML, photo incluse, lisible sur téléphone.
"""

from __future__ import annotations

import base64
import html
from pathlib import Path

from .models import Player, PlayerStats
from .stats import HEATMAP_COLS, HEATMAP_ROWS

CSS = """
:root{--bg:#0d1117;--card:#161b22;--ink:#e6edf3;--muted:#8b949e;--accent:#c6f432;--bad:#ff6b6b;--good:#3fb950;--line:#30363d}
@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){--bg:#f6f8fa;--card:#fff;--ink:#1f2328;--muted:#59636e;--accent:#4d7c0f;--bad:#cf222e;--good:#1a7f37;--line:#d0d7de}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:720px;margin:0 auto;padding:16px}
header{display:flex;gap:16px;align-items:center;margin:8px 0 20px}
.photo{width:88px;height:88px;border-radius:50%;object-fit:cover;border:3px solid var(--accent);background:var(--card)}
h1{font-size:1.6rem;margin:0}h2{font-size:1.05rem;margin:24px 0 10px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.sub{color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.tile .v{font-size:1.9rem;font-weight:700;font-variant-numeric:tabular-nums}.tile .l{color:var(--muted);font-size:.9rem}
.good .v{color:var(--good)}.bad .v{color:var(--bad)}.acc .v{color:var(--accent)}
.heat{display:grid;grid-template-columns:repeat(__COLS__,1fr);gap:3px;max-width:320px}
.heat div{aspect-ratio:1.6;border-radius:4px;background:var(--accent)}
.net{max-width:320px;text-align:center;color:var(--muted);font-size:.8rem;border-top:3px dashed var(--muted);margin-bottom:4px;padding-top:2px}
ul.tips{padding-left:20px}ul.tips li{margin:6px 0}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:6px;border-bottom:1px solid var(--line);text-align:right}td:first-child,th:first-child{text-align:left}
footer{color:var(--muted);font-size:.8rem;margin:28px 0 8px}
""".replace("__COLS__", str(HEATMAP_COLS))


def _photo_tag(player: Player) -> str:
    if player.photo_path and Path(player.photo_path).exists():
        data = base64.b64encode(Path(player.photo_path).read_bytes()).decode()
        return f'<img class="photo" src="data:image/jpeg;base64,{data}" alt="">'
    initial = html.escape(player.name[:1].upper())
    return f'<div class="photo" style="display:grid;place-items:center;font-size:2rem">{initial}</div>'


def _tile(value, label: str, cls: str = "") -> str:
    return f'<div class="tile {cls}"><div class="v">{value}</div><div class="l">{html.escape(label)}</div></div>'


def _heatmap(stats: PlayerStats) -> str:
    cells = [c for row in stats.heatmap for c in row] or [0] * (HEATMAP_ROWS * HEATMAP_COLS)
    peak = max(cells) or 1
    divs = "".join(f'<div style="opacity:{0.08 + 0.92 * c / peak:.2f}"></div>' for c in cells)
    return f'<div class="net">filet</div><div class="heat">{divs}</div>'


def player_report(player: Player, stats: PlayerStats, all_stats: dict[str, PlayerStats], match_label: str) -> str:
    s = stats
    pct = f"{100 * s.success_rate:.0f} %"
    tiles = "".join(
        [
            _tile(s.points_won, "points gagnés (équipe)", "acc"),
            _tile(s.shots, "coups joués"),
            _tile(s.winners, "coups gagnants", "good"),
            _tile(s.unforced_errors, "fautes directes", "bad"),
            _tile(s.forced_errors, "fautes provoquées"),
            _tile(s.unreturned, "balles non rattrapées", "bad"),
            _tile(s.well_placed, "balles bien placées", "good"),
            _tile(pct, "coups sans faute"),
            _tile(s.volleys, "volées"),
            _tile(f"{100 * s.net_presence:.0f} %", "coups joués au filet"),
            _tile(f"{s.max_speed_kmh:.0f} km/h", "frappe la plus rapide"),
            _tile(f"{s.distance_m:.0f} m", "distance parcourue"),
        ]
    )
    errors = f"dont {s.net_errors} dans le filet, {s.out_errors} dehors" if s.unforced_errors + s.forced_errors else ""
    tips = "".join(f"<li>{html.escape(t)}</li>" for t in s.tips())
    rows = "".join(
        f"<tr><td>{html.escape(o.name)}{' (toi)' if o.player_id == s.player_id else ''}</td>"
        f"<td>{o.shots}</td><td>{o.winners}</td><td>{o.unforced_errors}</td><td>{o.unreturned}</td></tr>"
        for o in sorted(all_stats.values(), key=lambda x: (x.team, x.name))
    )
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Ma partie — {html.escape(player.name)}</title>
<style>{CSS}</style></head><body><main>
<header>{_photo_tag(player)}<div><h1>{html.escape(player.name)}</h1>
<div class="sub">Équipe {s.team} · {html.escape(match_label)}</div></div></header>
<div class="grid">{tiles}</div>
<p class="sub">{errors}</p>
<h2>Tes axes d'amélioration</h2><ul class="tips">{tips}</ul>
<h2>Où tu as joué</h2>{_heatmap(s)}
<h2>La partie</h2>
<table><tr><th>Joueur</th><th>Coups</th><th>Gagnants</th><th>Fautes dir.</th><th>Non rattrapées</th></tr>{rows}</table>
<footer>Statistiques estimées automatiquement par vidéo, une seule caméra. Marge d'erreur de quelques coups par partie.</footer>
</main></body></html>"""


def write_reports(players: list[Player], stats: dict[str, PlayerStats], out_dir: str | Path, match_label: str) -> list[Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for p in players:
        path = out / f"rapport-{p.id}-{p.name.lower().replace(' ', '-')}.html"
        path.write_text(player_report(p, stats[p.id], stats, match_label), encoding="utf-8")
        paths.append(path)
    return paths
