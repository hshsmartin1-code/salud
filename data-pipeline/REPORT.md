# Food catalog pipeline: report

Built 2026-11-14/15 with `python -I -X utf8 data-pipeline/build_foods.py` (`--offline` rebuilds from the raw caches). Uses only the standard library plus `requests`.

## Outputs (`public/data/`)
- `foods-usda.json`: pho-catalog-foods, 13,648 rows, 4.73 MB (under the 9 MB budget, so not reduced)
- `foods-off-co.json`: pho-catalog-foods, 641 rows, 0.21 MB
- `catalog-manifest.json`: lists foods-usda, foods-off-co and exercises (873)

## Sources

### USDA FoodData Central (CC0 1.0)
Index: https://fdc.nal.usda.gov/download-datasets. Downloaded 2026-11-14.
- **Foundation:** https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-10-29.zip. The JSON release is used because the 2026-10-29 CSV zip has no food, food_nutrient or food_portion tables.
- **SR Legacy:** https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
- **FNDDS 2021-2023:** https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_survey_food_csv_2024-10-31.zip
- **datasetVersion:** "Foundation Foods 2026-10-29 (JSON); SR Legacy 2018-04 (CSV); FNDDS 2021-2023 / Survey Foods 2024-10-31 (CSV)"

### Open Food Facts (ODbL 1.0 / DbCL 1.0)
- **Endpoint:** `https://world.openfoodfacts.org/api/v2/search?countries_tags_en=colombia&page_size=100&page=N&fields=...`
- **Request policy:**
  - Generic User-Agent `salud-pwa/1.0 (personal non-commercial nutrition app)`.
  - At least 6.6 s between requests, with backoff on 429/5xx responses.
  - Pages are cached in `raw/off/page_N.json`.
- **Snapshot of 2026-11-14:** pages 1-10, which is 1,000 of 10,092 products in popularity order.
  - From page 11 on, OFF answers HTTP 401 "not available to anonymous users".
  - The limit is respected, not worked around, and it is recorded in `raw/off/fetch_stats.json`.

## Counts and dropped rows

| Source | Kept | Notes |
|---|---|---|
| usda_foundation | 424 / 424 | 10 rows with negative carbs-by-difference: the value is set to null and flagged `carbs_negative_nulled`; the rows are kept |
| usda_sr | 7,793 / 7,793 | |
| usda_fndds | 5,431 / 5,432 | 1 row had no nutrients |
| off | 641 / 1,000 | Dropped: no energy 237, no name 113 (empty or barcode only), macros over 105 g 8, kcal over 950 1, negative values 0, duplicate barcodes 0 |

**USDA**
- Flags: `kcal_atwater_specific` 200, `kcal_atwater_general` 79, `fat_nlea` 8, `folate_dfe` 4, `curated_es` 504.
- Kinds:
  - SR: raw 1,388, cooked 2,151, generic 4,254.
  - Foundation: raw 165, cooked 17, generic 242.
  - FNDDS: prepared 5,431.
- 50 USDA rows have a null kcal; they are kept.
- 13,218 rows have Spanish portion labels (at most 6 per food; the gram weight comes from the source portion).

**OFF**
- Flags: `atwater_mismatch` 28, `kj_inconsistent_nulled` 28, `kcal_from_kj` 1, `sodium_from_salt` 0.
- 61 rows use a 100 ml basis.

## Verification
- **Nutrient ids:** every mapped FDC nutrient id was checked by name and unit against that dataset's `nutrient.csv`. SR 33/33, FNDDS 33/33. Foundation has 31 present; 1190 and 1235 do not exist there.
- **FNDDS id format:** `food_nutrient.nutrient_id` holds nutrient numbers, not ids. The builder detects this and maps them through `nutrient.csv`.
- **Fields FNDDS lacks:** kJ, trans fat and added sugars stay null. `carbsAvail` is always null.
- **OFF units:** minerals and vitamins in the `*_100g` fields are in grams (checked on real products). They are converted to mg and µg.

## Spanish layer
- **`es_curated.csv`:** 504 verified mappings (SR 493, FNDDS 10, Foundation 1).
  - Columns: `fdc_id`, `source`, `name_es`, `synonyms`, `fdc_description`.
  - `fdc_description` lets the validator check each mapping.
- **`es_terms.csv`:** 394 term rows (392 unique).
- **Synonyms:**
  - Built from the curated synonyms, the name tokens, and translated description phrases of up to 3 words.
  - They are lowercase, accent-free, with stopwords removed.
  - 13,070 rows have synonyms.
- **Categories:** all 28 SR/Foundation categories and all 172 WWEIA categories are translated.
- **Skipped, because USDA has no truthful match:** panela, tomate de árbol, arracacha, pandebono, Colombian buñuelo (USDA's "buñuelos" are fried yeast bread), masarepa and papa criolla.

## Validation
| File | Rows | Checks | Atwater within 25% |
|---|---|---|---|
| `foods-off-co.json` | 641 | ids unique; nutrient arrays OK; 0 rows with macros over 105 g | 590 / 618 = 95.47% |
| `foods-usda.json` | 13,648 | ids unique; nutrient arrays OK; 0 rows with macros over 105 g | 13,308 / 13,588 = 97.94% |

**Golden kcal per 100 g (all within ±3%):**

| Food | kcal |
|---|---|
| Chicken breast, roasted | 165 |
| White long-grain rice, cooked | 130 |
| Whole egg, raw | 143 |
| Banana, raw | 89 |
| Whole milk, 3.25% | 61 |

All 504 curated rows verified. **VALIDATION PASSED.**

## Known limitations
- **OFF coverage:** 1,000 of 10,092 products, because of the anonymous-access limit. A full snapshot needs an OFF account or the bulk export.
- **US products:** USDA foods are US products. Curated names put the US cut or variety in parentheses where it differs.
- **Search on non-curated rows:** these have `nameEs = null`, so search relies on literal token synonyms.
- **kind:** follows word rules, so raw dry goods count as raw.
- **FNDDS portions:** include "Cantidad no especificada" and "Cantidad de referencia (...)" with English details.

## Private table (not published)
`tcac2015.py` turns the ICBF TCAC 2015 PDF into `../../private-data/tcac2015.json`, which is outside this repository. It refuses to write inside `app/`, and the script contains no table data. Each person imports the file on their own device, in Respaldo → Importar tabla ICBF.
