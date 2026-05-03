#!/usr/bin/env python3
"""Plant ad_orders fixtures for the integrity matrix.

Inserts six fixtures covering the lifecycle gates:

  AOF 0001  draft (not produced, not invoiced, not paid)
  AOF 0002  produced (ad_produced=true)
  AOF 0003  invoiced (invoice_sent_at set; is_paid=false)
  AOF 0004  paid (is_paid=true via UPDATE so we audit the transition)
  AOF 0005  closed (commission_paid=true via stepwise UPDATE)
  AOF 0006  archived (archived_at set)

Each fixture's ``notes`` starts with ``ad_orders fixture`` so the
cleanup script can find them belt-and-suspenders even if the snapshot
file is lost. Idempotent: refuses to re-run while the snapshot exists.

Usage:
    .venv/bin/python scripts/ad_orders_plant.py
    .venv/bin/python scripts/ad_orders_plant.py --reset   # cleanup + replant
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
WHRB = HERE.parent
sys.path.insert(0, str(WHRB))
load_dotenv(WHRB / ".env")

SNAPSHOT_PATH = WHRB / "cache" / "ad_orders_snapshot.json"
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

# Marker prefix on the notes column so cleanup can sweep without the snapshot.
MARKER = "ad_orders fixture"


def _client():
    if not (SUPABASE_URL and SERVICE_KEY):
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.", file=sys.stderr)
        sys.exit(2)
    return create_client(SUPABASE_URL, SERVICE_KEY)


def _pick_admin(sb) -> str:
    """Return the id of any admin profile.

    The test admin (kingyareh@gmail.com) is seeded in dev; production should
    have at least one admin too.
    """
    res = sb.table("profiles").select("id").eq("role", "admin").limit(1).execute()
    rows = res.data or []
    if not rows:
        print("ERROR: no admin profile found; cannot plant ad_orders fixtures.", file=sys.stderr)
        sys.exit(2)
    return rows[0]["id"]


def _base(promo_id: str, company: str, days_offset: int, total: str) -> dict:
    start = dt.date(2025, 9, 1) + dt.timedelta(days=days_offset)
    end = start + dt.timedelta(days=7)
    return {
        "promo_id": promo_id,
        "company_name": f"{MARKER}: {company}",
        "package_doc_url": "https://docs.google.com/document/d/test-fixture",
        "is_nonprofit_rate": True,
        "discount_pct": "15",
        "payment_contact_name": "Fixture Contact",
        "payment_contact_email": "fixture@example.com",
        "campaign_start": start.isoformat(),
        "campaign_end": end.isoformat(),
        "total_amount": total,
        "commission_pct": "15",
        "notes": f"{MARKER}: {promo_id} — {company}",
    }


def _plant(sb, admin_id: str) -> list[dict]:
    """Insert six fixtures and return the snapshot rows."""
    snapshot: list[dict] = []

    # --- AOF 0001: draft -----------------------------------------------------
    f1 = _base("AOF 0001", "draft", 0, "500.00")
    f1["salesperson_id"] = admin_id
    f1["created_by"] = admin_id
    r = sb.table("ad_orders").insert(f1).execute()
    snapshot.append({"promo_id": f1["promo_id"], "id": r.data[0]["id"]})

    # --- AOF 0002: produced --------------------------------------------------
    f2 = _base("AOF 0002", "produced", 5, "750.00")
    f2["salesperson_id"] = admin_id
    f2["se_engineer_id"] = admin_id
    f2["created_by"] = admin_id
    f2["ad_produced"] = True
    f2["ad_produced_at"] = dt.datetime.now(dt.UTC).isoformat()
    r = sb.table("ad_orders").insert(f2).execute()
    snapshot.append({"promo_id": f2["promo_id"], "id": r.data[0]["id"]})

    # --- AOF 0003: invoiced --------------------------------------------------
    f3 = _base("AOF 0003", "invoiced", 10, "300.00")
    f3["salesperson_id"] = admin_id
    f3["created_by"] = admin_id
    f3["ad_produced"] = True
    f3["ad_produced_at"] = dt.datetime.now(dt.UTC).isoformat()
    f3["invoice_number"] = "INV-AOF-0003"
    f3["invoice_sent_at"] = (dt.date(2025, 9, 11)).isoformat()
    r = sb.table("ad_orders").insert(f3).execute()
    snapshot.append({"promo_id": f3["promo_id"], "id": r.data[0]["id"]})

    # --- AOF 0004: paid (insert false then UPDATE to true to audit) ---------
    f4 = _base("AOF 0004", "paid", 15, "250.00")
    f4["salesperson_id"] = admin_id
    f4["created_by"] = admin_id
    f4["ad_produced"] = True
    f4["ad_produced_at"] = dt.datetime.now(dt.UTC).isoformat()
    f4["invoice_number"] = "INV-AOF-0004"
    f4["invoice_sent_at"] = (dt.date(2025, 9, 17)).isoformat()
    r = sb.table("ad_orders").insert(f4).execute()
    f4_id = r.data[0]["id"]
    # Transition to paid via UPDATE so the audit trigger fires.
    sb.table("ad_orders").update({
        "is_paid": True,
        "paid_at": dt.datetime.now(dt.UTC).isoformat(),
        "client_check_number": "CHK-4001",
    }).eq("id", f4_id).execute()
    snapshot.append({"promo_id": f4["promo_id"], "id": f4_id})

    # --- AOF 0005: closed (stepwise: paid then commission_paid) -------------
    f5 = _base("AOF 0005", "closed", 20, "1000.00")
    f5["salesperson_id"] = admin_id
    f5["created_by"] = admin_id
    f5["ad_produced"] = True
    f5["ad_produced_at"] = dt.datetime.now(dt.UTC).isoformat()
    f5["invoice_number"] = "INV-AOF-0005"
    f5["invoice_sent_at"] = (dt.date(2025, 9, 22)).isoformat()
    r = sb.table("ad_orders").insert(f5).execute()
    f5_id = r.data[0]["id"]
    sb.table("ad_orders").update({
        "is_paid": True,
        "paid_at": dt.datetime.now(dt.UTC).isoformat(),
        "client_check_number": "CHK-5001",
    }).eq("id", f5_id).execute()
    sb.table("ad_orders").update({
        "commission_paid": True,
        "commission_paid_at": dt.datetime.now(dt.UTC).isoformat(),
    }).eq("id", f5_id).execute()
    snapshot.append({"promo_id": f5["promo_id"], "id": f5_id})

    # --- AOF 0006: archived --------------------------------------------------
    f6 = _base("AOF 0006", "archived", 25, "400.00")
    f6["salesperson_id"] = admin_id
    f6["created_by"] = admin_id
    r = sb.table("ad_orders").insert(f6).execute()
    f6_id = r.data[0]["id"]
    sb.table("ad_orders").update({
        "archived_at": dt.datetime.now(dt.UTC).isoformat(),
        "archived_by": admin_id,
    }).eq("id", f6_id).execute()
    snapshot.append({"promo_id": f6["promo_id"], "id": f6_id})

    return snapshot


def _cleanup_first(sb) -> None:
    """Delete any leftover fixture rows + amendments + audit events."""
    # Amendments first (FK restrict on ad_orders).
    sb.table("ad_order_amendments").delete().like("reason", f"{MARKER}%").execute()
    # Then ad_orders rows themselves. Service-role bypasses the no-delete RLS.
    sb.table("ad_orders").delete().like("notes", f"{MARKER}%").execute()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true",
                    help="Cleanup any existing fixtures and snapshot, then plant fresh.")
    args = ap.parse_args()

    sb = _client()

    if args.reset:
        _cleanup_first(sb)
        if SNAPSHOT_PATH.exists():
            SNAPSHOT_PATH.unlink()

    if SNAPSHOT_PATH.exists():
        print(f"Snapshot already present at {SNAPSHOT_PATH}. Use --reset to replant.")
        return 0

    admin_id = _pick_admin(sb)
    snapshot = _plant(sb, admin_id)

    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps({
        "started": dt.datetime.now(dt.UTC).isoformat(),
        "admin_id": admin_id,
        "fixtures": snapshot,
    }, indent=2))
    print(f"OK planted {len(snapshot)} ad_orders fixtures. Snapshot: {SNAPSHOT_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
