# YMS Enhanced v1.1

Yard management application: gate, yard, dock, spotter, carrier appointments, indicative detention, notifications, tenant admin, demo mode and an AI-tier preview. All data is fictitious.

## Layout
- `packages/contracts` shared domain types and event envelope.
- `services/core` Node + TypeScript (Express) modular monolith, one folder per bounded context under `src/modules`: auth, tenant, admin, appointments (source adapter: native / SAP TM-EWM / Oracle OTM), gate (+ OCR adapter), yard, dock, tasks (versioned, offline conflict rule), detention (indicative charges → approval → CSV export), notifications (outbox), demo.
  - **Persistence:** Postgres via embedded **PGlite** (`services/core/data/pg`). A system Postgres couldn't be installed on this box (apt mirror unavailable). Migrations are in `services/core/migrations`. Every table has `tenant_id` with forced row-level security (`app.tenant` + `app_user` role). Repositories keep the same synchronous interface, so modules didn't change. To move to managed Postgres, swap `shared/db.ts`.
  - **Auth:** JWT (12 h). Permissions are checked server-side in `shared/authz.ts`, and the UI filters navigation by role.
- `services/ocr` native Python: OpenCV preprocessing + RapidOCR (PP-OCR, ONNX, runs offline), ISO 6346 check-digit repair, confidence routing (`auto` ≥ 0.85 and valid, otherwise `guard_confirm`). Core calls it through `modules/gate/ocr.ts`.
- `apps/web` React + Vite, token-based light/dark design system.

## Run
```
npm --prefix services/core install && npm --prefix apps/web install
python3 -m venv services/ocr/.venv && services/ocr/.venv/bin/pip install -r services/ocr/requirements.txt
npm run seed          # optional; first start seeds automatically. `npm run seed -- --fresh` wipes and reseeds
npm run core          # :4000
npm run ocr           # :8001 (gate OCR upload)
npm run web           # :5173, proxies /v1 to core
npm test              # core vitest + OCR pytest
npm run screenshots   # needs all three running → screenshots/v3/
```
Data persists across restarts. Synthetic OCR samples: `services/ocr/make_samples.py` → `services/ocr/samples/`.

## Demo users (operations tenant `t-ksap`)
Password for all: `Ymsnow!2026`. These are local demo credentials only. Change or remove them before any real deployment, e.g. set `JWT_SECRET` and create real users in Tenant admin.

| Role | Email |
|---|---|
| Yard manager | yard.manager@ksap.example |
| Gate guard | gate.guard@ksap.example |
| Dock supervisor | dock.supervisor@ksap.example |
| Spotter | spotter@ksap.example |
| Carrier (Coastal, c2) | carrier@ksap.example |
| Tenant admin | tenant.admin@ksap.example |
| Detention approver | detention.approver@ksap.example |

## Demo mode
Click "Start demo" on the login screen. It uses a separate `t-demo` tenant ("Acme Logistics" branding, rich scripted data); RLS and a server guard keep it away from real tenant data.
- The DEMO badge menu has: guided tour, live simulation (generates arrivals, moves and alerts), reset demo data, and exit.
- "View as" switches role instantly.
- The tour has 15 spotlighted steps covering every capability. Use ← → to move between steps and Esc to close. `?step=N` deep-links a step.

## Keyboard
Ctrl/Cmd K command palette · / search · Alt 1–9 screens · Gate: Alt P pass, Alt H hold, Alt Q quarantine.

## What is new in v1.1
- **Appointment rules engine.** Settings are per site, under Admin → Appointment rules:
  - slot length, capacity per door per slot, and receiving windows with their own capacity;
  - lead time and booking horizon;
  - grace and no-show minutes;
  - reschedule policy (maximum count, minimum notice, whether a no-show can be rescheduled);
  - carrier rules (blocked, daily cap, allowed directions, allowed hours).
  A background sweep marks bookings late or no-show every 30 s. The carrier screen shows live availability with reasons, and supports booking and rescheduling. Tenant admins and yard managers can override a refusal, and each override is recorded in the appointment history.
- **Multi-site per tenant.** Create, edit or remove sites under Admin → Sites. Each new site gets its own doors and zones. The site switcher in the top bar scopes every screen and API call (`x-site` header). A site that still has units cannot be deleted.
- **Reports.** Dwell, turn time, door utilisation, detention (indicative; the user decides) and carrier scorecards. Filter by date range, carrier and direction. Each report has charts and a sortable table, and exports to CSV or Excel. The default site includes 30 days of fictitious history.
- **Hardening:**
  - zod validation on every write route; bad input returns 422 with field messages;
  - Admin → Audit log, filtered by user, text and date;
  - change your password by clicking your name;
  - "Forgot password" sends a 6-digit code by email (valid 30 minutes, single use);
  - rate limits on login and reset.

Screenshots (light and dark): `screenshots/v4/`. To regenerate them, run `python3 scripts/screenshots_v4.py` while core is on :4000 and vite is on :5173.

### Known limits
- Reset codes are held in memory, so a restart cancels them.
- The demo simulation and the SAP/OTM integration worker run on the default site only.
