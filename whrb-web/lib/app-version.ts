// Resolves the app version from package.json at build time.
// Used by the persistent footer (Stage T1) and any future about-page.
//
// Importing JSON in Next.js requires the resolveJsonModule + esModuleInterop
// flags, both already on by default in the project's tsconfig (Next 15
// presets). The literal value is inlined at build, so this read is free at
// runtime.

import pkg from '../package.json' with { type: 'json' };

export const APP_VERSION: string =
  typeof (pkg as { version?: string }).version === 'string'
    ? (pkg as { version: string }).version
    : '0.0.0';
