"""Prepare compact 5-degree-ready bands from NASA LRO/LOLA global data."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

# The NASA 64 ppd global TIFF is 23,040 × 11,520 pixels.
Image.MAX_IMAGE_PIXELS = None


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-data"
OUTPUT = ROOT / "dist" / "assets"
SOURCE_PPD = 64 if (SOURCE / "ldem_64_uint.tif").exists() else 16
PPD = 32 if SOURCE_PPD == 64 else 16


def make_relief(meters: np.ndarray, albedo: np.ndarray) -> Image.Image:
    gy, gx = np.gradient(meters.astype(np.float32))
    slope_x = gx / (30323.0 / PPD)
    slope_y = gy / (30323.0 / PPD)
    normal_z = 1 / np.sqrt(1 + slope_x * slope_x + slope_y * slope_y)
    light = np.clip((0.25 - slope_x * 0.42 - slope_y * 0.35) * normal_z + 0.55, 0.2, 1.15)
    t = np.clip((meters + 7000) / 12000, 0, 1)
    low = np.array([9, 67, 91], dtype=np.float32)
    mid = np.array([28, 139, 129], dtype=np.float32)
    high = np.array([190, 177, 123], dtype=np.float32)
    color = np.where(t[..., None] < 0.58,
                     low + (mid - low) * np.minimum(t[..., None] / 0.58, 1),
                     mid + (high - mid) * np.minimum((t[..., None] - 0.58) / 0.42, 1))
    grayscale = albedo.astype(np.float32).mean(axis=2, keepdims=True)
    detail = 0.82 + (grayscale / 255 - 0.5) * 0.35
    color = np.clip(color * light[..., None] * detail, 0, 255).astype(np.uint8)
    return Image.fromarray(color, "RGB")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    dem = Image.open(SOURCE / f"ldem_{SOURCE_PPD}_uint.tif")
    albedo = Image.open(SOURCE / "lroc_color_2k.jpg").convert("RGB")
    albedo.save(OUTPUT / "moon-color.jpg", quality=91, optimize=True)

    rows_per_band = 5 * PPD
    source_rows = 5 * SOURCE_PPD
    for band in range(36):
        top = band * source_rows
        bottom = top + source_rows
        source_band = np.asarray(dem.crop((0, top, dem.width, bottom)), dtype=np.uint16)
        if SOURCE_PPD != PPD:
            scale = SOURCE_PPD // PPD
            original = source_band.reshape(rows_per_band, scale, 360 * PPD, scale).mean(axis=(1, 3)).round().astype(np.uint16)
        else:
            original = source_band
        width = original.shape[1]
        rgb = np.empty((rows_per_band, width, 3), dtype=np.uint8)
        rgb[:, :, 0] = original >> 8
        rgb[:, :, 1] = original & 255
        rgb[:, :, 2] = 0
        Image.fromarray(rgb, "RGB").save(OUTPUT / f"height-band-{band:02d}.png", optimize=True)

        meters = original.astype(np.float32) * 0.5 - 10000
        y0 = top / dem.height * albedo.height
        y1 = bottom / dem.height * albedo.height
        color_band = albedo.crop((0, round(y0), albedo.width, round(y1)))
        color_band = color_band.resize((width, rows_per_band), Image.Resampling.BILINEAR)
        make_relief(meters, np.asarray(color_band)).save(
            OUTPUT / f"relief-band-{band:02d}.jpg", quality=86, optimize=True
        )

    manifest = {
        "source": f"NASA LRO WAC / LOLA {SOURCE_PPD} ppd global, averaged to {PPD} ppd",
        "ppd": PPD,
        "tileDegrees": 5,
        "longitudeCells": 72,
        "latitudeCells": 36,
        "tileCount": 2592,
        "heightEncoding": "red * 256 + green; elevation_m = value * 0.5 - 10000",
        "heightReferenceRadiusKm": 1737.4,
    }
    (OUTPUT / "terrain-meta.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
