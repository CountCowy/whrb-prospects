"""Stage T7 — Massachusetts Veterinary Medical Association Find-a-Vet.

Plan §9.4 — trade association. Tags: ``sector:medical,
operating_model:service_provider``.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "mvma_vets"

# Verified live 2026-05-01: ``/find-a-vet`` (the original guess) returns
# 404; the real public-facing locator is ``/find-a-veterinarian-directory/``.
LIVE_URL = "https://www.massvet.org/find-a-veterinarian-directory/"


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for clinic in soup.select("article.vet, .clinic-card, .vet-card"):
        name_el = clinic.select_one(".clinic-name") or clinic.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = clinic.select_one(".clinic-zip") or clinic.select_one(".zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        if zip_code and not common.in_signal_zone(zip_code):
            continue
        phone_el = clinic.select_one(".clinic-phone") or clinic.select_one(".phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = clinic.select_one("a.clinic-link") or clinic.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="medical/veterinary",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="B",
                sector="medical",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="mvma_vets: MVMA member",
            )
        )
    # Fallback: per-source CSS selectors are speculative pre-live-validation
    # (sandbox couldn't reach massvet.org at plant time). Generic ZIP-pivot
    # parser kicks in if the selectors above match nothing on real HTML.
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="medical/veterinary",
            tier="B",
            sector="medical",
            operating_model="service_provider",
            cadence="year_round",
            pipeline_notes="mvma_vets: MVMA member",
        )
    return common.cap_rows(rows, cap=300)


def run_all() -> list[dict]:
    # 1. Fixture path (offline / regression).
    html = common.read_fixture(SOURCE_KEY, "vets", ext="html")
    if html is not None:
        return _emit_from_html(html)
    if common.offline_enabled():
        return []

    # 2. Cheap HTTP fetch — works when the directory is rendered server-side.
    rows: list[dict] = []
    try:
        html = common.http_get(LIVE_URL)
        if html:
            rows = _emit_from_html(html)
    except Exception:
        rows = []

    # 3. Playwright fallback for JS-rendered listings (Noviams, etc.). MVMA
    # is on Noviams; the static body is an empty template until JS hydrates
    # the directory list, so this branch is the one that yields prospects in
    # production.
    if not rows:
        rendered = common.fetch_html_via_playwright(LIVE_URL)
        if rendered:
            rows = _emit_from_html(rendered)
    return rows
