#!/usr/bin/env node
// .claude/hooks/helpers/run-verify.mjs
//
// Puppeteer-driven UI verification runner. Captures screenshots of every
// authed route × theme × probe, computes sha256(file) per PNG, writes
// .ui-verified.json at repo root with routes[] populated and
// observations: [] (the /verify-ui skill fills those in after Claude Reads
// each PNG).
//
// Invoked from .claude/skills/verify-ui/SKILL.md.
// Flags:
//   --dry-run       Print the resolved route × theme × probe matrix and exit.
//   --skip-dark     Skip the dark-mode capture pass (diagnostics only).
//   --routes <csv>  Restrict to the given comma-separated routes.
//
// Integrity contract:
//   - Every PNG is written with at least 20 KB of pixel data. A 1440×900
//     viewport of mostly-empty content (e.g. a notifications inbox empty
//     state) compresses to ~35 KB, so the floor is set well below that
//     while still catching truly blank/broken captures (<10 KB).
//   - The manifest's routes[i].sha256 is computed from the on-disk bytes;
//     the pre-push hook recomputes + compares.
//   - Observations are deliberately left empty — the skill's step 5 Edit
//     is what makes the captured PNGs count as "inspected."

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// --- constants ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const WEB_DIR = join(REPO_ROOT, "whrb-web");
const ENV_FILE = join(WEB_DIR, ".env.local");
const ROUTES_FILE = join(__dirname, "all-authed-routes.json");
const PROBES_FILE = join(__dirname, "probes.json");
const CHANGED_FILES_SH = join(__dirname, "changed-ui-files.sh");
const BASE_URL = process.env.VERIFY_BASE_URL || "http://localhost:3000";
const MANIFEST_PATH = join(REPO_ROOT, ".ui-verified.json");

// --- argv ---

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const SKIP_DARK = argv.includes("--skip-dark");
const ROUTES_FLAG = (() => {
  const i = argv.indexOf("--routes");
  return i >= 0 && argv[i + 1] ? argv[i + 1].split(",") : null;
})();

// --- helpers ---

function slugify(routePath) {
  if (routePath === "/") return "home";
  return routePath.replace(/^\//, "").replace(/\//g, "-").replace(/:/g, "");
}

function readEnv() {
  if (!existsSync(ENV_FILE)) {
    throw new Error(`Missing ${ENV_FILE}. Expected NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VERIFY_DEV_EMAIL.`);
  }
  const out = {};
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERIFY_DEV_EMAIL",
  ]) {
    if (!out[k]) {
      throw new Error(`${k} not set in ${ENV_FILE}`);
    }
  }
  return out;
}

