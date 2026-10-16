from padelvision.evaluate import evaluate


def test_engine_accuracy_on_simulated_matches():
    """Garde-fou : la précision du moteur ne doit pas régresser."""
    ev = evaluate([101, 102], n_rallies=15, fps=60)
    assert ev.rallies_missed <= 2
    assert ev.rallies_exact / ev.rallies >= 0.7
    assert ev.shots_found / ev.shots >= 0.85
    assert ev.shots_right_player / ev.shots_found >= 0.95
