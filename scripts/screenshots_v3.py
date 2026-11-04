"""v3 screenshots, both themes. Needs core :4000, ocr :8001, web :5173."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from shot_util import BASE, login, demo, page
OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots", "v3"); os.makedirs(OUT, exist_ok=True)
SCREENS = [("dock", "dock_supervisor", ""), ("admin", "tenant_admin", "&tab=yard"), ("admin", "tenant_admin", "&tab=rules"), ("admin", "tenant_admin", "&tab=users"), ("ai", "tenant_admin", ""), ("tower", "yard_manager", "")]
TOUR = [0, 3, 5, 7, 8, 10, 12, 13, 14]
def run():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        for th in ("dark", "light"):
            ctx = b.new_context(viewport={"width": 1440, "height": 900}, color_scheme=th); pg = ctx.new_page()
            pg.goto(BASE + "/"); pg.wait_for_selector(".login, form"); pg.wait_for_timeout(600); pg.screenshot(path=f"{OUT}/login-{th}.png"); ctx.close()
            for s, role, q in SCREENS:
                ctx, pg = page(b, login(role), th); pg.goto(f"{BASE}/?s={s}{q}"); pg.wait_for_selector(".content > *:not(.empty-note)"); pg.wait_for_timeout(1200)
                pg.screenshot(path=f"{OUT}/{s}{q.replace('&tab=', '-')}-{th}.png"); ctx.close()
            # gate with an OCR read of a sample
            ctx, pg = page(b, login("gate_guard"), th); pg.goto(f"{BASE}/?s=gate"); pg.wait_for_selector(".cams")
            pg.locator(".cam-wrap").nth(1).locator("input[type=file]").set_input_files(os.path.join(os.path.dirname(__file__), "..", "services/ocr/samples/container_noisy_tilted.jpg"))
            pg.wait_for_selector(".ocr-boxes", timeout=45000); pg.wait_for_timeout(800); pg.screenshot(path=f"{OUT}/gate-ocr-{th}.png")
            ctx.close()
            ctx, pg = page(b, login("yard_manager"), th); pg.goto(f"{BASE}/?s=tower"); pg.wait_for_selector(".bell"); pg.click(".bell"); pg.wait_for_timeout(700); pg.screenshot(path=f"{OUT}/notifications-{th}.png"); ctx.close()
            ctx, pg = page(b, login("spotter"), th, 430, 860); pg.goto(f"{BASE}/?s=spotter"); pg.wait_for_selector(".sp-job"); ctx.set_offline(True)
            k = pg.locator(".knob").first.bounding_box(); tr = pg.locator(".knob").first.locator("xpath=..").bounding_box()
            pg.mouse.move(k["x"] + 5, k["y"] + 5); pg.mouse.down(); pg.mouse.move(tr["x"] + tr["width"] - 5, k["y"] + 5, steps=10); pg.mouse.up(); pg.wait_for_timeout(800)
            pg.screenshot(path=f"{OUT}/spotter-offline-{th}.png"); ctx.set_offline(False); pg.evaluate("dispatchEvent(new Event('online'))"); pg.wait_for_timeout(2000); ctx.close()
            tok = demo()
            for n in TOUR:
                ctx, pg = page(b, tok, th, extra="sessionStorage.removeItem('yms.tour.seen');"); pg.goto(f"{BASE}/?step={n}"); pg.wait_for_selector(".presenter"); pg.wait_for_timeout(2500)
                pg.screenshot(path=f"{OUT}/tour-{n + 1:02d}-{th}.png"); ctx.close()
        b.close()
if __name__ == "__main__": run(); print("ok", len(os.listdir(OUT)))
