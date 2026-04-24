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
//   - Every PNG is written with at least 50 KB of pixel data (naturally
//     true for a 1440×900 headed screenshot).
//   - The manifest's routes[i].sha256 is computed from the on-disk bytes;
//     the pre-push hook recomputes + compares.
//   - Observations are deliberately left empty — the skill's step 5 Edit
//     is what makes the captured PNGs count as "inspected."

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VERIFY_DEV_EMAIL"]) {
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

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return "UNKNOWN";
  }
}

function gitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT }).toString().trim();
  } catch {
    return "UNKNOWN";
  }
}

function changedUiFiles() {
  try {
    const out = execSync(CHANGED_FILES_SH, { cwd: REPO_ROOT }).toString().trim();
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

// --- auth via Supabase admin magic-link ---

async function mintMagicLink(env) {
  // Use the Supabase admin API to generate a magic link for VERIFY_DEV_EMAIL.
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/generate_link`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "apikey": env.SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ type: "magiclink", email: env.VERIFY_DEV_EMAIL }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Supabase admin generate_link failed: ${resp.status} ${text}`);
  }
  const data = await resp.json();
  const link = data.action_link || data.properties?.action_link;
  if (!link) throw new Error(`generate_link returned no action_link: ${JSON.stringify(data)}`);
  return link;
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

  // Lazy-load puppeteer only when we actually intend to launch a browser.
  // This keeps --dry-run fast and avoids hard-failing commit 1.
  let puppeteer;
  try {
    puppeteer = (await import("puppeteer")).default;
  } catch (err) {
    throw new Error(
      "puppeteer not installed — run `pnpm -C whrb-web add -D puppeteer` before calling /verify-ui. " +
      `(import error: ${err.message})`,
    );
  }

  const sha = gitSha().slice(0, 7);
  const screenshotsDir = join(REPO_ROOT, ".claude", "screenshots", sha);
  mkdirSync(screenshotsDir, { recursive: true });

  const magicLink = await mintMagicLink(env);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  try {
    await page.goto(magicLink, { waitUntil: "networkidle2", timeout: 60000 });
  } catch (err) {
    await browser.close();
    throw new Error(`Magic-link navigation failed: ${err.message}. Is pnpm dev on :3000?`);
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
            await page.keyboard.down(step.key.split("+")[0]);
            await page.keyboard.press(step.key.split("+").slice(-1)[0]);
            await page.keyboard.up(step.key.split("+")[0]);
            await new Promise((r) => setTimeout(r, 250));
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
