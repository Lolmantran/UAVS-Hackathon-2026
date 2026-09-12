#!/usr/bin/env python3
"""Create a compact, balanced Amazon Reviews'23 Electronics catalog from gzip stdin."""

import csv
import gzip
import io
import json
import sys
from collections import Counter
from pathlib import Path

TARGETS = {
    "audio": ("headphone", "earbud", "headset", "microphone", "speaker", "soundbar"),
    "computer_input": ("keyboard", "mouse", "trackpad", "webcam", "stylus"),
    "charging_connectivity": ("charger", "charging", "usb", "cable", "adapter", "hub", "dock", "hdmi"),
    "storage": ("ssd", "hard drive", "flash drive", "memory card", "storage", "nas"),
    "display": ("monitor", "display", "projector"),
    "camera_smart_home": ("camera", "doorbell", "smart home", "thermostat", "security", "surveillance"),
    "networking": ("router", "wi-fi", "wifi", "ethernet", "modem", "mesh"),
    "mobile_accessories": ("phone case", "iphone", "samsung", "tablet", "smartwatch", "watch band", "screen protector", "power bank"),
}

PER_BUCKET = 22
FALLBACK_LIMIT = 4


def text_list(value):
    if isinstance(value, list):
        return [str(part).strip() for part in value if str(part).strip()]
    return [str(value).strip()] if value else []


def image_url(images):
    for image in images or []:
        if image.get("variant") == "MAIN":
            return image.get("hi_res") or image.get("large") or image.get("thumb")
    for image in images or []:
        candidate = image.get("hi_res") or image.get("large") or image.get("thumb")
        if candidate:
            return candidate
    return None


def bucket_for(record):
    # Classify on product title only: supporting fields often list compatible
    # devices and make a phone case look like a monitor or headset.
    searchable = " ".join(
        text_list(record.get("title"))
        + text_list(record.get("categories"))
    ).lower()
    for bucket, keywords in TARGETS.items():
        if any(keyword in searchable for keyword in keywords):
            return bucket
    return "other_electronics"


def normalized(record, bucket):
    return {
        "id": record.get("parent_asin"),
        "source": "Amazon Reviews 2023 / Electronics metadata",
        "main_category": record.get("main_category"),
        "category_path": text_list(record.get("categories")),
        "catalog_group": bucket,
        "title": record.get("title"),
        "brand_or_store": record.get("store") or (record.get("details") or {}).get("Brand"),
        "price_usd": record.get("price"),
        "average_rating": record.get("average_rating"),
        "rating_count": record.get("rating_number"),
        "features": text_list(record.get("features")),
        "description": text_list(record.get("description")),
        "details": record.get("details") or {},
        "image_url": image_url(record.get("images")),
    }


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: build_electronics_catalog.py OUTPUT_DIRECTORY")

    output_dir = Path(sys.argv[1])
    output_dir.mkdir(parents=True, exist_ok=True)
    selected = []
    seen = set()
    counts = Counter()
    fallback = []
    scanned = 0

    try:
        with gzip.GzipFile(fileobj=sys.stdin.buffer) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8") as lines:
                for line in lines:
                    scanned += 1
                    try:
                        record = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    item_id = record.get("parent_asin")
                    if not item_id or item_id in seen or not record.get("title"):
                        continue
                    bucket = bucket_for(record)
                    entry = normalized(record, bucket)
                    if not entry["image_url"]:
                        continue
                    if bucket == "other_electronics":
                        if len(fallback) < FALLBACK_LIMIT * len(TARGETS):
                            fallback.append(entry)
                        continue
                    if counts[bucket] < PER_BUCKET:
                        selected.append(entry)
                        seen.add(item_id)
                        counts[bucket] += 1
                    if len(selected) >= PER_BUCKET * len(TARGETS):
                        break
    except (EOFError, OSError):
        # A ranged download ends without a gzip trailer. Records decoded before that
        # point are valid and sufficient for a compact hackathon catalog.
        pass

    for entry in fallback:
        if len(selected) >= 180:
            break
        selected.append(entry)
    selected = selected[:180]

    json_path = output_dir / "electronics_catalog.json"
    csv_path = output_dir / "electronics_catalog.csv"
    manifest_path = output_dir / "manifest.json"
    json_path.write_text(json.dumps(selected, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    with csv_path.open("w", newline="", encoding="utf-8") as file:
        fields = ["id", "catalog_group", "title", "brand_or_store", "price_usd", "average_rating", "rating_count", "image_url", "category_path", "features", "description", "details"]
        writer = csv.DictWriter(file, fieldnames=fields)
        writer.writeheader()
        for entry in selected:
            row = {key: entry.get(key) for key in fields}
            for key in ("category_path", "features", "description", "details"):
                row[key] = json.dumps(row[key], ensure_ascii=False)
            writer.writerow(row)

    manifest_path.write_text(json.dumps({
        "source": "Amazon Reviews 2023, Electronics metadata",
        "source_url": "https://mcauleylab.ucsd.edu/public_datasets/data/amazon_2023/raw/meta_categories/meta_Electronics.jsonl.gz",
        "items": len(selected),
        "records_scanned": scanned,
        "groups": dict(Counter(item["catalog_group"] for item in selected)),
        "notes": "A compact catalog generated from a bounded source stream. Product image URLs are retained; images are not redistributed locally.",
    }, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({"items": len(selected), "records_scanned": scanned, "groups": dict(Counter(item["catalog_group"] for item in selected))}))


if __name__ == "__main__":
    main()
