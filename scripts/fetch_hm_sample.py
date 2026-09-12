"""
Pull 30 product images + metadata from the H&M Personalized Fashion
Recommendations Kaggle competition into data/.

Only downloads what we need: articles.csv (~36MB) plus 30 individual JPEGs.
The full competition is ~35GB -- we never touch it.

Prereqs:
  pip install kaggle
  Accept the competition rules at
  https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/rules
  Place kaggle.json at %USERPROFILE%\\.kaggle\\kaggle.json

Usage:
  python scripts/fetch_hm_sample.py             # sample fresh
  python scripts/fetch_hm_sample.py -n 100      # grab more than 30
  python scripts/fetch_hm_sample.py --manifest  # rebuild the exact same set

Outputs:
  data/images/<article_id>.jpg   the images
  data/catalog/products.json     full metadata per image
  data/catalog/labels.csv        flat image_file -> label table for training
  data/catalog/manifest.json     ids only, committed for reproducibility
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

COMP = "h-and-m-personalized-fashion-recommendations"
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
IMAGES = ROOT / "data" / "images"
CATALOG = ROOT / "data" / "catalog"
ARTICLES = RAW / "articles.csv"
MANIFEST = CATALOG / "manifest.json"
PRODUCTS = CATALOG / "products.json"
LABELS = CATALOG / "labels.csv"

# Spread the sample across these product groups so the set isn't all t-shirts.
# Weights are relative; actual counts scale to -n.
GROUP_WEIGHTS = [
    ("Garment Upper body", 8),
    ("Garment Lower body", 6),
    ("Garment Full body", 4),
    ("Shoes", 4),
    ("Bags", 3),
    ("Accessories", 5),
]

# Metadata columns copied straight from articles.csv. All real H&M values.
FIELDS = [
    "prod_name", "product_type_name", "product_group_name",
    "graphical_appearance_name", "colour_group_name",
    "perceived_colour_value_name", "perceived_colour_master_name",
    "department_name", "index_name", "index_group_name",
    "section_name", "garment_group_name", "detail_desc",
]


def run_kaggle(args):
    exe = shutil.which("kaggle")
    cmd = [exe] + args if exe else [sys.executable, "-m", "kaggle"] + args
    return subprocess.run(cmd, capture_output=True, text=True)


def preflight():
    probe = run_kaggle(["--version"])
    if probe.returncode != 0:
        detail = (probe.stderr or probe.stdout).strip()[:300]
        sys.exit(
            "Kaggle CLI not available.\n"
            "  pip install kaggle\n"
            "  (detail: " + detail + ")"
        )
    # Two credential styles are valid: the newer KGAT_ access token, and the
    # older kaggle.json username/key pair.
    kdir = Path.home() / ".kaggle"
    have = (
        (kdir / "access_token").exists()
        or (kdir / "kaggle.json").exists()
        or os.environ.get("KAGGLE_API_TOKEN")
        or os.environ.get("KAGGLE_KEY")
    )
    if not have:
        sys.exit(
            "No Kaggle credentials found in " + str(kdir) + "\n"
            "  1. kaggle.com -> avatar -> Settings -> API -> Create New Token\n"
            "  2. either write the KGAT_ token to " + str(kdir / "access_token") + "\n"
            "     or move the downloaded kaggle.json to " + str(kdir / "kaggle.json")
        )


def fetch_file(remote, dest_dir):
    """Download one file from the competition, unzipping if Kaggle zips it."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = remote.split("/")[-1]
    final = dest_dir / name
    if final.exists():
        return final

    res = run_kaggle(
        ["competitions", "download", "-c", COMP, "-f", remote, "-p", str(dest_dir)]
    )
    if res.returncode != 0:
        err = (res.stderr or res.stdout).strip()
        if "403" in err or "Forbidden" in err:
            sys.exit(
                "Kaggle returned 403 Forbidden.\n"
                "You have not accepted the competition rules yet. Open:\n"
                "  https://www.kaggle.com/competitions/" + COMP + "/rules\n"
                "click the accept button, then re-run this script."
            )
        print("  ! failed " + remote + ": " + err[:200], file=sys.stderr)
        return None

    zipped = dest_dir / (name + ".zip")
    if zipped.exists():
        with zipfile.ZipFile(zipped) as zf:
            zf.extractall(dest_dir)
        zipped.unlink()
    return final if final.exists() else None


