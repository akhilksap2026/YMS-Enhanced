"""Capture each screen with headless Chromium. Requires core on :4000 and web on :5173."""
import sys
from playwright.sync_api import sync_playwright
BASE = "http://localhost:5173"
SHOTS = [("tower", "Yard manager", 1440, 900), ("gate", "Gate guard", 1440, 900), ("dock", "Dock supervisor", 1440, 900),
         ("spotter", "Spotter", 390, 844), ("carrier", "Carrier", 1440, 900), ("detention", "Finance", 1440, 900)]
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    for s, role, w, h in SHOTS:
        pg = b.new_page(viewport={"width": w, "height": h})
        pg.on("console", lambda m: m.type == "error" and errors.append(f"{s}: {m.text}"))
        pg.goto(f"{BASE}/?s={s}&role={role}"); pg.wait_for_selector(".ph h1"); pg.wait_for_timeout(400)
        pg.screenshot(path=f"screenshots/{s}.png", full_page=False)
        if s == "tower":
            pg.keyboard.press("Control+k"); pg.keyboard.type("gate"); pg.wait_for_timeout(200); pg.screenshot(path="screenshots/command-palette.png")
        if s == "detention":
            pg.click("text=Adjust >> nth=0"); pg.wait_for_timeout(200); pg.screenshot(path="screenshots/detention-adjust.png")
        pg.close()
    b.close()
print("\n".join(errors) or "no console errors")
