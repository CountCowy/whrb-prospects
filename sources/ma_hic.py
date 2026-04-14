"""MA Home Improvement Contractor registry — public CSV download.

Source: https://www.mass.gov/lists/home-improvement-contractor-registry
Place the downloaded file at data/hic_registry.csv.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

from config import WHRB_ZIPS

HIC_PATH = Path("data/hic_registry.csv")


def run_all() -> list[dict]:
    if not HIC_PATH.exists():
        print(f"[hic] {HIC_PATH} not found; download from mass.gov and retry")
        return []
    df = pd.read_csv(HIC_PATH, dtype=str).fillna("")
    # Column names vary across releases — normalize best-effort.
    cols = {c.lower(): c for c in df.columns}
    zip_col = next((cols[c] for c in cols if "zip" in c), None)
    name_col = next((cols[c] for c in cols if "business" in c or "company" in c), None)
    phone_col = next((cols[c] for c in cols if "phone" in c), None)
    addr_col = next((cols[c] for c in cols if "address" in c), None)
    if not (zip_col and name_col):
        print("[hic] could not identify required columns")
        return []
    df = df[df[zip_col].str[:5].isin(WHRB_ZIPS)]
    rows = [
        {
            "source": "ma_hic",
            "tier": "C",
            "company_name": r[name_col],
            "company_phone": r[phone_col] if phone_col else None,
            "address": r[addr_col] if addr_col else None,
            "zip": r[zip_col][:5],
            "category": "home_improvement_contractor",
        }
        for _, r in df.iterrows()
    ]
    print(f"[hic] {len(rows)} in-ZIP contractors")
    return rows
