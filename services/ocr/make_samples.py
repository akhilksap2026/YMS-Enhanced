"""Generate synthetic gate images (container doors and plates) for tests and demos. All numbers fictitious."""
import os
import cv2
import numpy as np
from iso6346 import check_digit

OUT = os.path.join(os.path.dirname(__file__), "samples")


def container(owner_serial: str, path: str, color=(40, 60, 140), noise=0.0, angle=0.0, bad_check=False):
    cd = check_digit(owner_serial)
    num = f"{owner_serial[:4]} {owner_serial[4:]} {(cd + 1) % 10 if bad_check else cd}"
    img = np.full((480, 800, 3), color, np.uint8)
    for x in range(20, 800, 46):  # corrugation
        cv2.rectangle(img, (x, 0), (x + 22, 480), tuple(int(c * 0.82) for c in color), -1)
    cv2.rectangle(img, (40, 60), (560, 150), (0, 0, 0), -1)
    cv2.putText(img, num, (60, 128), cv2.FONT_HERSHEY_SIMPLEX, 1.9, (245, 245, 245), 5, cv2.LINE_AA)
    cv2.putText(img, "45G1", (60, 210), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (230, 230, 230), 3, cv2.LINE_AA)
    cv2.putText(img, "MAX GROSS 32500 KG", (60, 400), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (220, 220, 220), 2, cv2.LINE_AA)
    _finish(img, path, noise, angle)


def plate(text: str, path: str, noise=0.0, angle=0.0, night=False):
    img = np.full((420, 760, 3), (60, 55, 50), np.uint8)
    cv2.rectangle(img, (120, 60), (640, 260), (90, 85, 80), -1)  # grille
    cv2.rectangle(img, (200, 290), (560, 380), (215, 228, 232), -1)
    cv2.rectangle(img, (200, 290), (560, 380), (20, 20, 20), 3)
    cv2.putText(img, text, (222, 355), cv2.FONT_HERSHEY_DUPLEX, 1.7, (15, 15, 15), 4, cv2.LINE_AA)
    if night:
        img = (img * 0.35).astype(np.uint8)
    _finish(img, path, noise, angle)


def _finish(img, path, noise, angle):
    if angle:
        h, w = img.shape[:2]
        img = cv2.warpAffine(img, cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0), (w, h), borderMode=cv2.BORDER_REPLICATE)
    if noise:
        rng = np.random.default_rng(1)
        img = np.clip(img + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
        img = cv2.GaussianBlur(img, (3, 3), 0)
    cv2.imwrite(path, img, [cv2.IMWRITE_JPEG_QUALITY, 88])


SAMPLES = {
    "container_clean.jpg": lambda p: container("MSKU307294", p),
    "container_noisy_tilted.jpg": lambda p: container("TGHU451820", p, color=(30, 110, 40), noise=14, angle=3),
    "container_bad_check.jpg": lambda p: container("CSQU305438", p, color=(120, 70, 30), bad_check=True),
    "plate_day.jpg": lambda p: plate("XX-341-IZ", p),
    "plate_night_tilted.jpg": lambda p: plate("KS-725-AB", p, noise=8, angle=-4, night=True),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, f in SAMPLES.items():
        f(os.path.join(OUT, name))
    print("wrote", len(SAMPLES), "samples to", OUT)
