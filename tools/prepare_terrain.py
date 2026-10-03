"""Prepare lightweight browser assets from NASA LRO/LOLA global products."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "source-data"
OUTPUT = ROOT / "dist" / "assets"

REGIONS = [
    {
        "id": "copernicus",
        "name": "哥白尼环形山",
        "subtitle": "Copernicus · 月球雨海东缘",
        "lat": 9.62,
        "lon": -20.08,
        "span": 9.0,
        "description": "大型年轻撞击坑与阶梯状坑壁，适合演示坡度规避。",
    },
    {
        "id": "taurus-littrow",
        "name": "陶拉斯-利特罗谷",
        "subtitle": "Apollo 17 · 登陆区",
        "lat": 20.19,
        "lon": 30.77,
        "span": 8.0,
        "description": "阿波罗 17 号登陆区，山谷与低缓平原并存。",
    },
    {
        "id": "tycho",
        "name": "第谷环形山",
        "subtitle": "Tycho · 月球南部高地",
        "lat": -43.31,
        "lon": -11.36,
        "span": 10.0,
        "description": "陡峭坑壁与中央峰地形，适合高风险路线对比。",
    },
]


def crop_equirectangular(image: Image.Image, lon: float, lat: float, span: float) -> Image.Image:
    width, height = image.size
    x0 = (lon - span / 2 + 180.0) / 360.0 * width
    x1 = (lon + span / 2 + 180.0) / 360.0 * width
    y0 = (90.0 - (lat + span / 2)) / 180.0 * height
    y1 = (90.0 - (lat - span / 2)) / 180.0 * height
    return image.crop((round(x0), round(y0), round(x1), round(y1)))


def make_relief(elevation: np.ndarray) -> Image.Image:
    normalized = (elevation - elevation.min()) / max(float(np.ptp(elevation)), 1.0)
    gy, gx = np.gradient(elevation.astype(np.float32))
    azimuth = math.radians(315)
    altitude = math.radians(38)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy) / 80.0)
    aspect = np.arctan2(-gx, gy)
    shade = np.sin(altitude) * np.sin(slope) + np.cos(altitude) * np.cos(slope) * np.cos(azimuth - aspect)
    shade = np.clip((shade + 1.0) * 0.5, 0.0, 1.0)

    low = np.array([13, 82, 102], dtype=np.float32)
    mid = np.array([31, 152, 128], dtype=np.float32)
    high = np.array([183, 176, 122], dtype=np.float32)
    t = normalized[..., None]
    color = np.where(t < 0.55, low + (mid - low) * (t / 0.55), mid + (high - mid) * ((t - 0.55) / 0.45))
    color *= (0.55 + 0.65 * shade[..., None])
    color = np.clip(color, 0, 255).astype(np.uint8)
    return Image.fromarray(color, "RGB")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    color_global = Image.open(SOURCE / "lroc_color_2k.jpg").convert("RGB")
    dem_global = Image.open(SOURCE / "ldem_16_uint.tif")

    color_global.save(OUTPUT / "moon-color.jpg", quality=91, optimize=True)
    metadata = []

    for region in REGIONS:
        dem_crop = crop_equirectangular(dem_global, region["lon"], region["lat"], region["span"])
        values = np.asarray(dem_crop, dtype=np.float32) * 0.5 - 10000.0
        minimum = float(values.min())
        maximum = float(values.max())
        mean = float(values.mean())

        height_norm = ((values - minimum) / max(maximum - minimum, 1.0) * 255.0).astype(np.uint8)
        height_image = Image.fromarray(height_norm, "L").resize((768, 768), Image.Resampling.BICUBIC)
        height_image.save(OUTPUT / f"{region['id']}-height.png", optimize=True)

        relief = make_relief(values).resize((768, 768), Image.Resampling.BICUBIC)
        lunar_color = crop_equirectangular(color_global, region["lon"], region["lat"], region["span"])
        lunar_color = lunar_color.resize((768, 768), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(0.35))
        lunar_color = ImageEnhance.Contrast(lunar_color).enhance(1.18)
        composite = Image.blend(relief, lunar_color, 0.17)
        composite = ImageEnhance.Contrast(composite).enhance(1.08)
        composite.save(OUTPUT / f"{region['id']}-relief.jpg", quality=92, optimize=True)

        width_km = 2 * math.pi * 1737.4 * (region["span"] / 360.0) * math.cos(math.radians(region["lat"]))
        height_km = math.pi * 1737.4 * (region["span"] / 180.0)
        metadata.append(
            {
                **region,
                "minElevation": round(minimum),
                "maxElevation": round(maximum),
                "meanElevation": round(mean),
                "widthKm": round(width_km, 1),
                "heightKm": round(height_km, 1),
                "heightAsset": f"assets/{region['id']}-height.png",
                "reliefAsset": f"assets/{region['id']}-relief.jpg",
            }
        )

    (OUTPUT / "terrain-meta.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"regions": len(metadata), "output": str(OUTPUT)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
