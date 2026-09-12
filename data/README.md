# data/

30 product images + metadata sampled from the H&M Personalized Fashion
Recommendations Kaggle competition.

## Layout

| Path | Committed? | What |
|---|---|---|
| `catalog/manifest.json` | yes | The chosen `article_id`s, for reproducibility |
| `catalog/products.json` | yes | Full metadata per image |
| `catalog/labels.csv` | yes | Flat `image_file` -> label table for training |
| `images/*.jpg` | yes | The 30 images, 11MB |
| `raw/articles.csv` | **no** | Source metadata, ~36MB, rebuild from Kaggle |

## Getting the data

```bash
pip install kaggle
python scripts/fetch_hm_sample.py
```

Downloads ~40MB and takes about a minute -- not the 35GB full competition.

- `--manifest` rebuilds the exact same set (use this so everyone on the team
  trains on identical images).
- `-n 100` grabs more; the sample stays spread across product groups.

## Licensing

Images are sourced from the H&M Personalized Fashion Recommendations Kaggle
competition and remain the property of H&M. They are included here for
non-commercial hackathon use only. The competition rules restrict this data
to competition / academic / non-commercial use -- review them before reusing
this repo for anything else:
https://www.kaggle.com/competitions/h-and-m-personalized-fashion-recommendations/rules

`catalog/manifest.json` + `scripts/fetch_hm_sample.py` reproduce the exact
same set from any Kaggle account, so the images can be dropped from version
control later if redistribution becomes a concern.

## Notes

- Images are roughly 1166x1750 JPEG on a white background, one garment each.
  Resize in your training pipeline; they are not pre-normalised.
- Every metadata value is a real H&M field copied from `articles.csv`.
  Nothing here is synthesised.
- There is no price. `articles.csv` has no price column, and the prices in
  `transactions_train.csv` are anonymised and rescaled rather than dollars.
- Useful label columns: `product_type_name` (~130 classes, fine-grained),
  `product_group_name` (~19, coarse), `garment_group_name` (~21),
  `colour_group_name` (~50). `detail_desc` is free text.
- 30 images is small for training from scratch -- it suits fine-tuning or
  few-shot work. Raise `-n` if you need more.
