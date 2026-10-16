"""Mesure de la précision du moteur sur des parties simulées (vérité connue)."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .pipeline import analyze_observations
from .simulate import MatchSimulator
from .stats import compute_stats

STAT_FIELDS = ["shots", "winners", "unforced_errors", "unreturned", "well_placed", "volleys", "points_won"]


@dataclass
class Evaluation:
    rallies: int = 0
    rallies_exact: int = 0
    rallies_missed: int = 0
    shots: int = 0
    shots_found: int = 0
    shots_right_player: int = 0
    landing_errors_m: list[float] = field(default_factory=list)
    stat_abs_errors: dict[str, list[float]] = field(default_factory=dict)
    stat_totals: Counter = field(default_factory=Counter)

    def merge_stat(self, name: str, truth: float, found: float) -> None:
        self.stat_abs_errors.setdefault(name, []).append(abs(truth - found))
        self.stat_totals[name] += truth

    def report(self) -> str:
        lines = [
            f"Échanges : {self.rallies_exact}/{self.rallies} lus exactement "
            f"(fin du point, équipe gagnante, joueur décisif) — {self.rallies_missed} manqués",
            f"Frappes détectées : {self.shots_found}/{self.shots} "
            f"({100 * self.shots_found / max(self.shots, 1):.0f} %), "
            f"bon joueur : {100 * self.shots_right_player / max(self.shots_found, 1):.0f} %",
        ]
        if self.landing_errors_m:
            err = np.array(self.landing_errors_m)
            lines.append(f"Point de chute : erreur médiane {np.median(err):.2f} m, < 0,5 m dans {100 * np.mean(err < 0.5):.0f} % des cas")
        lines.append("Écart moyen par joueur et par partie (vérité → mesuré) :")
        for name in STAT_FIELDS:
            errs = self.stat_abs_errors.get(name, [])
            if errs:
                mean_truth = self.stat_totals[name] / len(errs)
                lines.append(f"  {name:16s} ±{np.mean(errs):.1f} (moyenne réelle {mean_truth:.1f})")
        return "\n".join(lines)


def evaluate(seeds: list[int], n_rallies: int = 30, fps: int = 60) -> Evaluation:
    ev = Evaluation()
    for seed in seeds:
        sim = MatchSimulator(seed=seed, n_rallies=n_rallies, fps=fps).run()
        res = analyze_observations(sim.observations, sim.players, sim.calibration)
        found_shots = [s for r in res.rallies for s in r.shots]
        for tr in sim.truth_rallies:
            ev.rallies += 1
            match = [r for r in res.rallies if abs(r.t_start - tr.t_start) < 0.5]
            if not match:
                ev.rallies_missed += 1
            else:
                r = match[0]
                ev.rallies_exact += (r.ended_by, r.winner_team, r.decisive_player) == (
                    tr.ended_by,
                    tr.winner_team,
                    tr.decisive_player,
                )
            for s in tr.shots:
                ev.shots += 1
                cand = [x for x in found_shots if abs(x.t - s.t) < 0.1]
                if not cand:
                    continue
                ev.shots_found += 1
                ev.shots_right_player += cand[0].player_id == s.player_id
                if s.landing is not None and cand[0].landing is not None:
                    ev.landing_errors_m.append(float(np.hypot(*(np.array(cand[0].landing) - s.landing))))
        truth = compute_stats(sim.players, sim.truth_rallies, sim.truth_tracks)
        for pid, t_stats in truth.items():
            for name in STAT_FIELDS:
                ev.merge_stat(name, getattr(t_stats, name), getattr(res.stats[pid], name))
    return ev
