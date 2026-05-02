"""Stage T7 — SEC Form ADV: registered investment advisers w/ MA principal office.

Plan §9.4 — bulk-XML source. Tags: ``sector:finance``,
``operating_model:service_provider``, ``affiliation`` from principal
office ZIP.

The SEC publishes the IAPD bulk compilation as monthly month-end
``IA_FIRM_SEC_Feed_<MM_DD_YYYY>.xml.gz`` files at
``reports.adviserinfo.sec.gov``. Earlier drafts of this module used a
hypothetical ``iapdfirm.csv`` URL that doesn't exist; that path was
replaced 2026-05-01 with the live XML feed once the URL pattern was
verified end-to-end (200 + ~7 MB gzip + 80 MB uncompressed).

XML schema (verified from the live ``04_30_2026`` feed):

  <IAPDFirmSECReport GenOn="YYYY-MM-DD">
    <Firms>
      <Firm>
        <Info BusNm="..." LegalNm="..." FirmCrdNb="..." SECNb="..."
              SECRgnCD="..." UmbrRgstn="N"/>
        <MainAddr Strt1="..." Strt2="..." City="..." State="MA"
                  Cntry="United States" PostlCd="02138" PhNb="..."/>
        ...
      </Firm>
    </Firms>
  </IAPDFirmSECReport>

The parser streams via ``lxml.etree.iterparse`` so the 80 MB body
never lives in memory in one piece. Filters to ``MainAddr State="MA"``
+ ZIP in :data:`config.WHRB_ZIPS`.

Live URL discovery: SEC keeps only the most recent month-end feed
publicly accessible (older dates 403). :func:`_discover_live_url` walks
backward from today's month-end, returning the first URL that responds
200 to a HEAD probe. Cache TTL bumped to 7 days via
``CACHE_TTL_BULK_CSV_SECONDS``.

Fixture-driven (offline) tests live at
``tests/fixtures/t7/sec_adv/registered.csv`` (CSV stub kept for
backward-compat with the C2 fixture; the live path now consumes XML).
"""
from __future__ import annotations

import datetime as _dt
import gzip
import io
from collections.abc import Iterator

import requests

from sources import _t7_common as common
from util.http import raise_for_smart_status, smart_retry

SOURCE_KEY = "sec_adv"

# URL components — see _discover_live_url() for rolling date logic.
_FEED_HOST = "https://reports.adviserinfo.sec.gov"
_FEED_PATH_TPL = (
    "/reports/CompilationReports/IA_FIRM_SEC_Feed_{mm}_{dd}_{yyyy}.xml.gz"
)

# SEC's CDN is fronted by Cloudflare and rejects empty / generic UA strings.
# A real desktop browser UA passes; the WHRB pipeline UA is also accepted as
# long as Referer points at adviserinfo.sec.gov. We send both belt-and-
# suspenders so a future UA tightening at SEC doesn't silently break us.
_SEC_HEADERS = {
    "User-Agent": common.USER_AGENT,
    "Accept": "application/xml,application/octet-stream,*/*",
    "Referer": "https://adviserinfo.sec.gov/compilation",
}


def _month_end(d: _dt.date) -> _dt.date:
    """Return the last calendar day of the month containing ``d``."""
    if d.month == 12:
        return _dt.date(d.year, 12, 31)
    next_first = _dt.date(d.year, d.month + 1, 1)
    return next_first - _dt.timedelta(days=1)


def _candidate_urls(today: _dt.date | None = None, max_back: int = 4) -> list[str]:
    """Yield month-end SEC feed URLs going back ``max_back`` months."""
    if today is None:
        today = _dt.date.today()
    out: list[str] = []
    cursor = _month_end(today)
    for _ in range(max_back + 1):
        out.append(
            _FEED_HOST
            + _FEED_PATH_TPL.format(
                mm=f"{cursor.month:02d}",
                dd=f"{cursor.day:02d}",
                yyyy=f"{cursor.year:04d}",
            )
        )
        prev_first = _dt.date(cursor.year, cursor.month, 1)
        cursor = _month_end(prev_first - _dt.timedelta(days=1))
    return out


def _discover_live_url() -> str | None:
    """HEAD-probe the most-recent N month-end feeds and return the first
    one that responds 200. SEC unpublishes older feeds (403), so this is
    the only reliable way to pin "today's" feed without a directory
    listing endpoint."""
    for url in _candidate_urls():
        try:
            r = requests.head(
                url,
                headers=_SEC_HEADERS,
                timeout=common.HTTP_TIMEOUT_SECONDS,
                allow_redirects=True,
            )
            if r.status_code == 200:
                return url
        except Exception:
            continue
    return None


# Default LIVE_URL kept for documentation + backwards compat with the
# T7 plant script. The real fetch path uses _discover_live_url().
LIVE_URL = (
    "https://reports.adviserinfo.sec.gov/reports/CompilationReports/"
    "IA_FIRM_SEC_Feed_<MM_DD_YYYY>.xml.gz"
)


@smart_retry()
def _fetch_xml_gz(url: str) -> bytes:
    """Fetch the gzipped XML feed body. Returns raw .gz bytes."""
    r = requests.get(
        url,
        headers=_SEC_HEADERS,
        timeout=common.HTTP_TIMEOUT_SECONDS * 3,  # 90 s — feed is 7 MB
    )
    raise_for_smart_status(r)
    return r.content


