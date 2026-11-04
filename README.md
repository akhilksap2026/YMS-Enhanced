# YMSNow (iteration 1)

Foundation and UI shell for the YMSNow yard management product. All data is fictitious demo data.

## Layout
- `packages/contracts` shared v1 domain types and canonical event envelope (eventId, tenant/site, aggregate version).
- `services/core` Node + TypeScript (Express) modular monolith. One folder per bounded context under `src/modules`: tenant, appointments (pluggable source adapter: native / SAP stub / OTM stub), gate, yard, dock, tasks (versioned, offline-conflict rule), detention (indicative charges, approval state machine, audit history), notifications (outbox). In-process event bus with idempotency; in-memory repositories behind a `Repo` interface (Postgres adapter is next; Docker is not available on this box).
- `services/ocr` Python FastAPI stub behind the OCR adapter contract, with ISO 6346 validator and confidence routing (`auto` vs `guard_confirm`).
- `apps/web` React + TypeScript + Vite. Design tokens in `src/tokens.css` (8px grid, compact 28px rows, neutral palette, status colours).

## Run
```
npm --prefix services/core install && npm --prefix apps/web install
python3 -m venv services/ocr/.venv && services/ocr/.venv/bin/pip install fastapi uvicorn pytest httpx
npm run core      # :4000
npm run web       # :5173 (proxies /v1 to core)
npm run ocr       # :4100 (optional, not yet called by core)
npm test
npm run screenshots   # needs core + web running
```
Restart core to reset demo data.

## Keyboard
Ctrl/Cmd K command palette · / search · Alt 1–6 screens · Gate: Alt P pass, Alt H hold, Alt Q quarantine, arrow keys in queue · Detention inline edit: Enter save, Esc cancel.

## UI v2 (design system)
Token-based dark/light themes (top-bar toggle, remembers choice, follows OS by default), Lucide icons, collapsible rail, drawers, reduced-motion aware.
Screens: control tower (live flow + customisable widgets), 2.5D yard map (pan/zoom, select, drag-to-move, hold/release, plan/heat), gate console, mobile spotter (slide-to-confirm), dock, carrier, detention.
Screenshots: `python3 scripts/screenshots_v2.py` → `screenshots/v2/`.
