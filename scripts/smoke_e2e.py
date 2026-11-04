"""UI smoke: one-click actions on gate, dock, detention, spotter."""
from playwright.sync_api import sync_playwright
B = "http://localhost:5173"
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"]); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.goto(B + "/?s=gate&role=Gate guard"); pg.wait_for_selector(".ph h1"); n0 = pg.locator(".t tbody tr").count()
    pg.keyboard.press("Alt+p"); pg.wait_for_selector(".toast"); print("gate:", pg.inner_text(".toast")); pg.wait_for_timeout(300)
    assert pg.locator(".t tbody tr").count() == n0 - 1
    pg.goto(B + "/?s=dock&role=Dock supervisor"); pg.wait_for_selector(".ph h1")
    pg.locator(".t tbody tr").first.locator("button", has_text="→").click(); pg.wait_for_selector(".toast"); print("dock:", pg.inner_text(".toast"))
    pg.goto(B + "/?s=detention&role=Finance"); pg.wait_for_selector(".ph h1")
    pg.click("text=Reject >> nth=0"); pg.fill("input[aria-label=Comment]", "duplicate visit"); pg.keyboard.press("Enter"); pg.wait_for_selector(".toast"); print("detention:", pg.inner_text(".toast"))
    pg.goto(B + "/?s=spotter&role=Spotter"); pg.wait_for_selector(".ph h1"); pg.locator(".spot-card .btn").first.click(); pg.wait_for_selector(".toast"); print("spotter:", pg.inner_text(".toast"))
    b.close(); print("E2E OK")
