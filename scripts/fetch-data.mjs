import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getAuditsList,
  getAuditDetail,
  getInventory,
  getStatements,
  mapWithConcurrency,
} from "./lib/api-client.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const RAW_CACHE_DIR = path.join(DATA_DIR, "raw-cache");
const OUTPUT_FILE = path.join(DATA_DIR, "sites.json");
const TARGET_TOTAL = 40;
const MIN_PER_SCORE_BUCKET = 10;
const MIN_STALE = 8;
const STALE_DAYS = 365;

// Optional: human-readable English theme titles from the local RAWeb
// reference (dev-machine only, used purely for readability of the
// intermediate data bundle; the frontend never sees these).
const THEMES_REF_PATH = path.join(
  os.homedir(),
  ".claude/skills/references/raweb/themes.json"
);

async function loadThemeTitles() {
  try {
    const raw = await readFile(THEMES_REF_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Object.fromEntries(
      Object.entries(parsed).map(([num, val]) => [num, val.title])
    );
  } catch {
    return {};
  }
}

async function getCachedAuditDetail(auditId) {
  const cachePath = path.join(RAW_CACHE_DIR, `${auditId}.json`);
  if (existsSync(cachePath)) {
    return JSON.parse(await readFile(cachePath, "utf8"));
  }
  const detail = await getAuditDetail(auditId);
  await writeFile(cachePath, JSON.stringify(detail, null, 2), "utf8");
  return detail;
}

function daysSince(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  return Math.round((now - then) / (1000 * 60 * 60 * 24));
}

function computeThemeStats(pages, themeTitles) {
  const stats = {};
  for (const page of pages) {
    for (const assessment of page.assessments ?? []) {
      const num = assessment.criterion?.number;
      if (!num) continue;
      const theme = num.split(".")[0];
      const status = assessment.status?.name;
      if (!stats[theme]) {
        stats[theme] = {
          title: themeTitles[theme] ?? `Theme ${theme}`,
          compliant: 0,
          nonCompliant: 0,
          notApplicable: 0,
          total: 0,
        };
      }
      stats[theme].total++;
      if (status === "C") stats[theme].compliant++;
      else if (status === "NC") stats[theme].nonCompliant++;
      else if (status === "NA") stats[theme].notApplicable++;
    }
  }
  return stats;
}

function pickWorstBestTheme(themeStats) {
  let worst = null;
  let best = null;
  for (const [number, s] of Object.entries(themeStats)) {
    const assessed = s.compliant + s.nonCompliant; // exclude N/A
    if (assessed === 0) continue;
    if (!worst || s.nonCompliant > worst.nonCompliantCount) {
      worst = { number, nonCompliantCount: s.nonCompliant };
    }
    if (
      s.nonCompliant === 0 &&
      (!best || s.compliant > best.compliantCount)
    ) {
      best = { number, compliantCount: s.compliant };
    }
  }
  return {
    worstTheme: worst && worst.nonCompliantCount > 0 ? worst : null,
    bestTheme: best,
  };
}

function normalizeName(name) {
  return (name ?? "").trim().toLowerCase();
}

const NON_PRODUCTION_HOST_PATTERNS = [
  /preprod/i,
  /staging/i,
  /^dev[-.]/i,
  /\.dev\./i,
  /netlify\.app$/i,
  /odoo\.com$/i,
  /localhost/i,
];

function isProductionUri(uri) {
  try {
    const host = new URL(uri).hostname;
    return !NON_PRODUCTION_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(RAW_CACHE_DIR, { recursive: true });
  const themeTitles = await loadThemeTitles();

  console.log("Fetching audits list (type=1, in-depth/RAWeb)...");
  const auditsList = await getAuditsList();
  console.log(`  -> ${auditsList.length} candidate audits`);

  console.log("Fetching inventory and statements...");
  const [inventory, statements] = await Promise.all([
    getInventory(),
    getStatements(),
  ]);
  const inventoryByName = new Map(
    inventory.map((i) => [normalizeName(i.Item), i])
  );
  const statementsByName = new Map(
    statements.map((s) => [normalizeName(s.Item), s])
  );

  console.log("Fetching audit details (concurrency 5, cached)...");
  let done = 0;
  const details = await mapWithConcurrency(auditsList, 5, async (a) => {
    const detail = await getCachedAuditDetail(a.AuditId);
    done++;
    if (done % 10 === 0) console.log(`  -> ${done}/${auditsList.length}`);
    return { list: a, detail: Array.isArray(detail) ? detail[0] : detail };
  });

  // Some sites have been audited more than once. Group by site name so the
  // most recent audit becomes the "site" candidate, and older audits ride
  // along as history (used for the score-improvement question type) rather
  // than being selectable as if they were separate, independent sites.
  const byName = new Map();
  for (const entry of details) {
    const name = entry.detail?.inventory?.name ?? entry.list["Inventory.NameFr"];
    const key = normalizeName(name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(entry);
  }

  const candidates = [];
  let skippedNoPages = 0;
  let unmatchedInventory = 0;

  for (const group of byName.values()) {
    group.sort(
      (a, b) => new Date(a.detail?.audited_at ?? 0) - new Date(b.detail?.audited_at ?? 0)
    );
    const { list, detail } = group[group.length - 1];
    const previousAudits = group.slice(0, -1).map((e) => ({
      auditId: e.list.AuditId,
      auditedAt: e.detail?.audited_at ?? null,
      complianceRate: e.list.ComplianceRate,
    }));

    if (!detail || !Array.isArray(detail.pages) || detail.pages.length === 0) {
      skippedNoPages++;
      continue;
    }
    const homePage = [...detail.pages].sort((a, b) => a.number - b.number)[0];
    if (
      !homePage?.uri ||
      !/^https?:\/\//i.test(homePage.uri) ||
      !isProductionUri(homePage.uri)
    ) {
      skippedNoPages++;
      continue;
    }

    const name = detail.inventory?.name ?? list["Inventory.NameFr"];
    const inv = inventoryByName.get(normalizeName(name));
    if (!inv) unmatchedInventory++;
    const stmt = statementsByName.get(normalizeName(name));

    const themeStats = computeThemeStats(detail.pages, themeTitles);
    const { worstTheme, bestTheme } = pickWorstBestTheme(themeStats);

    candidates.push({
      auditId: list.AuditId,
      name,
      lang: list["Inventory.Lang"],
      homeUri: homePage.uri,
      auditedAt: detail.audited_at,
      assessedLevel: detail.assessed_level?.name ?? null,
      complianceRate: list.ComplianceRate,
      sector: inv?.Theme ?? null,
      administrativeLevel: inv?.AdministrativeLevel ?? null,
      pageCount: detail.pages.length,
      themeStats,
      worstTheme,
      bestTheme,
      screenshot: null,
      screenshotCapturedAt: null,
      previousAudits,
      statement: stmt
        ? {
            found: true,
            compliance: stmt.Compliance,
            uri: stmt.Uri,
            createdUpdated: stmt.Created_Updated,
          }
        : { found: false },
      comparablePairsWith: [],
      _ageInDays: daysSince(detail.audited_at),
      _scoreBucket:
        list.ComplianceRate < 50
          ? "low"
          : list.ComplianceRate < 80
          ? "mid"
          : "high",
    });
  }

  console.log(
    `Usable candidates: ${candidates.length} (skipped ${skippedNoPages} without valid pages; ${unmatchedInventory} without inventory match)`
  );

  const selected = curate(candidates);
  computeComparablePairs(selected);

  const output = selected.map((c) => {
    const { _ageInDays, _scoreBucket, ...rest } = c;
    return rest;
  });

  const meta = {
    generatedAt: new Date().toISOString(),
    sourceApiBase: "https://observatoire.accessibilite.public.lu/api/1",
    totalCandidateAudits: candidates.length,
    curatedCount: output.length,
  };

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    OUTPUT_FILE,
    JSON.stringify({ meta, sites: output }, null, 2),
    "utf8"
  );

  report(selected);
  console.log(`\nWrote ${OUTPUT_FILE}`);
}

function curate(candidates) {
  const selected = new Map(); // auditId -> record
  const add = (c) => selected.set(c.auditId, c);

  // 1. Sector coverage: one representative per sector.
  const sectors = [...new Set(candidates.map((c) => c.sector).filter(Boolean))];
  for (const sector of sectors) {
    const pick = candidates.find(
      (c) => c.sector === sector && !selected.has(c.auditId)
    );
    if (pick) add(pick);
  }

  // 2. Administrative level coverage.
  const levels = [
    ...new Set(candidates.map((c) => c.administrativeLevel).filter(Boolean)),
  ];
  for (const level of levels) {
    if ([...selected.values()].some((c) => c.administrativeLevel === level))
      continue;
    const pick = candidates.find(
      (c) => c.administrativeLevel === level && !selected.has(c.auditId)
    );
    if (pick) add(pick);
  }

  // 3. Minimum stale (>1yr) audits.
  const staleCandidates = candidates
    .filter((c) => c._ageInDays > STALE_DAYS)
    .sort((a, b) => b._ageInDays - a._ageInDays);
  for (const c of staleCandidates) {
    const staleCount = [...selected.values()].filter(
      (s) => s._ageInDays > STALE_DAYS
    ).length;
    if (staleCount >= MIN_STALE) break;
    add(c);
  }

  // 4. Minimum per score bucket.
  for (const bucket of ["low", "mid", "high"]) {
    const bucketCandidates = candidates.filter((c) => c._scoreBucket === bucket);
    for (const c of bucketCandidates) {
      const bucketCount = [...selected.values()].filter(
        (s) => s._scoreBucket === bucket
      ).length;
      if (bucketCount >= MIN_PER_SCORE_BUCKET) break;
      add(c);
    }
  }

  // 5. Fill to target total, round-robin across score buckets.
  const remaining = () => TARGET_TOTAL - selected.size;
  const byBucket = {
    low: candidates.filter((c) => c._scoreBucket === "low"),
    mid: candidates.filter((c) => c._scoreBucket === "mid"),
    high: candidates.filter((c) => c._scoreBucket === "high"),
  };
  let progress = true;
  while (remaining() > 0 && progress) {
    progress = false;
    for (const bucket of ["low", "mid", "high"]) {
      if (remaining() <= 0) break;
      const next = byBucket[bucket].find((c) => !selected.has(c.auditId));
      if (next) {
        add(next);
        progress = true;
      }
    }
  }

  return [...selected.values()];
}

function computeComparablePairs(selected) {
  const MIN_SCORE_DIFF = 5;
  for (const a of selected) {
    for (const b of selected) {
      if (a.auditId === b.auditId) continue;
      if (
        a.sector &&
        a.sector === b.sector &&
        Math.abs(a.complianceRate - b.complianceRate) >= MIN_SCORE_DIFF
      ) {
        a.comparablePairsWith.push(b.auditId);
      }
    }
  }
}

function report(selected) {
  const byBucket = { low: 0, mid: 0, high: 0 };
  let stale = 0;
  const sectors = new Set();
  const levels = new Set();
  let pairCount = 0;
  let withHistory = 0;
  for (const c of selected) {
    byBucket[c._scoreBucket]++;
    if (c._ageInDays > STALE_DAYS) stale++;
    if (c.sector) sectors.add(c.sector);
    if (c.administrativeLevel) levels.add(c.administrativeLevel);
    pairCount += c.comparablePairsWith.length;
    if (c.previousAudits.length > 0) withHistory++;
  }
  console.log("\n--- Curation report ---");
  console.log(`Total selected: ${selected.length} (target ${TARGET_TOTAL})`);
  console.log(`Score buckets:`, byBucket);
  console.log(`Stale (>1yr) audits: ${stale} (min ${MIN_STALE})`);
  console.log(`Sectors covered: ${sectors.size}`, [...sectors]);
  console.log(`Administrative levels covered: ${levels.size}`, [...levels]);
  console.log(`Comparable pairs (directed edges): ${pairCount}`);
  console.log(`Sites with a prior audit on record: ${withHistory}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
