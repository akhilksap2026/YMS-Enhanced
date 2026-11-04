# YMS Enhanced v1.1 — local installation

Runs entirely on your own computer. No cloud hosting, nothing leaves the machine
(outbound e-mail/SMS and ERP integrations are off/captured locally until you configure them).

## Prerequisites
| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20 or newer (22 LTS recommended) — https://nodejs.org | the application (required) |
| Python | 3.10 – 3.13 — https://python.org (Windows: tick "Add to PATH") | container/plate OCR (optional; manual entry works without it) |

First start needs internet once to download dependencies (~250 MB incl. the OCR model runtime). After that it runs offline.

## Start
- **Windows:** unzip, double-click `start.bat` (or run `.\start.ps1` in PowerShell).
- **macOS / Linux:** unzip, then `./start.sh` in a terminal.

Then open **http://localhost:8080**. Stop with Ctrl+C. Data is kept in `services/core/data/` between runs.
Change ports with `PORT=9090 ./start.sh` (PowerShell: `$env:PORT=9090; .\start.ps1`).

Optional Docker: `docker compose up` → http://localhost:8080.

## Demo logins (password for all: `Ymsnow!2026`)
| E-mail | Role |
|---|---|
| tenant.admin@ksap.example | Tenant admin (everything incl. Admin, Integrations, Notifications) |
| yard.manager@ksap.example | Yard manager |
| gate.guard@ksap.example | Gate guard |
| spotter@ksap.example | Spotter / jockey (mobile view) |
| dock.supervisor@ksap.example | Dock supervisor |
| detention.approver@ksap.example | Detention approver |
| carrier@ksap.example | Carrier portal |

The **Demo** tenant (switch on the login screen) runs a live simulation and can be reset at any time.
Change the demo passwords under Admin → Users before real use.

## Configuration (environment variables)
`PORT` (8080), `OCR_PORT` (8001), `JWT_SECRET` (otherwise a random secret is generated and stored in data/),
`YMS_DB_DIR` (database folder). E-mail SMTP / SMS gateway, ERP/OTM/SAP/WMS endpoints: in the app under Admin.

## Backups
Stop the app, run `./scripts/backup.sh` (or copy the `services/core/data` folder). Restore by putting the folder back.

## Troubleshooting
- **"Node.js 20+ required"** — install Node LTS and reopen the terminal.
- **Port 8080 in use** — start with another `PORT`.
- **OCR shows "unavailable"** — check `ocr.log`; delete `services/ocr/.venv` and start again to reinstall. On Linux you may need `libgl1` (`sudo apt install libgl1`).
- **PowerShell blocks the script** — use `start.bat`, which bypasses the execution policy for this script only.
- **Start fresh** — stop the app and delete `services/core/data`.

## Sites, reports and password reset (v1.1)
- **Add a site:** Admin → Sites → New site (code, name, time zone, doors, zones). Switch between sites from the top bar.
- **Reports:** use the Reports item in the side bar. CSV and Excel exports are also available at `/v1/reports/<dwell|turn|doors|detention|carriers>.csv|.xlsx`.
- **Password reset:** this needs SMTP configured under Admin → Notifications, otherwise the code only appears in the outbox. An admin can also set a password under Admin → Users.
