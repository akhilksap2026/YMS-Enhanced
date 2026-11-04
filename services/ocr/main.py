"""YMSNow OCR service. Native Python: OpenCV preprocessing + PP-OCR (ONNX) recognition. Run: uvicorn main:app --port 8001"""
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from iso6346 import validate
from engine import CONFIDENCE_FLOOR, engine_name, read_image

app = FastAPI(title="YMSNow OCR", version="0.3.0")
MAX_BYTES = 8 * 1024 * 1024


class ReadRequest(BaseModel):
    image_ref: str
    hint_container: str | None = None
    hint_plate: str | None = None


@app.get("/health")
def health():
    return {"status": "ok", "engine": engine_name(), "confidence_floor": CONFIDENCE_FLOOR}


@app.get("/v1/iso6346/{number}")
def iso(number: str):
    return validate(number)


@app.post("/v1/read/image")
async def read_upload(file: UploadFile = File(...), kind: str = Form("auto")):
    if kind not in ("auto", "container", "plate"):
        raise HTTPException(422, "kind must be auto, container or plate")
    data = await file.read()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413 if data else 422, "image must be 1 byte to 8 MB")
    try:
        return read_image(data, kind)
    except ValueError as e:
        raise HTTPException(422, str(e))


@app.post("/v1/read")
def read(req: ReadRequest):
    """Legacy hint path kept for integrations that send typed values (no image)."""
    c = validate(req.hint_container) if req.hint_container else None
    conf = 0.9 if c and c["valid"] else 0.5
    return {"container": c, "plate": req.hint_plate, "confidence": conf,
            "route": "auto" if conf >= CONFIDENCE_FLOOR else "guard_confirm", "engine": "hint"}
