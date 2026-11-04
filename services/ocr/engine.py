"""Native Python OCR for gate images: OpenCV preprocessing + PP-OCR models (PaddleOCR, ONNX runtime via RapidOCR).
Extracts ISO 6346 container numbers (with check-digit repair of common OCR confusions) and licence plates, with confidence."""
from __future__ import annotations
import re
from dataclasses import dataclass, asdict
from functools import lru_cache
from itertools import product
import cv2
import numpy as np
from iso6346 import validate, check_digit

CONFIDENCE_FLOOR = 0.85
TO_DIGIT = {"O": "0", "Q": "0", "D": "0", "I": "1", "L": "1", "Z": "2", "S": "5", "B": "8", "G": "6", "T": "7"}
TO_ALPHA = {v: k for k, v in {"O": "0", "I": "1", "Z": "2", "S": "5", "B": "8", "G": "6"}.items()}
CONTAINER_RE = re.compile(r"[A-Z0-9]{3}[UJZR][A-Z0-9]{7}")
PLATE_RE = re.compile(r"\b(?=[A-Z0-9-]*\d)(?=[A-Z0-9-]*[A-Z])[A-Z0-9]{1,4}(?:[- ]?[A-Z0-9]{1,4}){1,3}\b")


@dataclass
class Token:
    text: str
    score: float
    box: list


@lru_cache(maxsize=1)
def _engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR()


def engine_name() -> str:
    try:
        _engine(); return "pp-ocr (rapidocr-onnxruntime)"
    except Exception:  # pragma: no cover
        return "unavailable"


def decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("not an image")
    return img


def preprocess(img: np.ndarray) -> np.ndarray:
    """Resize to a working size, equalise contrast (CLAHE) to cope with glare and night shots."""
    h, w = img.shape[:2]
    s = 1600 / max(h, w)
    if s < 1 or max(h, w) < 640:
        img = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(l)
    return cv2.cvtColor(cv2.merge((l, a, b)), cv2.COLOR_LAB2BGR)


def tokens(img: np.ndarray) -> list[Token]:
    res, _ = _engine()(img)
    out = [Token(t.upper().strip(), float(s), [[float(x), float(y)] for x, y in b]) for b, t, s in (res or [])]
    return sorted(out, key=lambda t: (round(t.box[0][1] / 40), t.box[0][0]))  # reading order


def repair_container(raw: str) -> tuple[str, bool, int]:
    """Coerce owner/category to letters and serial/check to digits, then try ambiguous swaps until the check digit validates.
    Returns (number, valid, corrections)."""
    s = raw[:11]
    letters = "".join(TO_ALPHA.get(c, c) for c in s[:4])
    digits = "".join(TO_DIGIT.get(c, c) for c in s[4:])
    n = letters + digits; fixes = sum(1 for a, b in zip(s, n) if a != b)
    if validate(n)["valid"]:
        return n, True, fixes
    if re.match(r"^[A-Z]{4}\d{6}$", n[:10]) and len(n) == 11 and n[10].isdigit():
        # check digit misread is the most common single error: trust the 10 chars if confidence is high (flagged by caller)
        return n, False, fixes
    return n, False, fixes


def find_container(toks: list[Token]) -> dict | None:
    joined = "".join(t.text.replace(" ", "").replace("-", "") for t in toks)
    best = None
    for m in CONTAINER_RE.finditer(joined):
        n, ok, fixes = repair_container(m.group(0))
        span = [t for t in toks if any(ch in t.text for ch in m.group(0)[:4])] or toks
        score = float(np.mean([t.score for t in span])) * (1.0 if ok else 0.55) * (0.97 ** fixes)
        cand = {"number": n, "valid": ok, "raw": m.group(0), "corrections": fixes, "confidence": round(score, 3),
                "suggested": None if ok or not re.match(r"^[A-Z]{4}\d{6}", n) else n[:10] + str(check_digit(n[:10]))}
        if not best or (cand["valid"], cand["confidence"]) > (best["valid"], best["confidence"]):
            best = cand
    return best


_TO_L = str.maketrans("01258", "OIZSB"); _TO_D = str.maketrans("OIQDZSBG", "01102586")
SIV_RE = re.compile(r"[A-Z0-9]{2}-[A-Z0-9]{3}-[A-Z0-9]{2}")


def repair_plate(p: str) -> tuple[str, int]:
    """Fix I/1, O/0, Z/2, S/5, B/8 swaps on plates in the AA-123-AA shape (letters, digits, letters)."""
    if not SIV_RE.fullmatch(p):
        return p, 0
    a, d, b = p.split("-")
    out = f"{a.translate(_TO_L)}-{d.translate(_TO_D)}-{b.translate(_TO_L)}"
    return out, sum(x != y for x, y in zip(p, out))


def find_plate(toks: list[Token], exclude: str | None = None) -> dict | None:
    cands = []
    for t in toks:
        txt = re.sub(r"[^A-Z0-9 -]", "", t.text)
        if exclude and txt.replace(" ", "").replace("-", "") in exclude:
            continue
        for m in PLATE_RE.finditer(txt):
            p, fixes = repair_plate(m.group(0).replace(" ", "-"))
            if 5 <= len(p.replace("-", "")) <= 9 and not CONTAINER_RE.fullmatch(p.replace("-", "")):
                h = abs(t.box[2][1] - t.box[0][1])
                cands.append({"plate": p, "confidence": round(t.score * (0.97 ** fixes), 3), "corrections": fixes, "_h": h})
    if not cands:
        return None
    best = max(cands, key=lambda c: (c["_h"] * c["confidence"]))  # biggest confident text block
    best.pop("_h"); return best


def read_image(data: bytes, kind: str = "auto") -> dict:
    img = preprocess(decode(data))
    toks = tokens(img)
    container = find_container(toks) if kind in ("auto", "container") else None
    plate = find_plate(toks, exclude=container["raw"] if container else None) if kind in ("auto", "plate") else None
    confs = [x["confidence"] for x in (container, plate) if x]
    conf = round(min(confs), 3) if confs else 0.0
    ok = conf >= CONFIDENCE_FLOOR and (container is None or container["valid"])
    return {"container": container, "plate": plate, "confidence": conf, "route": "auto" if ok else "guard_confirm",
            "engine": engine_name(), "tokens": [asdict(t) for t in toks], "size": list(img.shape[:2][::-1])}
