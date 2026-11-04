"""v2 screenshots: every screen in dark and light. Needs core :4000 and web :5173. Does NOT mutate data except the drag shot (optional --drag)."""
import sys, os
from playwright.sync_api import sync_playwright
BASE = "http://localhost:5173"; OUT = "screenshots/v2"; os.makedirs(OUT, exist_ok=True)
SHOTS = [("tower", "Yard manager", 1440, 900), ("map", "Yard manager", 1440, 900), ("gate", "Gate guard", 1440, 900), ("dock", "Dock supervisor", 1440, 900),
         ("spotter", "Spotter", 390, 844), ("carrier", "Carrier", 1440, 900), ("detention", "Finance", 1440, 900)]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for theme in ("dark", "light"):
        for s, role, w, h in SHOTS:
            ctx = b.new_context(viewport={"width": w, "height": h}, color_scheme=theme)
            pg = ctx.new_page(); pg.on("console", lambda m, s=s: m.type == "error" and errors.append(f"{theme}/{s}: {m.text}"))
            pg.on("pageerror", lambda e, s=s: errors.append(f"{theme}/{s}: {e}"))
            pg.goto(f"{BASE}/?s={s}&role={role}"); pg.wait_for_selector(".content"); pg.wait_for_timeout(900)
            pg.screenshot(path=f"{OUT}/{s}-{theme}.png")
            if s == "map":
                u = pg.locator("[data-unit]").nth(5); u.click(); pg.wait_for_timeout(400); pg.screenshot(path=f"{OUT}/map-selected-{theme}.png")
                if theme == "dark":
                    pg.click("text=Plan"); pg.wait_for_timeout(500); pg.screenshot(path=f"{OUT}/map-plan-dark.png")
                    pg.click("text=Heat"); pg.wait_for_timeout(500); pg.screenshot(path=f"{OUT}/map-heat-dark.png")
                    pg.click("text=2.5D"); pg.wait_for_timeout(400)
                    bb = pg.locator("[data-unit]").nth(8).bounding_box(); pg.mouse.move(bb["x"] + bb["width"]/2, bb["y"] + bb["height"]/2); pg.mouse.down()
                    pg.mouse.move(bb["x"] + 60, bb["y"] - 80, steps=8); pg.wait_for_timeout(200); pg.screenshot(path=f"{OUT}/map-drag-dark.png"); pg.keyboard.press("Escape"); pg.mouse.up()
            if s == "tower" and theme == "dark":
                pg.locator(".dt.occupied").first.click(); pg.wait_for_timeout(400); pg.screenshot(path=f"{OUT}/tower-drawer-dark.png")
            ctx.close()
    b.close()
print("\n".join(errors) or "no console errors")
