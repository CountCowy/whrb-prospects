"""Stage T7 — Mass Save Heat Pump Installer Network (HPIN).

Plan §9.4 — informational tag emitter. Tags: ``sector:home_services,
cadence:seasonal_spring,seasonal_fall``. Also emits
``history:hpin_certified`` (T1 seed value) as an informational tag —
distinct from sponsor-history.

Naming note (corrected 2026-05-01): the acronym **HPIN** stands for
"Heat Pump Installer Network", not "Home Performance Installer Network"
as earlier drafts of this docstring claimed. Mass Save runs two adjacent
networks:

* **HPIN** — Heat Pump Installer Network → ``/residential/find-a-contractor/find-a-heat-pump-installer``
* **HPC**  — Home Performance Contractors → ``/residential/find-a-contractor/find-a-contractor-hpc``

We pin the HPIN URL because that's what the source key declares; the
``history:hpin_certified`` tag preserved its T1 vocabulary slug because
the meaning ("Mass Save HPIN participant") matches the corrected
expansion verbatim.
"""
from __future__ import annotations

from bs4 import BeautifulSoup

from sources import _t7_common as common

SOURCE_KEY = "mass_save_hpin"

# Verified live 2026-05-01. The original ``/contractor/hpin`` is 404
# (a guess). The real Mass Save HPIN finder lives under the residential
# customer journey: ``/residential/find-a-contractor/find-a-heat-pump-installer``.
LIVE_URL = (
    "https://www.masssave.com/residential/find-a-contractor/find-a-heat-pump-installer"
)


def _emit_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for member in soup.select("article.contractor, .hpin-card, .contractor-card"):
        name_el = member.select_one(".contractor-name") or member.select_one("h3")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not common.acceptable_name(name):
            continue
        zip_el = member.select_one(".zip") or member.select_one(".contractor-zip")
        zip_code = zip_el.get_text(strip=True)[:5] if zip_el else None
        if zip_code and not common.in_signal_zone(zip_code):
            continue
        phone_el = member.select_one(".phone") or member.select_one(".contractor-phone")
        phone = phone_el.get_text(strip=True) if phone_el else None
        link_el = member.select_one("a")
        website = link_el.get("href") if link_el else None

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="home_services/hpin",
                zip_code=zip_code,
                phone=phone,
                website=website,
                tier="C",
                sector="home_services",
                operating_model="service_provider",
                cadence=["seasonal_spring", "seasonal_fall"],
                history="hpin_certified",
                pipeline_notes="mass_save_hpin: HPIN-certified installer",
            )
        )
    if not rows:
        rows = common.emit_via_html_fallback(
            html,
            source_key=SOURCE_KEY,
            category="home_services/hpin",
            tier="C",
            sector="home_services",
            operating_model="service_provider",
            cadence=["seasonal_spring", "seasonal_fall"],
            history="hpin_certified",
            pipeline_notes="mass_save_hpin: HPIN-certified installer",
        )
    return common.cap_rows(rows, cap=400)


def run_all() -> list[dict]:
    html = common.read_fixture(SOURCE_KEY, "contractors", ext="html")
    if html is not None:
        return _emit_from_html(html)
    if common.offline_enabled():
        return []
    rows: list[dict] = []
    try:
        html = common.http_get(LIVE_URL)
        if html:
            rows = _emit_from_html(html)
    except Exception:
        rows = []
    if not rows:
        rendered = common.fetch_html_via_playwright(LIVE_URL)
        if rendered:
            rows = _emit_from_html(rendered)
    return rows
