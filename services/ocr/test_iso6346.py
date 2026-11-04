from fastapi.testclient import TestClient
from iso6346 import validate, check_digit
from main import app


def test_known_valid():
    assert validate("CSQU3054383")["valid"]


def test_check_digit_value():
    assert check_digit("CSQU305438") == 3


def test_bad_check_digit():
    r = validate("CSQU3054384")
    assert not r["valid"] and r["reason"] == "check_digit"


def test_bad_format():
    assert validate("CSQ3054383")["reason"] == "format"
    assert validate("CSQX3054383")["reason"] == "format"


def test_api_routes_low_confidence_to_guard():
    c = TestClient(app)
    assert c.post("/v1/read", json={"image_ref": "x", "hint_container": "CSQU3054384"}).json()["route"] == "guard_confirm"
    assert c.post("/v1/read", json={"image_ref": "x", "hint_container": "CSQU3054383"}).json()["route"] == "auto"
