# whrb-prospects

Boston-area ad sales prospect builder for **WHRB 95.3 FM** (Harvard Radio Broadcasting).

Pulls local business data from **free, public sources only**, enriches with decision-maker contact info, and exports a CSV of leads ready for outreach.

## Free-API-only constraint

Every paid service from the original plan has been swapped for a free equivalent:

| Original (paid) | Replacement (free) |
|---|---|
| Google Places API ($17 / 1k) | **OpenStreetMap Overpass API** — unlimited, no key, no billing |
| Apollo Pro ($79/mo) | **Apollo free tier** (100 credits/mo) + **Hunter.io free** (25/mo) + **direct website contact scraping** |
| NeverBounce / ZeroBounce | **`email-validator` + DNS MX lookup** (built-in `dnspython`) |
| LinkedIn Sales Navigator | Apollo free + LinkedIn public profile scrape via their OG tags (rate-limited, best-effort) |

Yelp Fusion stays (free tier, 500 calls/day, no billing required).

## Data sources

- **OpenStreetMap Overpass** — local businesses by category + bbox
- **Yelp Fusion API** — restaurants, personal services
- **MA Home Improvement Contractor registry** — CSV download, ~5k Tier C leads
- **Cambridge / Somerville / Boston open data portals** — business licenses (Socrata API, free)
- **MA Secretary of State corporate search** — officer / registered agent names (Playwright scrape)
- **Harvard Square Business Association, Cambridge/Somerville Chambers, ArtsBoston** — HTML member lists
- **BBB Eastern MA** — accredited businesses (Playwright)
- **Boston Magazine "Best of Boston"** — annual winners (HTML)
- **BSO / A.R.T. / Huntington program book PDFs** — existing arts sponsors (`pdfplumber`)
- **Company websites themselves** — `/contact`, `/about`, `/team` pages scraped for emails + names (primary free enrichment path)

## Output

`output/whrb_prospects.csv` with columns:

```
company_name, website, company_phone, company_email, sales_email,
contact_name, contact_title, contact_email, contact_phone, contact_linkedin,
address, zip, tier, category, rating, review_count,
source, priority_score, seasonality_window, notes
```

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env   # add free API keys (Yelp, Apollo free, Hunter free)
python pipeline.py
```

## Layout

```
whrb-prospects/
├── config.py              # ZIPs, categories, thresholds
├── pipeline.py            # orchestrator
├── sources/
│   ├── osm_overpass.py
│   ├── yelp_fusion.py
│   ├── ma_hic.py
│   ├── city_licenses.py
│   ├── ma_sos.py
│   ├── chambers.py
│   ├── bbb.py
│   ├── best_of_boston.py
│   └── program_books.py
├── enrich/
│   ├── contact_scraper.py # website /contact page email+name extractor
│   ├── apollo_free.py     # Apollo free tier (100/mo)
│   ├── hunter_free.py     # Hunter.io free tier (25/mo)
│   ├── email_validate.py  # syntax + MX check
│   └── dedupe.py
├── data/                  # downloaded raw files (HIC csv, program PDFs)
├── cache/                 # SQLite/parquet cache per source
└── output/
    └── whrb_prospects.csv
```

## Cost

**$0.** Every API used has a no-billing free tier or is fully public.

Trade-offs vs. paid plan:
- OSM coverage is ~70% of Google Places for chain businesses but ~95% for the independents we actually want.
- Apollo free (100/mo) + Hunter free (25/mo) caps enrichment at ~125 auto-contacts/month. The website scraper closes most of the gap at zero cost.
- Expect ~30% of rows to end up with a named contact, ~70% with at least a company email — vs. ~60% / ~90% on the paid plan.
