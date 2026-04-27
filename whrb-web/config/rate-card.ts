/**
 * Media-kit single source of truth — Stage T4.
 *
 * Every value rendered on `/media-kit` (or referenced anywhere else) lives
 * here. Annual rate refresh = edit this file + drop a new
 * `media-kit-<year>.pdf` into `whrb-web/public/` + bump
 * `MEDIA_KIT_PDF_FILENAME` + insert a `changelog_entries` row in the same
 * PR. The CI gate `scripts/ci_require_changelog.sh` enforces the changelog
 * step on PRs labeled `rep-ui-change`.
 *
 * Values verified against the 2025 print media kit (committed at
 * `whrb-web/public/media-kit-2026.pdf` per the annual file-naming
 * convention introduced in T1).
 */

export const MEDIA_KIT_PDF_FILENAME = 'media-kit-2026.pdf';

export const MEDIA_KIT_STATS = {
  fmListeners: '4,000,000+',
  monthlySiteVisits: '10,000+',
  printGuideSubscribers: '4,500+',
  lastUpdated: '2025-09-01',
} as const;

export type RateCardRegular = {
  program: string;
  airTimes: readonly string[];
  thirty: number;
  sixty: number;
  /** Daypart slugs the program maps to. Used by the "See matching prospects"
   *  cross-link to filter `/prospects?daypart=<slug>`. */
  dayparts: readonly string[];
};

export type RateCardSpecial = {
  name: string;
  price: number;
  unit: 'spot';
  season?: string;
  /** Optional cross-link target for the row's CTA. If omitted, the row
   *  renders a non-linkable price chip. */
  href?: string;
};

export const RATE_CARD = {
  regular: [
    {
      program: 'Classical',
      airTimes: ['M-F 1pm-10pm', 'Sat 1pm-9pm', 'Sun 2pm-12am'],
      thirty: 60,
      sixty: 75,
      dayparts: ['daypart_classical'],
    },
    {
      program: 'Jazz',
      airTimes: ['M-F 5am-1pm'],
      thirty: 75,
      sixty: 90,
      dayparts: ['daypart_jazz'],
    },
    {
      program: 'Blues',
      airTimes: ['Sat 5am-1pm', 'Sun 7am-11am'],
      thirty: 70,
      sixty: 85,
      dayparts: ['daypart_blues_hillbilly'],
    },
    {
      program: 'Other (Record Hospital / The Darker Side)',
      airTimes: ['Late night'],
      thirty: 30,
      sixty: 45,
      dayparts: ['daypart_rock_indie', 'daypart_rnb'],
    },
  ] as readonly RateCardRegular[],

  special: [
    {
      name: 'Metropolitan Opera Broadcast Adjacent',
      price: 150,
      unit: 'spot',
      season: 'Dec-May',
      href: '/guide#seasonal-programs',
    },
    {
      name: 'Metropolitan Opera Broadcast Intermission',
      price: 180,
      unit: 'spot',
      season: 'Dec-May',
      href: '/guide#seasonal-programs',
    },
    {
      name: 'Hillbilly at Harvard Intermission',
      price: 125,
      unit: 'spot',
      href: '/guide#seasonal-programs',
    },
    {
      name: 'Sunday Night at the Opera (SNATO)',
      price: 100,
      unit: 'spot',
      href: '/guide#seasonal-programs',
    },
    {
      name: 'Sports In-Game Mentions',
      price: 20,
      unit: 'spot',
      href: '/prospects?affiliation=harvard_affiliated',
    },
  ] as readonly RateCardSpecial[],

  print: {
    pricePerGuide: 200,
    guidesPerYear: 4,
    subscribers: 5500,
    dimensions: '5.3 in x 4 in',
    color: 'black-and-white',
  },

  web: {
    banner: { dimensions: '640 x 100 px', pricePerMonth: 200 },
    sidebar: {
      dimensions: '480 x 280 px or 480 x 360 px',
      pricePerMonth: 200,
    },
  },
} as const;

export type FeaturedClient = {
  name: string;
  logo: string;
  fallbackUrl: string;
};

export const FEATURED_CLIENTS = [
  {
    name: 'Celebrity Series of Boston',
    logo: '/media-kit/clients/celebrity-series.png',
    fallbackUrl: 'https://www.celebrityseries.org',
  },
  {
    name: 'Boston Symphony Orchestra',
    logo: '/media-kit/clients/bso.png',
    fallbackUrl: 'https://www.bso.org',
  },
  {
    name: 'Boston Philharmonic / Benjamin Zander',
    logo: '/media-kit/clients/boston-philharmonic.png',
    fallbackUrl: 'https://bostonphil.org',
  },
  {
    name: 'New England Philharmonic',
    logo: '/media-kit/clients/nep.png',
    fallbackUrl: 'https://nephilharmonic.org',
  },
  {
    name: 'Boston Ballet',
    logo: '/media-kit/clients/boston-ballet.png',
    fallbackUrl: 'https://www.bostonballet.org',
  },
  {
    name: 'The Sudbury Savoyards',
    logo: '/media-kit/clients/sudbury-savoyards.png',
    fallbackUrl: 'https://sudburysavoyards.org',
  },
  {
    name: 'Wine & Cheese Cask',
    logo: '/media-kit/clients/wine-cheese-cask.png',
    fallbackUrl: 'https://www.wineandcheesecask.com',
  },
  {
    name: 'The Coop',
    logo: '/media-kit/clients/coop.png',
    fallbackUrl: 'https://www.thecoop.com',
  },
  {
    name: 'Boston Early Music Festival',
    logo: '/media-kit/clients/bemf.png',
    fallbackUrl: 'https://bemf.org',
  },
] as const satisfies readonly FeaturedClient[];

