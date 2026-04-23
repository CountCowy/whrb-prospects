# Terminology

This file documents the terminology decisions made in Stage T1 per
[gleaming-dawn §1.3 #14](../.claude/plans/users-countcowy-downloads-media-kit-202-gleaming-dawn.md)
and the surviving allowlist of `underwri*` strings after the T1 sweep.

The 2025 / 2026 WHRB media kit (committed at
[whrb-web/public/media-kit-2026.pdf](whrb-web/public/media-kit-2026.pdf)) is
the source-of-truth for buyer-facing language. The sweep is enforced by
[bin/terminology_audit.py](bin/terminology_audit.py).

---

## Buyer-noun convention

| Use | Don't use |
|------|-----------|
| **advertiser** / **sponsor** (the entity buying spots) | "underwriter" |
| **ads** / **advertising** (the offering) | (avoid except inside a quoted product name) |
| **spots** (30s / 60s broadcast unit) | (no synonym needed) |
| **flight** (a contiguous run of spots) | (preferred over "campaign" for radio) |

Avoid "daypart" in **rep-facing copy** — reference programs directly
(Classical, Jazz, Blues, Orgy Season, Met Opera, Hillbilly at Harvard,
Record Hospital, The Darker Side, etc.). The DB axis is named
`daypart_fit` for unambiguous developer-facing reference; the chip layer
strips the axis prefix when rendering for reps.

---

## Allowed surviving uses of `underwri*`

The grep is `(?i)underwri` across `whrb-web/` and `whrb-prospects/`. Every
remaining hit must appear here with a one-line rationale. **If you add a
new `underwri*` string, add a row.**

### Product / FCC framework noun (allowed)

| File | Line | String | Rationale |
|------|-----:|--------|-----------|
| `whrb-prospects/CLAUDE.md` | 12 | "FCC-compliant underwriting announcements" | Legal-frame noun, accurate FCC term. CLAUDE.md is internal handoff doc, ICP rationale, not rep-facing UI. |
| `whrb-prospects/CLAUDE.md` | 56 | "WCRB/WGBH underwriting" | Process-noun reference to peer-station programs reps may have heard of. Internal doc. |
| `whrb-prospects/CLAUDE.md` | 60 | "FCC underwriting rules" | Legal-frame noun. Internal doc. |
| `whrb-web/app/(app)/media-kit/page.tsx` | 32 | "FCC underwriting framework" | Process-noun used in body copy that explains *why* we use the term "sponsor". Acceptable per §1.3 #14 — frame noun, not buyer noun. |
| `README.md` | 14 | "underwriting announcements" | Repo-root README's "Why this exists" block. FCC-frame noun. Stranger-friendly explanation of the legal regime. |
| `docs/GLOSSARY.md` | 156 | `**\`underwriting\`** — FCC framework noun.` | Glossary entry that *defines* the term and points readers at TERMINOLOGY.md. Self-referential by design. |

### Domain-data noun (allowed)

| File | Line | String | Rationale |
|------|-----:|--------|-----------|
| `whrb-prospects/sources/program_books.py` | 51 | `"underwritten by"` | Sponsor-context regex token used to filter PDF program-book noise. Pattern-matching, not user-facing copy. |

### Test fixture text (allowed)

| File | Line | String | Rationale |
|------|-----:|--------|-----------|
| `whrb-prospects/scripts/stage6_plant.py` | 61 | `"…combine two locations into one underwriting run."` | Synthetic rep note in Stage 6 fixture data. Process-noun usage by a rep talking about flight scheduling. Test-only, not shipped to prod UI. |
| `whrb-prospects/scripts/stage6_plant.py` | 62 | `"…coordinating with playbill copy for underwriting."` | Same as above. Process-noun. |

---

## Disallowed buyer-noun uses

Result of the T1 sweep: **zero** standalone `underwriter` / `underwriters`
strings exist anywhere in the repo. The disallowed-pattern grep
`(?i)\\bunderwriter\\b|\\bunderwriters\\b` returns no matches.

If a future PR introduces "underwriter" as a buyer noun (e.g. in chip
labels, button copy, page headings, table column headers, or admin UI
toasts), it will be caught by `bin/terminology_audit.py`. Replace with
**advertiser** or **sponsor** depending on context.

---

## Special-program phrasing

The media kit lists one product whose name is a fixed string and must not
be mutated:

- **Corporate Underwriting Philanthropy** — appears verbatim if/when a
  sales surface needs to reference the named flight package. As of T1
  this string does not appear in any code; it is allowlisted here for
  future use.

If "underwriting sponsorship" appears in special-program contexts (also
from the media kit), it is also acceptable as a fixed product-phrase.

---

## Daypart copy

The DB axis is `daypart_fit`. Six values:

- `classical`
- `jazz`
- `blues_hillbilly`
- `record_hospital`
- `darker_side`
- `sports_news`

In **rep-facing UI** (chips, filters, kanban, table cells), render
program-direct labels:

- `daypart_fit:classical` → "Classical"
- `daypart_fit:jazz` → "Jazz"
- `daypart_fit:blues_hillbilly` → "Blues / Hillbilly at Harvard"
- `daypart_fit:record_hospital` → "Record Hospital"
- `daypart_fit:darker_side` → "The Darker Side"
- `daypart_fit:sports_news` → "Sports / News"

(T3 ships the chip-label map; this section pre-locks the strings.)

---

## Maintenance

- Update this file whenever you add an `underwri*` string anywhere in the
  repo. The terminology audit script fails CI on any uncatalogued hit.
- Run `bin/terminology_audit.py --strict` before committing in any
  rep-facing UI file.
- The buyer-noun rule **does not apply** to commit messages, code review
  comments, or off-repo plan files.
