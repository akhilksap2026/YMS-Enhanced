# v4 screens in light + dark. Needs core on :4000 and vite on :5173.
import sys, json, urllib.request; sys.path.insert(0, "scripts")
from playwright.sync_api import sync_playwright
from shot_util import *
from shot_util import _post
_t = {}
def tk(r):
    if r not in _t: _t[r] = login(r)
    return _t[r]
tok = tk("tenant_admin")
try: _post("/admin/sites", {"code": "NTH", "name": "North Depot", "doors": 4, "zones": [{"name": "A", "kind": "row", "slots": 10}, {"name": "W", "kind": "waiting", "slots": 4}]}, tok)
except Exception as e: print("site:", getattr(e, "read", lambda: e)())
SHOTS = [("reports-turn", "tenant_admin", "/?s=reports&report=turn", None), ("reports-carriers", "tenant_admin", "/?s=reports&report=carriers", None),
  ("reports-doors", "tenant_admin", "/?s=reports&report=doors", None), ("reports-dwell", "yard_manager", "/?s=reports&report=dwell", None),
  ("admin-sites", "tenant_admin", "/?s=admin&tab=site", None), ("admin-appointment-rules", "tenant_admin", "/?s=admin&tab=appt", None),
  ("admin-audit", "tenant_admin", "/?s=admin&tab=audit", None), ("carrier-booking", "carrier", "/?s=carrier", None),
  ("site-north-depot", "tenant_admin", "/?s=dock", "localStorage.setItem('yms.site','s-nth');"), ("account-password", "dock_supervisor", "/?s=dock", "acct")]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for theme in ("light", "dark"):
        for name, role, url, extra in SHOTS:
            ctx, pg = page(b, tk(role), theme, extra=(extra if extra and extra != "acct" else "localStorage.removeItem('yms.site');")); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(BASE + url); pg.wait_for_selector(".content"); pg.wait_for_timeout(1500)
            if extra == "acct": pg.click(".who"); pg.wait_for_timeout(400)
            pg.screenshot(path=f"screenshots/v4/{name}-{theme}.png"); print(name, theme, errs or "ok"); ctx.close()
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme); pg = ctx.new_page(); pg.goto(BASE); pg.wait_for_timeout(800)
        pg.click("text=Forgot password?"); pg.fill("#em2", "spotter@ksap.example"); pg.click("text=Send code"); pg.wait_for_timeout(800)
        pg.screenshot(path=f"screenshots/v4/login-reset-code-{theme}.png"); print("reset", theme); ctx.close()
