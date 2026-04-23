/**
 * Command Palette route registry.
 *
 * Single source of truth for the routes exposed via the ⌘K palette.
 * Every stage that adds a new authed route MUST append an entry here
 * in the same PR (epic plan §1.5 convention — "Command Palette
 * route-add convention").
 *
 * Seeded with every reachable post-T1 route. T3+ stages extend.
 */

export type CommandRoute = {
  /** Route to push via next/navigation router. */
  href: string;
  /** Label shown in the palette list. */
  label: string;
  /** Section grouping — used as the CommandGroup heading. */
  section: 'Navigate' | 'Admin';
  /** Filter admin-only entries out for non-admin users. */
  adminOnly?: boolean;
  /** String used by cmdk for fuzzy match. Falls back to label. */
  value?: string;
};

export const COMMAND_PALETTE_ROUTES: CommandRoute[] = [
  // --- Navigate ----------------------------------------------------------
  // Order mirrors the desktop nav (components/Nav.tsx TABS).
  { href: '/', label: 'Home', section: 'Navigate' },
  { href: '/prospects', label: 'All Prospects', section: 'Navigate' },
  { href: '/my', label: 'My Clients', section: 'Navigate' },
  { href: '/team', label: 'Team', section: 'Navigate' },
  { href: '/media-kit', label: 'Media Kit', section: 'Navigate' },
  { href: '/guide', label: 'Guide', section: 'Navigate' },
  { href: '/notifications', label: 'Notifications', section: 'Navigate' },
  // Plan line 204 specifies `/settings`; the app currently has no page at
  // that path (only /settings/notifications). Route to /settings/notifications
  // so the palette lands somewhere real.
  {
    href: '/settings/notifications',
    label: 'Settings',
    section: 'Navigate',
    value: 'settings',
  },

  // --- Admin -------------------------------------------------------------
  {
    href: '/admin/sources',
    label: 'Admin · Sources',
    section: 'Admin',
    adminOnly: true,
    value: 'admin sources',
  },
  {
    href: '/admin/vocab',
    label: 'Admin · Vocabulary',
    section: 'Admin',
    adminOnly: true,
    value: 'admin vocab vocabulary',
  },
  {
    href: '/admin/runs',
    label: 'Admin · Pipeline runs',
    section: 'Admin',
    adminOnly: true,
    value: 'admin runs pipeline',
  },
];