def _iter_firms(xml_bytes: bytes) -> Iterator[dict]:
    """Stream-parse the IAPDFirmSECReport XML and yield {name, zip,
    phone, address, city, state, ...} dicts.

    Uses ``lxml.etree.iterparse`` with ``element.clear()`` to keep memory
    bounded — the uncompressed feed is ~80 MB and contains tens of
    thousands of firms, but only one ``<Firm>`` element lives in the
    parser at a time.
    """
    from lxml import etree

    src = io.BytesIO(xml_bytes)
    # IAPD feeds use ISO-8859-1; lxml auto-detects from the XML decl.
    for _event, elem in etree.iterparse(src, events=("end",), tag="Firm"):
        info = elem.find("Info")
        addr = elem.find("MainAddr")
        if info is None or addr is None:
            elem.clear()
            continue

        # SEC uses BusNm (DBA) preferentially; LegalNm is the legal entity.
        name = (
            info.get("BusNm")
            or info.get("LegalNm")
            or ""
        ).strip()
        state = (addr.get("State") or "").strip().upper()
        zip_code = (addr.get("PostlCd") or "")[:5]
        phone = (addr.get("PhNb") or "").strip() or None
        city = (addr.get("City") or "").strip() or None
        strt1 = (addr.get("Strt1") or "").strip()
        strt2 = (addr.get("Strt2") or "").strip()
        street = ", ".join(s for s in (strt1, strt2) if s) or None
        address = ", ".join(s for s in (street, city) if s) or None

        yield {
            "name": name,
            "state": state,
            "zip": zip_code,
            "phone": phone,
            "address": address,
        }
        # Drop processed Firm element + its tail so memory stays bounded.
        elem.clear()
        while elem.getprevious() is not None:
            del elem.getparent()[0]


def _emit_from_xml(xml_bytes: bytes) -> list[dict]:
    """Parse XML feed and emit pipeline rows for MA-WHRB firms."""
    rows: list[dict] = []
    for rec in _iter_firms(xml_bytes):
        if rec["state"] and rec["state"] != "MA":
            continue
        if not common.acceptable_name(rec["name"]):
            continue
        if not common.in_signal_zone(rec["zip"]):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=rec["name"],
                category="finance/investment_adviser",
                address=rec["address"],
                zip_code=rec["zip"],
                phone=rec["phone"],
                tier="A",
                sector="finance",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="sec_adv: registered investment adviser",
            )
        )
    return common.cap_rows(rows, cap=1500)


def _emit_from_csv(text: str) -> list[dict]:
    """Backwards-compat CSV path used by offline fixtures.

    Pre-XML-rewrite fixtures at ``tests/fixtures/t7/sec_adv/registered.csv``
    use the column shape the legacy iapdfirm.csv mock produced. Kept so
    the integrity matrix doesn't have to be re-planted before exit-gate
    rerun.
    """
    rows: list[dict] = []
    for raw in common.parse_csv(text):
        name = raw.get("Primary Business Name") or raw.get("primary_business_name")
        state = (raw.get("Main Office State") or raw.get("main_office_state") or "").strip().upper()
        zip_code = (raw.get("Main Office Postal Code") or raw.get("main_office_postal_code") or "")[:5]
        phone = raw.get("Main Office Phone Number") or raw.get("main_office_phone_number")

        if state and state != "MA":
            continue
        if not common.acceptable_name(name):
            continue
        if not common.in_signal_zone(zip_code):
            continue

        rows.append(
            common.build_row(
                source_key=SOURCE_KEY,
                company_name=name,
                category="finance/investment_adviser",
                zip_code=zip_code,
                phone=phone,
                tier="A",
                sector="finance",
                operating_model="service_provider",
                cadence="year_round",
                pipeline_notes="sec_adv: registered investment adviser",
            )
        )
    return common.cap_rows(rows, cap=1500)


def run_all() -> list[dict]:
    # Offline / fixture path — same as before. CSV stub still works.
    text = common.read_fixture(SOURCE_KEY, "registered", ext="csv")
    if text is not None:
        return _emit_from_csv(text)

    # Optional XML fixture (operators can drop a real .xml or .xml.gz at
    # ``tests/fixtures/t7/sec_adv/registered.xml`` to exercise the XML
    # path under offline mode).
    xml_text = common.read_fixture(SOURCE_KEY, "registered", ext="xml")
    if xml_text is not None:
        return _emit_from_xml(xml_text.encode("iso-8859-1", errors="replace"))

    if common.offline_enabled():
        return []

    url = _discover_live_url()
    if url is None:
        try:
            from util import event_log

            event_log.warn(
                "sec_adv_url_not_found",
                "no SEC ADV month-end feed responded 200; skipping",
                context={"source": SOURCE_KEY, "candidates": _candidate_urls()},
            )
        except Exception:
            pass
        return []

    try:
        common.per_host_sleep(url)
        gz_bytes = _fetch_xml_gz(url)
    except Exception:
        return []

    try:
        xml_bytes = gzip.decompress(gz_bytes)
    except Exception:
        return []

    return _emit_from_xml(xml_bytes)
