"""Captures the real Firefox popup at 2x in each view of views.mjs, plus where the elements
the callouts point at are (raw-ui/firefox/rects.js). The Chrome twin is capture.mjs.

Needs selenium (its Selenium Manager fetches geckodriver), Pillow, Firefox, and
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 (to read the add-on's moz-extension host).
Run from wxt-dev-wxt/ after `npm run build:firefox`:
    MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 python ../store-assets/tools/capture_firefox.py
The add-on is installed from a copy without its background (nothing is checked or
claimed) and with its optional hosts granted, as a user who turned every store on.
"""
import json
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from PIL import Image
from selenium import webdriver
from selenium.webdriver.common.by import By

TOOLS = Path(__file__).resolve().parent
OUT_DIR = TOOLS.parent / "raw-ui" / "firefox"
DIST_DIR = Path("dist/firefox-mv2").resolve()
FIREFOX = "/Applications/Firefox.app/Contents/MacOS/firefox"
SCALE = 2
POPUP_MAX_HEIGHT = 600

SEED = """
const [data, done] = arguments;
browser.storage.local.clear().then(() => browser.storage.local.set(data)).then(() => done(true), (e) => done(String(e)));
"""
RECTS = """
const targets = arguments[0];
return Object.fromEntries(Object.entries(targets).map(([key, selector]) => {
    const element = document.querySelector(selector);
    if (!element) return [key, null];
    const { x, y, width, height } = element.getBoundingClientRect();
    return [key, { x, y, w: width, h: height }];
}));
"""
IMAGES_LOADED = "return [...document.images].every((img) => img.complete);"


def prepare_extension(work_dir: Path) -> tuple[Path, str]:
    ext_dir = work_dir / "ext"
    shutil.copytree(DIST_DIR, ext_dir)
    manifest_path = ext_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest.pop("background", None)
    manifest.pop("content_scripts", None)
    optional = manifest.pop("optional_permissions", [])
    granted = [o for o in optional if "luna.amazon." not in o or o == "https://luna.amazon.com/*"]
    manifest["permissions"] = manifest["permissions"] + granted
    manifest_path.write_text(json.dumps(manifest))
    return ext_dir, manifest["browser_specific_settings"]["gecko"]["id"]


def wait_for(driver, script: str, timeout: float = 20) -> None:
    end = time.monotonic() + timeout
    while not driver.execute_script(script):
        if time.monotonic() > end:
            raise TimeoutError(script)
        time.sleep(0.2)


def capture_view(driver, url: str, name: str, view: dict) -> dict:
    assert driver.execute_async_script(SEED, view["storage"]) is True, f"{name}: seeding storage failed"
    driver.get(url)
    time.sleep(1.5)
    wait_for(driver, IMAGES_LOADED)
    time.sleep(0.5)
    rects = driver.execute_script(RECTS, view["targets"])
    shot = OUT_DIR / f"{name}.png"
    driver.find_element(By.CSS_SELECTOR, ".App").screenshot(str(shot))
    # Firefox caps a popup at 600 px, like Chrome.
    with Image.open(shot) as image:
        height = min(image.height, POPUP_MAX_HEIGHT * SCALE)
        image.crop((0, 0, image.width, height)).save(shot)
    return rects


def main() -> None:
    views = json.loads(subprocess.check_output(["node", str(TOOLS / "views.mjs")]))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    work_dir = Path(tempfile.mkdtemp(prefix="fgc-capture-firefox-"))
    ext_dir, addon_id = prepare_extension(work_dir)

    options = webdriver.FirefoxOptions()
    options.binary_location = FIREFOX
    options.add_argument("-headless")
    options.set_preference("layout.css.devPixelsPerPx", str(SCALE))
    options.set_preference("intl.accept_languages", "en-US")
    options.set_preference("ui.useOverlayScrollbars", 1)
    driver = webdriver.Firefox(options=options)
    rects = {}
    try:
        driver.install_addon(str(ext_dir), temporary=True)
        time.sleep(2)
        driver.set_context("chrome")
        host = driver.execute_script(f'return WebExtensionPolicy.getByID("{addon_id}").mozExtensionHostname;')
        driver.set_context("content")
        # Firefox windows are at least 500 px wide; the popup body is 360 px, captured alone.
        driver.set_window_size(700, 1000)
        url = f"moz-extension://{host}/popup.html"
        driver.get(url)
        # The first load writes its defaults to storage: let it finish before seeding.
        time.sleep(1.5)
        for name, view in views.items():
            rects[f"{name}.png"] = capture_view(driver, url, name, view)
    finally:
        driver.quit()
        shutil.rmtree(work_dir, ignore_errors=True)

    (OUT_DIR / "rects.js").write_text(f"window.RECTS = {json.dumps(rects, indent=1)};\n")
    missing = [f"{file}:{key}" for file, targets in rects.items() for key, rect in targets.items() if not rect]
    print(json.dumps({"files": sorted(p.name for p in OUT_DIR.iterdir()), "missing": missing}))


if __name__ == "__main__":
    main()