export type SignalRing = 'local' | 'distant' | 'fringe';

export type SignalCity = {
  name: string;
  ring: SignalRing;
  /** SVG x in 0-800 viewBox space. Center of map is roughly (400,250). */
  x: number;
  /** SVG y in 0-500 viewBox space. */
  y: number;
  /** Filter slug used on `/prospects?affiliation=<slug>`. */
  affiliationFilter: string;
};

/**
 * City dot positions for the SignalMap SVG. Coordinates are hand-tuned
 * approximations of the print media kit's signal-area inset (Cambridge MA at
 * the center; reaches Salem in the north and Plymouth in the south on the
 * Distant ring; Manchester NH and Hartford CT only on the Fringe ring).
 *
 * Three rings:
 *   - **Local** = `WHRB_ZIPS` core + immediate suburbs.
 *   - **Distant** = T1 widening (Salem, Lynn, Medford, etc.).
 *   - **Fringe** = `new_england_regional` affiliation only — does NOT
 *     widen `WHRB_ZIPS` per epic plan §1.3 #19.
 */
export const SIGNAL_CITIES: readonly SignalCity[] = [
  // Local ring
  { name: 'Cambridge', ring: 'local', x: 400, y: 250, affiliationFilter: 'cambridge_based' },
  { name: 'Boston', ring: 'local', x: 430, y: 280, affiliationFilter: 'boston_based' },
  { name: 'Brookline', ring: 'local', x: 380, y: 300, affiliationFilter: 'greater_boston' },
  { name: 'Somerville', ring: 'local', x: 410, y: 220, affiliationFilter: 'greater_boston' },
  { name: 'Watertown', ring: 'local', x: 350, y: 250, affiliationFilter: 'greater_boston' },
  // Distant ring
  { name: 'Salem', ring: 'distant', x: 540, y: 130, affiliationFilter: 'greater_boston' },
  { name: 'Lynn', ring: 'distant', x: 510, y: 175, affiliationFilter: 'greater_boston' },
  { name: 'Medford', ring: 'distant', x: 420, y: 195, affiliationFilter: 'greater_boston' },
  { name: 'Newton', ring: 'distant', x: 320, y: 280, affiliationFilter: 'greater_boston' },
  { name: 'Quincy', ring: 'distant', x: 470, y: 360, affiliationFilter: 'greater_boston' },
  { name: 'Worcester', ring: 'distant', x: 130, y: 295, affiliationFilter: 'new_england_regional' },
  { name: 'Plymouth', ring: 'distant', x: 605, y: 410, affiliationFilter: 'new_england_regional' },
  // Fringe ring
  { name: 'Manchester NH', ring: 'fringe', x: 380, y: 60, affiliationFilter: 'new_england_regional' },
  { name: 'Hartford CT', ring: 'fringe', x: 110, y: 425, affiliationFilter: 'new_england_regional' },
  { name: 'Providence RI', ring: 'fringe', x: 350, y: 460, affiliationFilter: 'new_england_regional' },
];

export type ProgramCard = {
  title: string;
  airtimes: string;
  blurb: string;
  /** `/prospects?...` link for the "See matching prospects" CTA. */
  href: string;
};

export const PROGRAM_CARDS: readonly ProgramCard[] = [
  {
    title: 'Classical Music',
    airtimes: 'M-F 1pm-10pm · Sat 1pm-9pm · Sun 2pm-12am',
    blurb:
      'WHRB’s flagship daypart. Orchestral, chamber, baroque, early music, and contemporary composition for the 45+ donor-class audience.',
    href: '/prospects?daypart=classical',
  },
  {
    title: 'Jazz',
    airtimes: 'M-F 5am-1pm',
    blurb:
      'Morning drive-time jazz for educated, culturally engaged listeners. Strong overlap with classical sponsors.',
    href: '/prospects?daypart=jazz',
  },
  {
    title: 'Blues',
    airtimes: 'Sat 5am-1pm · Sun 7am-11am',
    blurb:
      '"Blues Hangover" + adjacent weekend programming. Loyal weekend audience.',
    href: '/prospects?daypart=blues_hillbilly',
  },
  {
    title: 'Hillbilly at Harvard',
    airtimes: 'Sat 9am-1pm',
    blurb:
      'Old-time country, bluegrass, and traditional. Boston’s longest-running country show; intermission spots available.',
    href: '/prospects?daypart=blues_hillbilly',
  },
  {
    title: 'Record Hospital',
    airtimes: 'Late night, M-F',
    blurb:
      'Underground rock for the college-age through mid-30s audience. Lower-cost spots; high engagement.',
    href: '/prospects?daypart=rock_indie',
  },
  {
    title: 'The Darker Side',
    airtimes: 'Late night, weekends',
    blurb:
      'R&B, hip-hop, and electronic. Younger audience overlap with Record Hospital.',
    href: '/prospects?daypart=rnb',
  },
  {
    title: 'Sports',
    airtimes: 'Game-by-game, in season',
    blurb:
      'Harvard football, hockey, basketball broadcasts. Alumni + student + faculty audience; in-game mentions sold separately.',
    href: '/prospects?affiliation=harvard_affiliated',
  },
  {
    title: 'News',
    airtimes: 'Daily',
    blurb: 'Harvard news + cultural coverage.',
    href: '/prospects',
  },
  {
    title: 'Orgy Season',
    airtimes: 'Reading + exam period (Dec, May)',
    blurb:
      'WHRB’s signature 24/7 themed marathon programming during Harvard reading + exam periods. Sponsorship sells out fast.',
    href: '/guide#seasonal-programs',
  },
];
