// OCR adapter: core never links an OCR engine directly. Default adapter calls the native Python service (services/ocr).
export interface OcrRead { container: null | { number: string; valid: boolean; raw: string; confidence: number; suggested: string | null; corrections: number }; plate: null | { plate: string; confidence: number };
  confidence: number; route: "auto" | "guard_confirm"; engine: string; tokens: { text: string; score: number; box: number[][] }[]; size: [number, number] }
export interface OcrAdapter { read(image: Buffer, mime: string, kind: "auto" | "container" | "plate"): Promise<OcrRead>; health(): Promise<boolean> }
export const httpOcr = (base = process.env.OCR_URL ?? "http://127.0.0.1:8001"): OcrAdapter => ({
  async read(image, mime, kind) {
    const f = new FormData(); f.append("file", new Blob([new Uint8Array(image)], { type: mime }), "gate.jpg"); f.append("kind", kind);
    const r = await fetch(base + "/v1/read/image", { method: "POST", body: f, signal: AbortSignal.timeout(20_000) }).catch(() => { throw Object.assign(new Error("OCR service unreachable"), { status: 503 }); });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.detail ?? "OCR failed"), { status: r.status }); return j as OcrRead;
  },
  async health() { try { return (await fetch(base + "/health", { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } },
});
let adapter: OcrAdapter = httpOcr();
export const ocr = () => adapter;
export const setOcrAdapter = (a: OcrAdapter) => { adapter = a; };
