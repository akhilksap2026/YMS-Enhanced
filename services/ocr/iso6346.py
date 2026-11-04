"""ISO 6346 container number validation (owner code + category + serial + check digit)."""
import re

_VALUES = {}
_v = 10
for _c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    if _v % 11 == 0:
        _v += 1
    _VALUES[_c] = _v
    _v += 1
_PATTERN = re.compile(r"^[A-Z]{3}[UJZR]\d{6}\d$")


def check_digit(first10: str) -> int:
    total = 0
    for i, ch in enumerate(first10):
        val = _VALUES[ch] if ch.isalpha() else int(ch)
        total += val * (2 ** i)
    return total % 11 % 10


def validate(number: str) -> dict:
    n = re.sub(r"[\s-]", "", number.upper())
    if not _PATTERN.match(n):
        return {"number": n, "valid": False, "reason": "format"}
    expected = check_digit(n[:10])
    ok = expected == int(n[10])
    return {"number": n, "valid": ok, "reason": None if ok else "check_digit", "expected": expected}
