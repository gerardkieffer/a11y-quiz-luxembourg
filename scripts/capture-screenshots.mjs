import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { mapWithConcurrency } from "./lib/api-client.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const FAILURES_FILE = path.join(DATA_DIR, "screenshot-failures.json");
const SCREENSHOT_DIR = path.join(process.cwd(), "public", "screenshots");
const CONCURRENCY = 3;
const NAV_TIMEOUT_MS = 20000;

const FORCE = process.argv.includes("--force");

const CONSENT_SELECTORS = [
  "#didomi-notice-agree-button",
  "#onetrust-accept-btn-handler",
  ".cc-allow",
  ".cc-btn.cc-allow",
  "button[aria-label='Accepter']",
  "button[aria-label='Tout accepter']",
  "#axeptio_btn_acceptAll",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
];

const CONSENT_TEXT_PATTERNS = [
  /tout accepter/i,
  /accepter tout/i,
  /accepter les cookies/i,
  /autoriser tout/i,
  /tout confirmer/i,
  /j.?accepte/i,
  /^accepter$/i,
  /accept all/i,
  /^agree$/i,
  /^ok$/i,
  /okay f.r mich/i,
];

// Per-site fixes for banners the generic rules above can't catch
// (custom "dismiss" widgets with no matching text/role, e.g. a plain
// close icon), keyed by Observatory auditId.
const SITE_OVERRIDES = {
  6: { selectors: [".dismiss-banner"] }, // LuxTrust anti-fraud banner, not a cookie consent widget
};

async function dismissBannersOnce(page, auditId) {
  const extraSelectors = SITE_OVERRIDES[auditId]?.selectors ?? [];
  let dismissed = false;
  // Consent widgets are frequently rendered inside a third-party iframe
  // (e.g. an embedded map/journey-planner widget), so every frame must
  // be checked, not just the top-level page.
  for (const frame of page.frames()) {
    for (const selector of [...CONSENT_SELECTORS, ...extraSelectors]) {
      const loc = frame.locator(selector).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          await loc.click({ timeout: 2000 }).catch(() => {});
          dismissed = true;
        }
      }
    }
    for (const pattern of CONSENT_TEXT_PATTERNS) {
      const loc = frame.getByRole("button", { name: pattern }).first();
      if ((await loc.count().catch(() => 0)) > 0) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          await loc.click({ timeout: 2000 }).catch(() => {});
          dismissed = true;
        }
      }
    }
  }
  return dismissed;
}

// Some sites stack multiple banners (e.g. a cookie-settings modal on top
// of a second consent bar), so keep trying for a few rounds.
async function dismissConsentBanner(page, auditId, rounds = 4) {
  let dismissedAny = false;
  for (let i = 0; i < rounds; i++) {
    const did = await dismissBannersOnce(page, auditId);
    if (did) dismissedAny = true;
    else if (i > 0) break;
    await page.waitForTimeout(400);
  }
  return dismissedAny;
}

async function captureOne(browser, site) {
  const outPath = path.join(SCREENSHOT_DIR, `${site.auditId}.jpg`);
  const relativePath = `screenshots/${site.auditId}.jpg`;

  if (!FORCE && existsSync(outPath)) {
    return { auditId: site.auditId, ok: true, screenshot: relativePath, skipped: true };
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Some sites never reach "networkidle" (e.g. background polling/analytics
  // that keeps at least one request in flight), so the retry falls back to
  // the less strict "load" event instead of repeating the same wait.
  const attempt = async (waitUntil) => {
    await page.goto(site.homeUri, { waitUntil, timeout: NAV_TIMEOUT_MS });
    await dismissConsentBanner(page, site.auditId);
    await page.waitForTimeout(500);
    await page.screenshot({ path: outPath, type: "jpeg", quality: 80 });
  };

  try {
    try {
      await attempt("networkidle");
    } catch (firstErr) {
      console.warn(`  retry ${site.auditId} (${site.homeUri}): ${firstErr.message}`);
      await attempt("load");
    }
    return { auditId: site.auditId, ok: true, screenshot: relativePath };
  } catch (err) {
    return {
      auditId: site.auditId,
      ok: false,
      reason: err.message,
      homeUri: site.homeUri,
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const bundle = JSON.parse(await readFile(SITES_FILE, "utf8"));
  await mkdir(SCREENSHOT_DIR, { recursive: true });

  console.log(
    `Capturing screenshots for ${bundle.sites.length} sites (concurrency ${CONCURRENCY}${
      FORCE ? ", forced re-capture" : ""
    })...`
  );

  const browser = await chromium.launch();
  let results;
  try {
    results = await mapWithConcurrency(bundle.sites, CONCURRENCY, (site) =>
      captureOne(browser, site)
    );
  } finally {
    await browser.close();
  }

  const capturedAt = new Date().toISOString().slice(0, 10);
  const failures = [];
  let succeeded = 0;
  let skipped = 0;

  for (const site of bundle.sites) {
    const result = results.find((r) => r.auditId === site.auditId);
    if (result?.ok) {
      site.screenshot = result.screenshot;
      site.screenshotCapturedAt = site.screenshotCapturedAt ?? capturedAt;
      if (result.skipped) skipped++;
      else {
        site.screenshotCapturedAt = capturedAt;
        succeeded++;
      }
    } else {
      site.screenshot = null;
      site.screenshotCapturedAt = null;
      failures.push({
        auditId: site.auditId,
        name: site.name,
        homeUri: site.homeUri,
        reason: result?.reason ?? "unknown",
      });
    }
  }

  await writeFile(SITES_FILE, JSON.stringify(bundle, null, 2), "utf8");
  if (failures.length > 0) {
    await writeFile(FAILURES_FILE, JSON.stringify(failures, null, 2), "utf8");
  }

  console.log(`\nDone. Captured: ${succeeded}, already had one: ${skipped}, failed: ${failures.length}`);
  if (failures.length > 0) {
    console.log(`See ${FAILURES_FILE} for details.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
