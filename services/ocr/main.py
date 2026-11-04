"""YMSNow OCR service (iteration 1 stub). Implements the OCR adapter contract.
Detection/recognition (OpenCV + YOLO + PaddleOCR) lands in a later iteration; /read currently
accepts a typed hint so the gate flow and confidence routing can be exercised end to end."""
from fastapi import FastAPI
from pydantic import BaseModel
from iso6346 import validate

app = FastAPI(title="YMSNow OCR", version="0.1.0")
CONFIDENCE_FLOOR = 0.85


class ReadRequest(BaseModel):
    image_ref: str
    hint_container: str | None = None
    hint_plate: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "engine": "stub"}


@app.get("/v1/iso6346/{number}")
def iso(number: str):
    return validate(number)


@app.post("/v1/read")
def read(req: ReadRequest):
    c = validate(req.hint_container) if req.hint_container else None
    conf = 0.9 if c and c["valid"] else 0.5
    return {
        "container": c, "plate": req.hint_plate, "confidence": conf,
        "route": "auto" if conf >= CONFIDENCE_FLOOR else "guard_confirm", "engine": "stub",
    }
