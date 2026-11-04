# v1.2 role homes + new screens, light and dark. Needs core :4000 and vite :5173.
import sys; sys.path.insert(0, "scripts")
from playwright.sync_api import sync_playwright
from shot_util import *
ROLES = ["yard_manager", "gate_guard", "dock_supervisor", "spotter", "carrier", "detention_approver", "tenant_admin"]
EXTRA = [x.split("=", 1) for x in sys.argv[1:]]  # name=role:/url
_t = {}
def tk(r):
    if r not in _t: _t[r] = login(r)
    return _t[r]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for theme in ("light", "dark"):
        shots = [(f"home-{r}", r, "/?s=home", 390 if r == "spotter" else 1440) for r in ROLES] + [(n, v.split(":", 1)[0], v.split(":", 1)[1], 390 if n.startswith(("driver", "spotter")) else 1440) for n, v in EXTRA]
        for name, role, url, w in shots:
            ctx, pg = page(b, tk(role) if role != "anon" else "", theme, w=w, h=900 if w > 500 else 844, extra="localStorage.removeItem('yms.site');"); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
            click = None
            if "|" in url: url, click = url.split("|", 1)
            pg.goto(BASE + url); pg.wait_for_timeout(1800)
            for c in (click.split(">") if click else []):
                try:
                    if c.startswith("~"): pg.get_by_placeholder("Unit, plate").first.fill(c[1:]); pg.wait_for_timeout(700); pg.keyboard.press("Enter")
                    elif c.startswith("#"): pg.locator(c[1:]).first.click(timeout=5000)
                    else: pg.get_by_text(c, exact=False).first.click(timeout=5000)
                    pg.wait_for_timeout(900)
                except Exception as e: print("CLICKFAIL", name, c)
            pg.screenshot(path=f"screenshots/v5/{name}-{theme}.png"); print(name, theme, errs or "ok"); ctx.close()