def image_remote_path(article_id):
    """H&M images live at images/<first 3 digits>/<zero-padded id>.jpg"""
    padded = article_id.zfill(10)
    return "images/" + padded[:3] + "/" + padded + ".jpg"


def load_articles():
    if not ARTICLES.exists():
        print("Downloading articles.csv (~36MB) ...")
        if not fetch_file("articles.csv", RAW):
            sys.exit("Could not obtain articles.csv")
    with ARTICLES.open(encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def sample_articles(rows, want):
    by_group = {}
    for row in rows:
        if len(row.get("detail_desc") or "") < 40:
            continue
        by_group.setdefault(row["product_group_name"], []).append(row)

    total_weight = sum(w for _, w in GROUP_WEIGHTS)
    picked, seen = [], set()
    for group, weight in GROUP_WEIGHTS:
        quota = max(1, round(want * weight / total_weight))
        pool = by_group.get(group, [])
        if not pool:
            print("  ! no articles for group " + repr(group), file=sys.stderr)
            continue
        # deterministic spread across the pool rather than the first N
        step = max(1, len(pool) // (quota * 4))
        taken = 0
        for row in pool[::step]:
            if taken >= quota or len(picked) >= want:
                break
            aid = row["article_id"].zfill(10)
            if aid in seen:
                continue
            seen.add(aid)
            picked.append(row)
            taken += 1
    return picked[:want]


def build(rows):
    IMAGES.mkdir(parents=True, exist_ok=True)
    CATALOG.mkdir(parents=True, exist_ok=True)
    products, manifest = [], []

    for i, row in enumerate(rows, 1):
        aid = row["article_id"].zfill(10)
        print("[%2d/%d] %s  %s" % (i, len(rows), aid, (row["prod_name"] or "")[:40]))

        got = fetch_file(image_remote_path(aid), IMAGES)
        rec = {
            "article_id": aid,
            "image_file": (aid + ".jpg") if got else None,
            "image_path": ("data/images/" + aid + ".jpg") if got else None,
            "source": "kaggle:" + COMP,
        }
        rec.update({f: row.get(f) for f in FIELDS})
        products.append(rec)
        manifest.append(aid)

    PRODUCTS.write_text(json.dumps(products, indent=2, ensure_ascii=False), encoding="utf-8")
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # flat table for training pipelines
    label_cols = ["image_file", "article_id", "product_type_name",
                  "product_group_name", "garment_group_name",
                  "colour_group_name", "index_group_name", "prod_name"]
    with LABELS.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=label_cols)
        w.writeheader()
        for p in products:
            if p["image_file"]:
                w.writerow({c: p.get(c) for c in label_cols})

    ok = sum(1 for p in products if p["image_file"])
    print("\n%d/%d images -> %s/" % (ok, len(products), IMAGES.relative_to(ROOT)))
    print("metadata -> %s" % PRODUCTS.relative_to(ROOT))
    print("labels   -> %s" % LABELS.relative_to(ROOT))
    if ok < len(products):
        print("Some images missing; re-run to retry just those.")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=30, help="how many images (default 30)")
    ap.add_argument("--manifest", action="store_true",
                    help="rebuild the exact same set from the committed manifest")
    args = ap.parse_args()

    preflight()
    rows = load_articles()

    if args.manifest:
        if not MANIFEST.exists():
            sys.exit("No manifest at " + str(MANIFEST))
        wanted = set(json.loads(MANIFEST.read_text()))
        chosen = [r for r in rows if r["article_id"].zfill(10) in wanted]
        print("Rebuilding %d images from manifest" % len(chosen))
    else:
        chosen = sample_articles(rows, args.n)
        print("Sampled %d products" % len(chosen))

    build(chosen)


if __name__ == "__main__":
    main()
