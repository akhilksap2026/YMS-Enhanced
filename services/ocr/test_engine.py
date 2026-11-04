import os, pytest
from fastapi.testclient import TestClient
from engine import read_image, repair_container
import make_samples
from main import app

S = make_samples.OUT


@pytest.fixture(scope="session", autouse=True)
def samples():
    os.makedirs(S, exist_ok=True)
    for n, f in make_samples.SAMPLES.items():
        if not os.path.exists(os.path.join(S, n)):
            f(os.path.join(S, n))


def rd(name, kind="auto"):
    return read_image(open(os.path.join(S, name), "rb").read(), kind)


def test_clean_container_reads_and_validates():
    r = rd("container_clean.jpg")
    assert r["container"]["number"] == "MSKU3072946" and r["container"]["valid"]
    assert r["confidence"] > 0.6


def test_noisy_tilted_container():
    r = rd("container_noisy_tilted.jpg")
    assert r["container"]["number"] == "TGHU4518206" and r["container"]["valid"]


def test_bad_check_digit_goes_to_guard_with_suggestion():
    r = rd("container_bad_check.jpg")
    c = r["container"]
    assert not c["valid"] and c["suggested"] == "CSQU3054383" and r["route"] == "guard_confirm"


def test_plates_day_and_night():
    assert rd("plate_day.jpg", "plate")["plate"]["plate"] == "XX-341-IZ"
    assert rd("plate_night_tilted.jpg", "plate")["plate"]["plate"] == "KS-725-AB"


def test_repair_common_confusions():
    n, ok, fixes = repair_container("MSKU3O7294G")  # O->0 in serial, G->6 check digit
    assert n == "MSKU3072946" and ok and fixes == 2


def test_upload_endpoint_and_errors():
    c = TestClient(app)
    with open(os.path.join(S, "container_clean.jpg"), "rb") as f:
        r = c.post("/v1/read/image", files={"file": ("a.jpg", f, "image/jpeg")}, data={"kind": "container"})
    assert r.status_code == 200 and r.json()["container"]["valid"]
    assert c.post("/v1/read/image", files={"file": ("a.txt", b"hello", "text/plain")}).status_code == 422
    assert c.get("/health").json()["engine"].startswith("pp-ocr")
