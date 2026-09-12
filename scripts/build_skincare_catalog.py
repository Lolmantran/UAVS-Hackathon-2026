#!/usr/bin/env python3
"""Create a compact Amazon Reviews'23 skincare catalog from gzip stdin."""

import csv
import gzip
import io
import json
import sys
from collections import Counter
from pathlib import Path

TARGETS = {
    "cleanser": ("cleanser", "cleansing", "face wash", "facial wash"),
    "moisturizer": ("moisturizer", "moisturiser", "face cream", "facial cream", "face lotion"),
    "serum_treatment": ("serum", "retinol", "vitamin c", "hyaluronic", "acne treatment", "face treatment"),
    "mask_exfoliant": ("face mask", "facial mask", "peel", "exfoliant", "face scrub", "facial scrub"),
    "sun_protection": ("sunscreen", "sun screen", "spf"),
    "toner_essence": ("toner", "essence", "micellar", "astringent"),
}
PER_GROUP = 6
TARGET_ITEMS = 40
EXCLUDED_TITLE_TERMS = (
    "hair", "scalp", "beard", "feet", "foot", "hand", "nail", "wig", "shampoo", "conditioner",
    "eyebrow", "eye brow", "eyeliner", "eye shadow", "lipstick", "foundation", "makeup",
)


def as_list(value):
    return [str(part).strip() for part in value if str(part).strip()] if isinstance(value, list) else ([str(value).strip()] if value else [])


def main_image_url(images):
    for image in images or []:
        if image.get("variant") == "MAIN":
            return image.get("hi_res") or image.get("large") or image.get("thumb")
    for image in images or []:
        url = image.get("hi_res") or image.get("large") or image.get("thumb")
        if url:
            return url
    return None


def group_for(record):
    title = (record.get("title") or "").lower()
    for group, keywords in TARGETS.items():
        if any(keyword in title for keyword in keywords):
            return group
    return None


def normalize(record, group):
    return {
        "id": record.get("parent_asin"),
        "source": "Amazon Reviews 2023 / Beauty and Personal Care metadata",
        "main_category": record.get("main_category"),
        "category_path": as_list(record.get("categories")),
        "catalog_group": group,
        "title": record.get("title"),
        "brand_or_store": record.get("store") or (record.get("details") or {}).get("Brand"),
        "price_usd": record.get("price"),
        "average_rating": record.get("average_rating"),
        "rating_count": record.get("rating_number"),
        "features": as_list(record.get("features")),
        "description": as_list(record.get("description")),
        "details": record.get("details") or {},
        "image_url": main_image_url(record.get("images")),
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_skincare_catalog.py OUTPUT_DIRECTORY")
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    selected, seen, counts = [], set(), Counter()
    scanned = 0

    try:
        with gzip.GzipFile(fileobj=sys.stdin.buffer) as compressed, io.TextIOWrapper(compressed, encoding="utf-8") as lines:
            for line in lines:
                scanned += 1
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue
                item_id = raw.get("parent_asin")
                if not item_id or item_id in seen or not raw.get("title"):
                    continue
                if any(term in raw["title"].lower() for term in EXCLUDED_TITLE_TERMS):
                    continue
                group = group_for(raw)
                if not group or counts[group] >= PER_GROUP:
                    continue
                item = normalize(raw, group)
                if not item["image_url"]:
                    continue
                selected.append(item)
                seen.add(item_id)
                counts[group] += 1
                if len(selected) >= PER_GROUP * len(TARGETS):
                    break
    except (EOFError, OSError):
        pass

    # Keep the requested catalog size while retaining only skincare-labelled items.
    selected = selected[:TARGET_ITEMS]
    (destination / "skincare_catalog.json").write_text(json.dumps(selected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    fields = ["id", "catalog_group", "title", "brand_or_store", "price_usd", "average_rating", "rating_count", "image_url", "category_path", "features", "description", "details"]
    with (destination / "skincare_catalog.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for item in selected:
            row = {field: item.get(field) for field in fields}
            for field in ("category_path", "features", "description", "details"):
                row[field] = json.dumps(row[field], ensure_ascii=False)
            writer.writerow(row)
    manifest = {
        "source": "Amazon Reviews 2023, Beauty and Personal Care metadata",
        "source_url": "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Beauty_and_Personal_Care.jsonl.gz",
        "items": len(selected),
        "records_scanned": scanned,
        "groups": dict(Counter(item["catalog_group"] for item in selected)),
        "notes": "A compact skincare-only catalog generated from a bounded source stream. Product image URLs are retained; images are not redistributed locally.",
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"items": len(selected), "records_scanned": scanned, "groups": manifest["groups"]}))


if __name__ == "__main__":
    main()
