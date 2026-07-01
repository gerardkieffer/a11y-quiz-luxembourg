import { readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { THEMES_FR, themeLabel, themeExplanation, VISUALLY_INSPECTABLE_THEMES } from "./lib/themes-fr.mjs";

const DATA_DIR = path.join(process.cwd(), "data");
const SITES_FILE = path.join(DATA_DIR, "sites.json");
const QUESTIONS_FILE = path.join(DATA_DIR, "questions.json");
const PUBLIC_QUESTIONS_FILE = path.join(process.cwd(), "public", "questions.json");

const TIME_LIMIT_SECONDS = 90;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hostnameOf(uri) {
  try {
    return new URL(uri).hostname.replace(/^www\./, "");
  } catch {
    return uri;
  }
}

// The frontend renders this directly as a link href, so only allow the
// http(s) scheme through even though the source API is normally trusted
// (defends against a javascript: URI ending up in upstream data).
function safeHttpUri(uri) {
  return typeof uri === "string" && /^https?:\/\//i.test(uri) ? uri : null;
}

function siteRef(site) {
  return {
    auditId: site.auditId,
    name: site.name,
    homeUri: site.homeUri,
    screenshot: site.screenshot,
    auditedAt: site.auditedAt,
    statementUri: site.statement?.found ? safeHttpUri(site.statement.uri) : null,
  };
}

function formatDateFr(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

let questionCounter = 0;
function makeQuestion({
  type,
  prompt,
  format,
  choices,
  correctAnswer,
  explanation,
  sites,
  showScreenshot,
}) {
  questionCounter++;
  return {
    id: `q-${type}-${questionCounter}`,
    type,
    prompt,
    format,
    choices,
    correctAnswer,
    explanation,
    sites: sites.map(siteRef),
    showScreenshot,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  };
}

// 1. score-threshold ---------------------------------------------------
function genScoreThreshold(sites) {
  const out = [];
  for (const site of sites) {
    const correct = `${site.complianceRate} %`;
    const distractorPool = sites
      .filter((s) => s.auditId !== site.auditId && s.complianceRate !== site.complianceRate)
      .map((s) => `${s.complianceRate} %`);
    const distractors = [...new Set(shuffle(distractorPool))].slice(0, 3);
    if (distractors.length < 3) continue;
    const choices = shuffle([correct, ...distractors]);
    out.push(
      makeQuestion({
        type: "score-threshold",
        prompt: `D'après l'audit officiel, quel est le taux de conformité aux règles d'accessibilité du site "${site.name}" (${hostnameOf(site.homeUri)}) ?`,
        format: "multiple-choice",
        choices,
        correctAnswer: correct,
        explanation: `Le site obtient un taux de conformité de ${site.complianceRate} % lors de l'audit officiel du ${formatDateFr(site.auditedAt)}.`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

// 2. compare-two-sites-score --------------------------------------------
function genCompareTwoSites(sites) {
  const out = [];
  const byId = new Map(sites.map((s) => [s.auditId, s]));
  const seenPairs = new Set();
  for (const a of sites) {
    for (const bId of a.comparablePairsWith) {
      const b = byId.get(bId);
      if (!b) continue;
      const key = [a.auditId, b.auditId].sort((x, y) => x - y).join("-");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const correct = a.complianceRate >= b.complianceRate ? a.name : b.name;
      out.push(
        makeQuestion({
          type: "compare-two-sites-score",
          prompt: `Lequel de ces deux sites obtient le meilleur taux de conformité aux règles d'accessibilité ?`,
          format: "multiple-choice",
          choices: shuffle([a.name, b.name]),
          correctAnswer: correct,
          explanation: `${a.name} : ${a.complianceRate} % — ${b.name} : ${b.complianceRate} % (audits officiels du ${formatDateFr(a.auditedAt)} et du ${formatDateFr(b.auditedAt)}).`,
          sites: [a, b],
          showScreenshot: true,
        })
      );
    }
  }
  return out;
}

// 3. weakest-theme --------------------------------------------------------
function genWeakestTheme(sites) {
  const out = [];
  for (const site of sites) {
    if (!site.worstTheme) continue;
    const assessedThemes = Object.entries(site.themeStats).filter(
      ([, s]) => s.compliant + s.nonCompliant > 0
    );
    if (assessedThemes.length < 4) continue;
    const correctLabel = themeLabel(site.worstTheme.number);
    const distractorThemes = assessedThemes
      .filter(([num]) => num !== site.worstTheme.number)
      .sort((a, b) => a[1].nonCompliant - b[1].nonCompliant)
      .slice(0, 6)
      .map(([num]) => themeLabel(num))
      .filter((label) => label !== correctLabel);
    const distractors = [...new Set(distractorThemes)].slice(0, 3);
    if (distractors.length < 3) continue;
    out.push(
      makeQuestion({
        type: "weakest-theme",
        prompt: `D'après l'audit officiel du site "${site.name}" (${hostnameOf(site.homeUri)}), sur quel aspect trouve-t-on le PLUS de problèmes d'accessibilité ?`,
        format: "multiple-choice",
        choices: shuffle([correctLabel, ...distractors]),
        correctAnswer: correctLabel,
        explanation: `${site.worstTheme.nonCompliantCount} problème(s) ont été relevés sur le thème "${correctLabel}". ${themeExplanation(site.worstTheme.number)}`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

// 4. theme-compliant-or-not (true/false) ----------------------------------
function genThemeCompliantOrNot(sites) {
  const out = [];
  for (const site of sites) {
    for (const themeNum of VISUALLY_INSPECTABLE_THEMES) {
      const stats = site.themeStats[themeNum];
      if (!stats || stats.compliant + stats.nonCompliant === 0) continue;
      const noIssues = stats.nonCompliant === 0;
      const label = themeLabel(themeNum);
      out.push(
        makeQuestion({
          type: "theme-compliant-or-not",
          prompt: `Vrai ou faux : d'après l'audit officiel, le site "${site.name}" (${hostnameOf(site.homeUri)}) ne présente aucun problème lié à : ${label.toLowerCase()}.`,
          format: "true-false",
          choices: ["Vrai", "Faux"],
          correctAnswer: noIssues ? "Vrai" : "Faux",
          explanation: noIssues
            ? `Aucun problème n'a été relevé sur ce thème lors de l'audit officiel. ${themeExplanation(themeNum)}`
            : `${stats.nonCompliant} problème(s) ont été relevés sur ce thème lors de l'audit officiel. ${themeExplanation(themeNum)}`,
          sites: [site],
          showScreenshot: true,
        })
      );
    }
  }
  return out;
}

// 5. declared-vs-measured --------------------------------------------------
const COMPLIANCE_LABEL_FR = {
  full: "totalement conforme",
  partial: "partiellement conforme",
  no: "non conforme",
};

function genDeclaredVsMeasured(sites) {
  const out = [];
  for (const site of sites) {
    if (!site.statement?.found) continue;
    const declaredLabel = COMPLIANCE_LABEL_FR[site.statement.compliance];
    if (!declaredLabel) continue;
    const correct = `${site.complianceRate} %`;
    const distractorPool = sites
      .filter((s) => s.auditId !== site.auditId && s.complianceRate !== site.complianceRate)
      .map((s) => `${s.complianceRate} %`);
    const distractors = [...new Set(shuffle(distractorPool))].slice(0, 3);
    if (distractors.length < 3) continue;
    out.push(
      makeQuestion({
        type: "declared-vs-measured",
        prompt: `Le site "${site.name}" (${hostnameOf(site.homeUri)}) déclare lui-même une accessibilité "${declaredLabel}". D'après l'audit officiel indépendant, son taux de conformité réel est de :`,
        format: "multiple-choice",
        choices: shuffle([correct, ...distractors]),
        correctAnswer: correct,
        explanation: `Le site se déclare "${declaredLabel}" dans sa déclaration d'accessibilité, mais l'audit officiel indépendant mesure un taux de conformité de ${site.complianceRate} %. Une déclaration peut différer de la réalité mesurée par un audit.`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

// 6. statement-update-timing -------------------------------------------------
function genStatementUpdateTiming(sites) {
  const out = [];
  for (const site of sites) {
    if (!site.statement?.found || !site.statement.createdUpdated) continue;
    const statementDate = new Date(site.statement.createdUpdated).getTime();
    const auditDate = new Date(site.auditedAt).getTime();
    if (statementDate === auditDate) continue; // no meaningful before/after to ask about
    const updatedAfter = statementDate > auditDate;
    const correct = updatedAfter ? "Vrai" : "Faux";
    out.push(
      makeQuestion({
        type: "statement-update-timing",
        prompt: `Le site "${site.name}" (${hostnameOf(site.homeUri)}) publie une déclaration d'accessibilité. Vrai ou faux : cette déclaration a été mise à jour APRÈS le dernier audit officiel du site (${formatDateFr(site.auditedAt)}) ?`,
        format: "true-false",
        choices: ["Vrai", "Faux"],
        correctAnswer: correct,
        explanation: updatedAfter
          ? `La déclaration a été mise à jour le ${formatDateFr(site.statement.createdUpdated)}, après l'audit officiel du ${formatDateFr(site.auditedAt)}. Elle a donc pu être révisée à la lumière de ce dernier audit.`
          : `La déclaration date du ${formatDateFr(site.statement.createdUpdated)}, avant l'audit officiel du ${formatDateFr(site.auditedAt)}. Elle n'a donc pas forcément été mise à jour avec les constats de ce dernier audit.`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

// 7. score-improvement (sites audited more than once) ------------------------
function formatDeltaPoints(diff) {
  if (diff === 0) return "0 point (aucun changement)";
  const sign = diff > 0 ? "+" : "−";
  const abs = Math.abs(diff);
  return `${sign}${abs} point${abs > 1 ? "s" : ""}`;
}

function genScoreImprovement(sites) {
  const out = [];
  for (const site of sites) {
    if (!site.previousAudits?.length) continue;
    const prev = site.previousAudits[site.previousAudits.length - 1];
    // Guard against audits published on the same date (ambiguous ordering,
    // seen at least once in the source data) — a before/after question only
    // makes sense when the previous audit genuinely predates this one.
    if (!prev.auditedAt || new Date(prev.auditedAt) >= new Date(site.auditedAt)) continue;

    const correctDiff = site.complianceRate - prev.complianceRate;
    const correct = formatDeltaPoints(correctDiff);
    const offsets = [8, -8, 15, -15, 4, -4].map((o) => correctDiff + o);
    const distractors = [...new Set(offsets)]
      .filter((d) => d !== correctDiff)
      .slice(0, 3)
      .map(formatDeltaPoints);
    if (distractors.length < 3) continue;

    out.push(
      makeQuestion({
        type: "score-improvement",
        prompt: `Le site "${site.name}" (${hostnameOf(site.homeUri)}) a été audité à deux reprises : le ${formatDateFr(prev.auditedAt)}, puis le ${formatDateFr(site.auditedAt)}. Entre ces deux audits, de combien son taux de conformité a-t-il évolué ?`,
        format: "multiple-choice",
        choices: shuffle([correct, ...distractors]),
        correctAnswer: correct,
        explanation: `Le taux de conformité est passé de ${prev.complianceRate} % à ${site.complianceRate} %, soit une évolution de ${correct}. À noter : deux audits ne portent pas forcément exactement sur les mêmes pages, la comparaison donne donc une tendance plutôt qu'une mesure parfaitement identique.`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

// 8. page-count-or-scope -----------------------------------------------------
function genPageCountOrScope(sites) {
  const out = [];
  for (const site of sites) {
    const correct = site.pageCount;
    const offsets = [-5, 4, 9, -3, 7].map((o) => Math.max(1, correct + o));
    const distractors = [...new Set(offsets)].filter((n) => n !== correct).slice(0, 3);
    if (distractors.length < 3) continue;
    const choices = shuffle([correct, ...distractors]).map(String);
    out.push(
      makeQuestion({
        type: "page-count-or-scope",
        prompt: `Lors de l'audit officiel du site "${site.name}" (${hostnameOf(site.homeUri)}), combien de pages ont été passées au crible par les experts ?`,
        format: "multiple-choice",
        choices,
        correctAnswer: String(correct),
        explanation: `Un audit ne vérifie pas la totalité d'un site mais un échantillon représentatif de pages (ici, ${correct}), afin d'estimer l'accessibilité globale sans tout auditer.`,
        sites: [site],
        showScreenshot: true,
      })
    );
  }
  return out;
}

const JARGON_PATTERN = /\bRAWeb\b|\bRGAA\b|\bWCAG\b|\bRAAM\b|critère\s*\d/i;

function checkNoJargon(questions) {
  const offenders = questions.filter((q) => JARGON_PATTERN.test(q.prompt + " " + q.explanation));
  if (offenders.length > 0) {
    console.warn(`WARNING: ${offenders.length} question(s) contain jargon/criterion references:`);
    for (const o of offenders.slice(0, 5)) console.warn(`  - ${o.id}: ${o.prompt}`);
  }
  return offenders.length;
}

function checkChoicesContainAnswer(questions) {
  const bad = questions.filter((q) => !q.choices.includes(q.correctAnswer));
  if (bad.length > 0) {
    console.warn(`WARNING: ${bad.length} question(s) whose choices do not include the correct answer.`);
  }
  return bad.length;
}

async function main() {
  const bundle = JSON.parse(await readFile(SITES_FILE, "utf8"));
  const sites = bundle.sites;

  const generators = [
    genScoreThreshold,
    genCompareTwoSites,
    genWeakestTheme,
    genThemeCompliantOrNot,
    genDeclaredVsMeasured,
    genStatementUpdateTiming,
    genScoreImprovement,
    genPageCountOrScope,
  ];

  let pool = [];
  for (const gen of generators) {
    const questions = gen(sites);
    console.log(`${gen.name}: ${questions.length} questions`);
    pool = pool.concat(questions);
  }

  const jargonIssues = checkNoJargon(pool);
  const answerIssues = checkChoicesContainAnswer(pool);

  const byType = {};
  for (const q of pool) byType[q.type] = (byType[q.type] ?? 0) + 1;

  const output = {
    meta: {
      generatedAt: new Date().toISOString(),
      totalQuestions: pool.length,
      byType,
      jargonIssues,
      answerIssues,
    },
    questions: pool,
  };

  await writeFile(QUESTIONS_FILE, JSON.stringify(output, null, 2), "utf8");
  await copyFile(QUESTIONS_FILE, PUBLIC_QUESTIONS_FILE);

  console.log(`\nTotal question pool: ${pool.length} across ${Object.keys(byType).length} types`);
  console.log(byType);
  console.log(`Wrote ${QUESTIONS_FILE} and copied to ${PUBLIC_QUESTIONS_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
