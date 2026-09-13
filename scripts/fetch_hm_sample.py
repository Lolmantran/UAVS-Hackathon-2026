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
  python scripts/fetch_hm_sample.py             # sample fresh (overwrites the catalog)
  python scripts/fetch_hm_sample.py -n 100      # grab more than 30 (overwrites)
  python scripts/fetch_hm_sample.py --manifest  # rebuild the exact same set
  python scripts/fetch_hm_sample.py --add 70    # ADD 70 new products on top of the
                                                 # existing catalog, split evenly across
                                                 # the product groups, skipping ids already
                                                 # in data/clothing/manifest.json

Outputs (data/clothing/ -- must match src/catalog/loader.ts's loadClothing() path):
  data/images/<article_id>.jpg    the images
  data/clothing/products.json     full metadata per image
  data/clothing/labels.csv        flat image_file -> label table for training
  data/clothing/manifest.json     ids only, committed for reproducibility
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
# Must match src/catalog/loader.ts's loadClothing(), which reads "clothing/products.json"
# relative to data/. This was "data/catalog/" in an earlier version of this script and got
# renamed at some point without this script following -- re-check if loader.ts's path ever moves.
CATALOG = ROOT / "data" / "clothing"
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


def _group_pools(rows, exclude_ids=frozenset()):
    by_group = {}
    for row in rows:
        if len(row.get("detail_desc") or "") < 40:
            continue
        if row["article_id"].zfill(10) in exclude_ids:
            continue
        by_group.setdefault(row["product_group_name"], []).append(row)
    return by_group


def _take_from_pool(pool, quota, seen):
    """Deterministic spread across the pool rather than the first N, skipping ids in `seen`."""
    if not pool:
        return []
    step = max(1, len(pool) // (quota * 4))
    taken = []
    for row in pool[::step]:
        if len(taken) >= quota:
            break
        aid = row["article_id"].zfill(10)
        if aid in seen:
            continue
        seen.add(aid)
        taken.append(row)
    return taken


def sample_articles(rows, want):
    """Original weighted-by-GROUP_WEIGHTS sampler, used for a fresh/full sample."""
    by_group = _group_pools(rows)
    total_weight = sum(w for _, w in GROUP_WEIGHTS)
    picked, seen = [], set()
    for group, weight in GROUP_WEIGHTS:
        quota = max(1, round(want * weight / total_weight))
        pool = by_group.get(group, [])
        if not pool:
            print("  ! no articles for group " + repr(group), file=sys.stderr)
            continue
        for row in _take_from_pool(pool, min(quota, want - len(picked)), seen):
            picked.append(row)
    return picked[:want]


def sample_articles_even(rows, want, exclude_ids=frozenset()):
    """Even split across GROUP_WEIGHTS's groups (ignoring their weights), excluding ids already
    in the catalog. Remainder from want / num_groups goes to the first groups in list order."""
    groups = [g for g, _ in GROUP_WEIGHTS]
    by_group = _group_pools(rows, exclude_ids)
    base, remainder = divmod(want, len(groups))

    picked, seen = [], set(exclude_ids)
    for i, group in enumerate(groups):
        quota = base + (1 if i < remainder else 0)
        pool = by_group.get(group, [])
        if not pool:
            print("  ! no new articles available for group " + repr(group), file=sys.stderr)
            continue
        taken = _take_from_pool(pool, quota, seen)
        if len(taken) < quota:
            print("  ! only %d/%d new articles available for group %r (pool exhausted)"
                  % (len(taken), quota, group), file=sys.stderr)
        picked.extend(taken)
    return picked


LABEL_COLS = ["image_file", "article_id", "product_type_name",
              "product_group_name", "garment_group_name",
              "colour_group_name", "index_group_name", "prod_name"]


def _fetch_and_build_records(rows):
    """Downloads each row's image and returns the metadata record list + manifest ids."""
    IMAGES.mkdir(parents=True, exist_ok=True)
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
    return products, manifest


def _write_catalog(products):
    CATALOG.mkdir(parents=True, exist_ok=True)
    manifest = [p["article_id"] for p in products]

    PRODUCTS.write_text(json.dumps(products, indent=2, ensure_ascii=False), encoding="utf-8")
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    with LABELS.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=LABEL_COLS)
        w.writeheader()
        for p in products:
            if p["image_file"]:
                w.writerow({c: p.get(c) for c in LABEL_COLS})

    ok = sum(1 for p in products if p["image_file"])
    print("\n%d/%d images -> %s/" % (ok, len(products), IMAGES.relative_to(ROOT)))
    print("metadata -> %s (%d total)" % (PRODUCTS.relative_to(ROOT), len(products)))
    print("labels   -> %s" % LABELS.relative_to(ROOT))
    if ok < len(products):
        print("Some images missing; re-run to retry just those.")


def build(rows):
    """Fresh build: overwrites the catalog with exactly `rows`."""
    products, _ = _fetch_and_build_records(rows)
    _write_catalog(products)


def build_append(rows):
    """Fetches `rows` and appends them to whatever's already in data/clothing/, deduping by
    article_id (existing entries win, matching the "already fetched" exclusion upstream)."""
    existing = json.loads(PRODUCTS.read_text(encoding="utf-8")) if PRODUCTS.exists() else []
    existing_ids = {p["article_id"] for p in existing}

    new_products, _ = _fetch_and_build_records(rows)
    added = [p for p in new_products if p["article_id"] not in existing_ids]

    _write_catalog(existing + added)
    print("added %d new product(s) on top of %d existing" % (len(added), len(existing)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-n", type=int, default=30, help="how many images (default 30); overwrites the catalog")
    ap.add_argument("--manifest", action="store_true",
                    help="rebuild the exact same set from the committed manifest")
    ap.add_argument("--add", type=int, metavar="N",
                    help="ADD N new products on top of the existing catalog, split evenly "
                         "across product groups, excluding ids already in the manifest")
    args = ap.parse_args()
    if sum([args.manifest, args.add is not None]) > 1:
        sys.exit("--manifest and --add are mutually exclusive")

    preflight()
    rows = load_articles()

    if args.manifest:
        if not MANIFEST.exists():
            sys.exit("No manifest at " + str(MANIFEST))
        wanted = set(json.loads(MANIFEST.read_text()))
        chosen = [r for r in rows if r["article_id"].zfill(10) in wanted]
        print("Rebuilding %d images from manifest" % len(chosen))
        build(chosen)
    elif args.add is not None:
        existing_ids = set(json.loads(MANIFEST.read_text())) if MANIFEST.exists() else set()
        chosen = sample_articles_even(rows, args.add, exclude_ids=existing_ids)
        if len(chosen) < args.add:
            print("! only found %d/%d new products (some groups may be exhausted)"
                  % (len(chosen), args.add), file=sys.stderr)
        print("Adding %d new products (excluding %d already in catalog)" % (len(chosen), len(existing_ids)))
        build_append(chosen)
    else:
        chosen = sample_articles(rows, args.n)
        print("Sampled %d products" % len(chosen))
        build(chosen)


if __name__ == "__main__":
    main()
