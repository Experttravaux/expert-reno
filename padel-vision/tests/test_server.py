import io
import time

from fastapi.testclient import TestClient
from PIL import Image

from padelvision.server import Settings, create_app


def _photo(color):
    buf = io.BytesIO()
    Image.new("RGB", (120, 240), color).save(buf, "JPEG")
    return buf.getvalue()


def test_full_kiosk_flow(tmp_path):
    cfg = Settings(data_dir=tmp_path, demo=True, demo_rallies=6, public_url="http://test")
    client = TestClient(create_app(cfg))
    sid = client.post("/api/sessions").json()["id"]

    # Sans consentement : refusé.
    r = client.post(f"/api/sessions/{sid}/players", data={"name": "A", "team": 1})
    assert r.status_code == 400

    names = [("Alex", 1, "red"), ("Bilal", 1, "white"), ("Chloé", 2, "blue"), ("Dylan", 2, "yellow")]
    tokens = []
    for name, team, color in names:
        r = client.post(
            f"/api/sessions/{sid}/players",
            data={"name": name, "team": team, "consent": "true"},
            files={"photo": ("p.jpg", _photo(color), "image/jpeg")},
        )
        assert r.status_code == 200, r.text
        tokens.append(r.json()["report_url"].rsplit("/", 1)[1])

    assert client.post(f"/api/sessions/{sid}/start").status_code == 200
    assert client.post(f"/api/sessions/{sid}/stop").status_code == 200
    for _ in range(300):
        status = client.get(f"/api/sessions/{sid}").json()
        if status["status"] != "analyzing":
            break
        time.sleep(0.2)
    assert status["status"] == "ready", status
    assert client.get(f"/qr/{tokens[0]}.svg").headers["content-type"].startswith("image/svg")

    # Rapport verrouillé tant que non payé.
    page = client.get(f"/r/{tokens[0]}").text
    assert "Débloque ton rapport" in page

    # Alex paie pour les quatre (paiement simulé).
    r = client.post(f"/r/{tokens[0]}/pay", data={"scope": "all"}, follow_redirects=False)
    assert r.status_code == 303 and "/mock-pay/" in r.headers["location"]
    pay_path = r.headers["location"].replace("http://test", "")
    client.post(pay_path, follow_redirects=False)

    for token in tokens:
        page = client.get(f"/r/{token}").text
        assert "Tes axes d'amélioration" in page
    assert all(p["paid"] for p in client.get(f"/api/sessions/{sid}").json()["players"])


def test_single_payment_unlocks_only_payer(tmp_path):
    cfg = Settings(data_dir=tmp_path, demo=True, demo_rallies=6, public_url="http://test")
    app = create_app(cfg)
    client = TestClient(app)
    sid = client.post("/api/sessions").json()["id"]
    tokens = []
    for i, team in enumerate([1, 1, 2, 2]):
        r = client.post(f"/api/sessions/{sid}/players", data={"name": f"J{i}", "team": team, "consent": "true"})
        tokens.append(r.json()["report_url"].rsplit("/", 1)[1])
    client.post(f"/api/sessions/{sid}/start")
    client.post(f"/api/sessions/{sid}/stop")
    for _ in range(300):
        if client.get(f"/api/sessions/{sid}").json()["status"] != "analyzing":
            break
        time.sleep(0.2)
    r = client.post(f"/r/{tokens[1]}/pay", data={"scope": "me"}, follow_redirects=False)
    client.post(r.headers["location"].replace("http://test", ""))
    paid = [p["paid"] for p in client.get(f"/api/sessions/{sid}").json()["players"]]
    assert paid == [False, True, False, False]
