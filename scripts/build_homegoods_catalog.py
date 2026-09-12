#!/usr/bin/env python3
"""Create a compact, balanced Amazon Reviews'23 Home & Kitchen catalog from gzip stdin."""

import csv
import gzip
import io
import json
import sys
from collections import Counter
from pathlib import Path

TARGETS = {
    "furniture_storage": ("shelf", "cabinet", "drawer", "storage", "organizer", "rack"),
    "lighting": ("lamp", "light", "lighting", "bulb", "lantern"),
    "kitchen_cookware": ("pan", "pot", "cookware", "knife", "skillet", "utensil", "bakeware"),
    "kitchen_appliances": ("coffee", "blender", "toaster", "air fryer", "mixer", "kettle", "rice cooker"),
    "bedding_bath": ("pillow", "blanket", "sheet", "duvet", "towel", "shower", "mattress"),
    "decor": ("vase", "mirror", "curtain", "rug", "clock", "candle"),
    "cleaning_laundry": ("vacuum", "mop", "broom", "cleaning", "laundry", "trash can"),
}
PER_BUCKET = 7
TARGET_ITEMS = 50


def as_list(value):
    return [str(part).strip() for part in value if str(part).strip()] if isinstance(value, list) else ([str(value).strip()] if value else [])


def main_image_url(images):
    for image in images or []:
        if image.get("variant") == "MAIN":
            return image.get("hi_res") or image.get("large") or image.get("thumb")
    for image in images or []:
        if image.get("hi_res") or image.get("large") or image.get("thumb"):
            return image.get("hi_res") or image.get("large") or image.get("thumb")
    return None


def group_for(record):
    title = (record.get("title") or "").lower()
    for group, keywords in TARGETS.items():
        if any(keyword in title for keyword in keywords):
            return group
    return "other_homegoods"


def to_catalog_record(record, group):
    return {
        "id": record.get("parent_asin"),
        "source": "Amazon Reviews 2023 / Home and Kitchen metadata",
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
        raise SystemExit("Usage: build_homegoods_catalog.py OUTPUT_DIRECTORY")
    destination = Path(sys.argv[1])
    destination.mkdir(parents=True, exist_ok=True)
    selected, fallback, seen, counts = [], [], set(), Counter()
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
                group = group_for(raw)
                item = to_catalog_record(raw, group)
                if not item["image_url"]:
                    continue
                if group == "other_homegoods":
                    fallback.append(item)
                elif counts[group] < PER_BUCKET:
                    selected.append(item)
                    seen.add(item_id)
                    counts[group] += 1
                if len(selected) >= PER_BUCKET * len(TARGETS):
                    break
    except (EOFError, OSError):
        pass

    selected.extend(fallback[: max(0, TARGET_ITEMS - len(selected))])
    selected = selected[:TARGET_ITEMS]
    (destination / "homegoods_catalog.json").write_text(json.dumps(selected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    fields = ["id", "catalog_group", "title", "brand_or_store", "price_usd", "average_rating", "rating_count", "image_url", "category_path", "features", "description", "details"]
    with (destination / "homegoods_catalog.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for item in selected:
            row = {field: item.get(field) for field in fields}
            for field in ("category_path", "features", "description", "details"):
                row[field] = json.dumps(row[field], ensure_ascii=False)
            writer.writerow(row)

    manifest = {
        "source": "Amazon Reviews 2023, Home and Kitchen metadata",
        "source_url": "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Home_and_Kitchen.jsonl.gz",
        "items": len(selected),
        "records_scanned": scanned,
        "groups": dict(Counter(item["catalog_group"] for item in selected)),
        "notes": "A compact catalog generated from a bounded source stream. Product image URLs are retained; images are not redistributed locally.",
    }
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"items": len(selected), "records_scanned": scanned, "groups": manifest["groups"]}))


if __name__ == "__main__":
    main()
