import json, urllib.request
BASE = "http://localhost:5173"; API = "http://localhost:4000/v1"
PW = "Ymsnow!2026"
def _post(path, body=None, token=None):
    rq = urllib.request.Request(API + path, data=json.dumps(body or {}).encode(), headers={"content-type": "application/json", **({"authorization": "Bearer " + token} if token else {})})
    return json.load(urllib.request.urlopen(rq))
def login(role): return _post("/auth/login", {"email": role.replace("_", ".", 1) + "@ksap.example", "password": PW})["token"]
def demo(role=None):
    t = _post("/auth/demo")["token"]
    return _post("/auth/demo/role", {"role": role}, t)["token"] if role else t
def page(browser, token, theme, w=1440, h=900, extra=""):
    ctx = browser.new_context(viewport={"width": w, "height": h}, color_scheme=theme)
    ctx.add_init_script(f"localStorage.setItem('yms.token', {json.dumps(token)}); sessionStorage.setItem('yms.tour.seen','1'); {extra}")
    return ctx, ctx.new_page()