function sha256OfFile(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

// execFileSync-style spawn via execSync: pass the command as a single string
// with each argv element quoted so paths-with-spaces survive /bin/sh.
function shOne(cmd, args = []) {
  // Single-quote each arg (escape embedded single quotes with '\'').
  const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const joined = [cmd, ...args].map(q).join(" ");
  return execSync(joined, { cwd: REPO_ROOT }).toString().trim();
}

function gitSha() {
  try { return shOne("git", ["rev-parse", "HEAD"]); } catch { return "UNKNOWN"; }
}

function gitBranch() {
  try { return shOne("git", ["rev-parse", "--abbrev-ref", "HEAD"]); } catch { return "UNKNOWN"; }
}

function changedUiFiles() {
  try {
    const out = shOne(CHANGED_FILES_SH);
    return out ? out.split("\n") : [];
  } catch (err) {
    console.error(`[warn] changed-ui-files.sh failed: ${err.message}`);
    return [];
  }
}

function nowIsoZ() {
  // Match the YYYY-MM-DDTHH:MM:SSZ shape the hook parses.
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

// --- matrix ---

function buildMatrix() {
  const routesCfg = JSON.parse(readFileSync(ROUTES_FILE, "utf8"));
  const probesCfg = JSON.parse(readFileSync(PROBES_FILE, "utf8"));
  const routes = ROUTES_FLAG ?? routesCfg.routes;
  const themes = SKIP_DARK ? ["light"] : ["light", "dark"];
  const matrix = [];
  for (const route of routes) {
    for (const theme of themes) {
      matrix.push({ route, theme, probe: null });
      for (const probe of probesCfg[route] || []) {
        matrix.push({ route, theme, probe });
      }
    }
  }
  return { routes, themes, matrix };
}

async function resolveProspectId(page) {
  // Best-effort: navigate to /prospects and scrape the first row's href.
  try {
    await page.goto(`${BASE_URL}/prospects`, { waitUntil: "networkidle2", timeout: 30000 });
    const href = await page.$eval('a[href^="/prospects/"]', (a) => a.getAttribute("href"));
    if (href && href !== "/prospects") {
      return href.replace(/^\/prospects\//, "");
    }
  } catch {}
  return null;
}

// --- auth via Supabase admin → anon verifyOtp → app LoginForm ---
//
// Mirrors whrb-web/e2e/auth.setup.ts. Landing on localhost is what makes the
// auth cookie travel with subsequent puppeteer requests; if we navigated to
// the hosted Supabase verify URL instead, the cookie would be written on the
// supabase.co domain and never reach localhost.

function supabaseClient(env) {
  const require = createRequire(join(WEB_DIR, "package.json"));
  const resolved = require.resolve("@supabase/supabase-js");
  return import(pathToFileURL(resolved).href).then((mod) => mod.createClient);
}

async function mintAuthHashTokens(env) {
  const createClient = await supabaseClient(env);

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: env.VERIFY_DEV_EMAIL,
  });
  if (linkErr) throw new Error(`generateLink failed: ${linkErr.message}`);
  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink returned no hashed_token");

  const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(`verifyOtp failed: ${verifyErr.message}`);
  const accessToken = verified.session?.access_token;
  const refreshToken = verified.session?.refresh_token;
  if (!accessToken || !refreshToken) throw new Error("verifyOtp did not return usable tokens");
  return { accessToken, refreshToken };
}

// --- main ---

async function main() {
  const env = readEnv();
  const { routes, themes, matrix } = buildMatrix();

  if (DRY_RUN) {
    console.log(`routes:  ${routes.length}`);
    console.log(`themes:  ${themes.join(", ")}`);
    console.log(`captures: ${matrix.length}`);
    for (const m of matrix) {
      const label = m.probe ? `${m.route} [${m.probe.name}]` : m.route;
      console.log(`  ${m.theme.padEnd(5)} ${label}`);
    }
    process.exit(0);
  }

  // Lazy-load puppeteer from whrb-web/node_modules (where it's installed as
  // a devDep). Using createRequire lets us resolve the module path
  // explicitly from that tree, then dynamic-import it by file URL — the
  // runner itself lives at repo root and has no sibling node_modules.
  let puppeteer;
  try {
    const require = createRequire(join(WEB_DIR, "package.json"));
    const resolved = require.resolve("puppeteer");
    puppeteer = (await import(pathToFileURL(resolved).href)).default;
  } catch (err) {
    throw new Error(
      "puppeteer not installed in whrb-web — run `pnpm -C whrb-web add -D puppeteer && pnpm -C whrb-web exec puppeteer browsers install chrome` before calling /verify-ui. " +
      `(resolve error: ${err.message})`,
    );
  }

  const sha = gitSha().slice(0, 7);
  const screenshotsDir = join(REPO_ROOT, ".claude", "screenshots", sha);
  mkdirSync(screenshotsDir, { recursive: true });

  const { accessToken, refreshToken } = await mintAuthHashTokens(env);

  // Prefer puppeteer's bundled Chrome when available; fall back to
  // $PUPPETEER_EXECUTABLE_PATH (or a common macOS system-Chrome path) if
  // the bundled binary is missing, so we still work when the cache is
  // gone or disk pressure blocked the install.
  const launchOpts = {
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  };
  const overridePath = process.env.PUPPETEER_EXECUTABLE_PATH
    || (existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : null);
  try {
    // Confirm the bundled path is real; if not, switch to override.
    const bundled = puppeteer.executablePath();
    if (!existsSync(bundled) && overridePath) {
      launchOpts.executablePath = overridePath;
      console.warn(`[info] bundled Chrome missing at ${bundled}; using ${overridePath}`);
    }
  } catch {
    if (overridePath) launchOpts.executablePath = overridePath;
  }
  const browser = await puppeteer.launch(launchOpts);
  const page = await browser.newPage();

  // Hand the hash tokens to the app's LoginForm, which calls setSession()
  // client-side and writes the @supabase/ssr auth cookies on localhost.
  // Landing auth on-origin is what makes the cookies travel with the
  // subsequent route visits — a hosted-Supabase verify URL sets cookies
  // on the supabase.co domain and they never reach localhost.
  const hashUrl = `${BASE_URL}/login#access_token=${accessToken}&refresh_token=${refreshToken}&type=magiclink`;
  try {
    await page.goto(hashUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForFunction(
      () => /sb-[^=]+-auth-token(\.\d+)?=/.test(document.cookie),
      { timeout: 30000 },
    );
  } catch (err) {
    await browser.close();
    throw new Error(`Auth handoff failed (pnpm dev on :3000? LoginForm wiring intact?): ${err.message}`);
  }

  // Resolve :id if /prospects/:id appears in the matrix (it doesn't today, but
  // handle the case gracefully if future stages add it to all-authed-routes.json).
  const dynamicId = routes.some((r) => r.includes(":id"))
    ? await resolveProspectId(page)
    : null;

  const capturedRoutes = [];

  for (const entry of matrix) {
    const routePath = entry.route.replace(":id", dynamicId || "first");
    const probeSuffix = entry.probe ? `-${entry.probe.name}` : "";
    const fileName = `${slugify(entry.route)}${probeSuffix}-${entry.theme}.png`;
    const screenshotPath = join(screenshotsDir, fileName);

    // Apply theme BEFORE navigation so the first paint is in the right theme.
    await page.evaluate((theme) => {
      try {
        window.localStorage.setItem("theme", theme);
      } catch {}
    }, entry.theme);

    try {
      await page.goto(`${BASE_URL}${routePath}`, { waitUntil: "networkidle2", timeout: 45000 });
    } catch (err) {
      console.warn(`[warn] goto ${routePath} failed: ${err.message} — continuing.`);
    }

    // Re-apply theme post-navigation in case next-themes writes cookie, not localStorage.
    await page.evaluate((theme) => {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
      document.documentElement.style.colorScheme = theme;
    }, entry.theme);

    if (entry.probe) {
      for (const step of entry.probe.steps) {
        try {
          if (step.click) {
            await page.waitForSelector(step.click, { timeout: 5000 });
            await page.click(step.click);
            await new Promise((r) => setTimeout(r, 250));
          } else if (step.goto) {
            await page.goto(`${BASE_URL}${step.goto}`, { waitUntil: "networkidle2", timeout: 30000 });
          } else if (step.key) {
            // Split "Meta+K" → ["Meta", "K"]. All but the last are
            // modifiers; the last is the final key.
            const parts = step.key.split("+");
            const modifiers = parts.slice(0, -1);
            const final = parts[parts.length - 1];
            for (const m of modifiers) await page.keyboard.down(m);
            await page.keyboard.press(final.length === 1 ? `Key${final.toUpperCase()}` : final);
            for (const m of modifiers.slice().reverse()) await page.keyboard.up(m);
            await new Promise((r) => setTimeout(r, 400));
          } else if (step.hover) {
            await page.hover(step.hover);
            await new Promise((r) => setTimeout(r, 250));
          }
        } catch (err) {
          console.warn(`[warn] probe step on ${routePath} failed: ${err.message}`);
        }
      }
    }

    await page.screenshot({ path: screenshotPath, fullPage: false });
    const shaHash = sha256OfFile(screenshotPath);

    capturedRoutes.push({
      path: entry.route,
      theme: entry.theme,
      probe: entry.probe?.name ?? null,
      screenshot: `.claude/screenshots/${sha}/${fileName}`,
      sha256: shaHash,
    });

    console.log(`[ok] ${entry.theme} ${entry.route}${probeSuffix}`);
  }

  await browser.close();

  const manifest = {
    timestamp: nowIsoZ(),
    commit_sha: gitSha(),
    branch: gitBranch(),
    routes: capturedRoutes,
    observations: [],
    files_covered: changedUiFiles(),
    captured_by: "verify-ui-skill@v2",
    runner_version: "run-verify.mjs@v1",
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${MANIFEST_PATH}`);
  console.log(`  ${capturedRoutes.length} screenshots`);
  console.log(`  files_covered: ${manifest.files_covered.length}`);
  console.log(`  observations: [] — fill in via /verify-ui skill step 5 before pushing.`);
}

main().catch((err) => {
  console.error(`\n[run-verify] ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
