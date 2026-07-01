import { fixFrenchSpacing } from "./typography.js";

const SESSION_SIZE = 10;
const MIN_TYPES = 6;
const STALE_DAYS = 365;
const THEME_COMPLIANT_TYPE = "theme-compliant-or-not";
const THEME_COMPLIANT_RATIO = 1 / 3;
const SCORE_THRESHOLD_TYPE = "score-threshold";
const SCORE_THRESHOLD_MAX = 1;

const el = {
  errorBanner: document.getElementById("error-banner"),
  screenStart: document.getElementById("screen-start"),
  screenQuiz: document.getElementById("screen-quiz"),
  screenEnd: document.getElementById("screen-end"),
  btnStart: document.getElementById("btn-start"),
  btnNext: document.getElementById("btn-next"),
  btnReplay: document.getElementById("btn-replay"),
  progressText: document.getElementById("progress-text"),
  scoreText: document.getElementById("score-text"),
  timerBar: document.getElementById("timer-bar"),
  timerAnnouncer: document.getElementById("timer-announcer"),
  staleWarning: document.getElementById("stale-warning"),
  questionPrompt: document.getElementById("question-prompt"),
  questionMedia: document.getElementById("question-media"),
  questionLinks: document.getElementById("question-links"),
  choices: document.getElementById("choices"),
  reveal: document.getElementById("reveal"),
  revealText: document.getElementById("reveal-text"),
  revealLinks: document.getElementById("reveal-links"),
  finalScore: document.getElementById("final-score"),
  endHeading: document.getElementById("end-heading"),
};

const OBSERVATORY_BASE_URL = "https://observatoire.accessibilite.public.lu/fr";

let pool = [];
let session = [];
let currentIndex = 0;
let score = 0;
let timerId = null;
let timeLeft = 0;
let answered = false;

function showError(message) {
  el.errorBanner.textContent = message;
  el.errorBanner.hidden = false;
}

function showScreen(name) {
  for (const s of [el.screenStart, el.screenQuiz, el.screenEnd]) {
    s.hidden = true;
  }
  ({ start: el.screenStart, quiz: el.screenQuiz, end: el.screenEnd })[name].hidden = false;
}

function daysSince(dateStr) {
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function formatAuditDate(dateStr) {
  return new Date(dateStr).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function assembleSession(questionPool) {
  const byType = new Map();
  for (const q of questionPool) {
    if (!byType.has(q.type)) byType.set(q.type, []);
    byType.get(q.type).push(q);
  }

  const picked = [];
  const usedIds = new Set();
  const typesSoFar = new Set();
  let lastAuditId = null;

  function takeFrom(list) {
    for (const q of shuffle(list)) {
      if (usedIds.has(q.id)) continue;
      if (q.sites[0]?.auditId === lastAuditId && list.length > 1) continue;
      return q;
    }
    return list.find((q) => !usedIds.has(q.id)) ?? null;
  }

  function pick(q) {
    picked.push(q);
    usedIds.add(q.id);
    typesSoFar.add(q.type);
    lastAuditId = q.sites[0]?.auditId ?? null;
  }

  // "Vrai/faux" theme questions should make up about a third of the session.
  const themePool = byType.get(THEME_COMPLIANT_TYPE) || [];
  const themeTarget = Math.min(Math.round(SESSION_SIZE * THEME_COMPLIANT_RATIO), themePool.length);
  for (let i = 0; i < themeTarget; i++) {
    const q = takeFrom(themePool);
    if (q) pick(q);
  }

  // The compliance-rate multiple-choice question should appear at most once.
  const scoreThresholdPool = byType.get(SCORE_THRESHOLD_TYPE) || [];
  for (let i = 0; i < SCORE_THRESHOLD_MAX && scoreThresholdPool.length > 0; i++) {
    const q = takeFrom(scoreThresholdPool);
    if (q) pick(q);
  }

  const remainingTypes = shuffle(
    [...byType.keys()].filter((t) => t !== THEME_COMPLIANT_TYPE && t !== SCORE_THRESHOLD_TYPE)
  );
  for (const type of remainingTypes) {
    if (typesSoFar.size >= MIN_TYPES || picked.length >= SESSION_SIZE) break;
    const q = takeFrom(byType.get(type));
    if (q) pick(q);
  }

  const remainingPool = shuffle(
    questionPool.filter(
      (q) => !usedIds.has(q.id) && q.type !== SCORE_THRESHOLD_TYPE && q.type !== THEME_COMPLIANT_TYPE
    )
  );
  for (const q of remainingPool) {
    if (picked.length >= SESSION_SIZE) break;
    if (q.sites[0]?.auditId === lastAuditId) continue;
    picked.push(q);
    usedIds.add(q.id);
    lastAuditId = q.sites[0]?.auditId ?? null;
  }
  // Fill up if we still lack questions (e.g. small pool)
  for (const q of remainingPool) {
    if (picked.length >= SESSION_SIZE) break;
    if (usedIds.has(q.id)) continue;
    picked.push(q);
    usedIds.add(q.id);
  }

  return shuffle(picked).slice(0, SESSION_SIZE);
}

function clearTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer(seconds, onExpire) {
  clearTimer();
  timeLeft = seconds;
  updateTimerDisplay(seconds, seconds);
  timerId = setInterval(() => {
    timeLeft -= 1;
    updateTimerDisplay(timeLeft, seconds);
    if (timeLeft === 10) {
      el.timerAnnouncer.textContent = "Il reste 10 secondes.";
    }
    if (timeLeft <= 0) {
      clearTimer();
      onExpire();
    }
  }, 1000);
}

function updateTimerDisplay(remaining, total) {
  const pct = Math.max(0, (remaining / total) * 100);
  el.timerBar.style.width = `${pct}%`;
  el.timerBar.classList.toggle("timer-low", remaining <= Math.ceil(total * 0.25));
}

function renderStaleWarning(question) {
  const staleSites = question.sites.filter((s) => daysSince(s.auditedAt) > STALE_DAYS);
  if (staleSites.length === 0) {
    el.staleWarning.hidden = true;
    el.staleWarning.textContent = "";
    return;
  }
  el.staleWarning.hidden = false;
  if (staleSites.length === 1) {
    const [site] = staleSites;
    el.staleWarning.textContent = `Attention : l'audit de "${site.name}" date de : ${formatAuditDate(site.auditedAt)}. La situation actuelle du site a pu évoluer depuis.`;
  } else {
    const names = staleSites.map((s) => `${s.name} (${formatAuditDate(s.auditedAt)})`).join(", ");
    el.staleWarning.textContent = `Attention : les audits de ${names} datent de plus d'un an. La situation actuelle de ces sites a pu évoluer depuis.`;
  }
}

function renderMedia(question) {
  el.questionMedia.innerHTML = "";
  if (!question.showScreenshot) return;
  for (const site of question.sites) {
    if (!site.screenshot) continue;
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = site.screenshot;
    img.alt = `Capture d'écran de la page d'accueil du site ${site.name}`;
    img.addEventListener("error", () => figure.remove());
    const caption = document.createElement("figcaption");
    caption.textContent = site.name;
    figure.appendChild(img);
    figure.appendChild(caption);
    el.questionMedia.appendChild(figure);
  }
}

function isSafeHttpUrl(href) {
  try {
    return ["http:", "https:"].includes(new URL(href, window.location.href).protocol);
  } catch {
    return false;
  }
}

// Rejects anything but http(s) hrefs (e.g. a stray "javascript:" URI in the
// question data) since this helper is used to render links built from
// third-party audit data.
function makeNewTabLink(href, text) {
  const a = document.createElement("a");
  a.href = isSafeHttpUrl(href) ? href : "#";
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = text;
  return a;
}

function renderLinks(question) {
  el.questionLinks.innerHTML = "";
  for (const site of question.sites) {
    el.questionLinks.appendChild(
      makeNewTabLink(site.homeUri, `Ouvrir "${site.name}" dans un nouvel onglet`)
    );
    // This question is about the declaration's content, so let people go
    // read it directly rather than only the site's homepage.
    if (question.type === "statement-update-timing" && site.statementUri) {
      el.questionLinks.appendChild(
        makeNewTabLink(
          site.statementUri,
          `Ouvrir la déclaration d'accessibilité de "${site.name}"`
        )
      );
    }
  }
}

function renderRevealLinks(question) {
  el.revealLinks.innerHTML = "";
  for (const site of question.sites) {
    el.revealLinks.appendChild(
      makeNewTabLink(
        `${OBSERVATORY_BASE_URL}/details_${site.auditId}`,
        `Voir l'audit officiel de "${site.name}" sur l'Observatoire`
      )
    );
  }
}

function renderChoices(question) {
  el.choices.innerHTML = "";
  for (const choice of question.choices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "choice-btn";
    btn.dataset.choice = choice;
    const label = document.createElement("span");
    label.textContent = choice;
    btn.appendChild(label);
    btn.addEventListener("click", () => handleAnswer(choice));
    el.choices.appendChild(btn);
  }
}

// Marks answer state without relying on colour alone: adds a visible
// symbol plus a screen-reader-only word, since this is an accessibility quiz.
function markChoiceButtons(question, selected) {
  for (const btn of el.choices.querySelectorAll(".choice-btn")) {
    btn.disabled = true;
    const isCorrectBtn = btn.dataset.choice === question.correctAnswer;
    const isSelectedBtn = selected != null && btn.dataset.choice === selected;
    if (isCorrectBtn) {
      btn.classList.add("correct");
      appendMarker(btn, "✓", "(bonne réponse)");
    } else if (isSelectedBtn) {
      btn.classList.add("incorrect");
      appendMarker(btn, "✗", "(réponse incorrecte)");
    }
  }
}

function appendMarker(btn, symbol, srWords) {
  const marker = document.createElement("span");
  marker.className = "choice-marker";
  marker.setAttribute("aria-hidden", "true");
  marker.textContent = ` ${symbol}`;
  btn.appendChild(marker);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = ` ${srWords}`;
  btn.appendChild(sr);
}

function handleAnswer(selected) {
  if (answered) return;
  answered = true;
  clearTimer();
  const question = session[currentIndex];
  const isCorrect = selected === question.correctAnswer;
  if (isCorrect) score++;

  markChoiceButtons(question, selected);

  el.scoreText.textContent = `Score : ${score}`;
  el.revealText.textContent = isCorrect
    ? `Bonne réponse ! ${question.explanation}`
    : `Ce n'était pas la bonne réponse. La bonne réponse était : "${question.correctAnswer}". ${question.explanation}`;
  renderRevealLinks(question);
  el.reveal.hidden = false;
  fixFrenchSpacing(el.reveal);
  el.btnNext.focus();
}

function handleTimeout() {
  if (answered) return;
  answered = true;
  const question = session[currentIndex];
  markChoiceButtons(question, null);
  el.timerAnnouncer.textContent = "Temps écoulé.";
  el.revealText.textContent = `Temps écoulé ! La bonne réponse était : "${question.correctAnswer}". ${question.explanation}`;
  renderRevealLinks(question);
  el.reveal.hidden = false;
  fixFrenchSpacing(el.reveal);
  el.btnNext.focus();
}

function renderQuestion() {
  const question = session[currentIndex];
  answered = false;
  el.reveal.hidden = true;
  el.timerAnnouncer.textContent = "";
  el.progressText.textContent = `Question ${currentIndex + 1} / ${session.length}`;
  el.questionPrompt.textContent = question.prompt;
  renderStaleWarning(question);
  renderMedia(question);
  renderLinks(question);
  renderChoices(question);
  fixFrenchSpacing(el.screenQuiz);
  startTimer(question.timeLimitSeconds, handleTimeout);
  // Move focus to the new question so keyboard/screen-reader users aren't
  // left on a now-hidden "Next" button after the screen/question changes.
  el.questionPrompt.focus();
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex >= session.length) {
    endSession();
    return;
  }
  renderQuestion();
}

function endSession() {
  clearTimer();
  showScreen("end");
  el.finalScore.textContent = `Vous avez obtenu ${score} / ${session.length} bonnes réponses.`;
  fixFrenchSpacing(el.screenEnd);
  el.endHeading.focus();
}

function startSession() {
  session = assembleSession(pool);
  currentIndex = 0;
  score = 0;
  el.scoreText.textContent = "Score : 0";
  showScreen("quiz");
  renderQuestion();
}

async function init() {
  el.btnStart.addEventListener("click", startSession);
  el.btnNext.addEventListener("click", nextQuestion);
  el.btnReplay.addEventListener("click", startSession);

  try {
    const res = await fetch("./questions.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    pool = data.questions ?? [];
    if (pool.length === 0) {
      showError("Aucune question disponible pour le moment. Veuillez réessayer plus tard.");
      el.btnStart.disabled = true;
    }
  } catch (err) {
    showError(
      "Impossible de charger les questions du quiz. Vérifiez votre connexion et réessayez plus tard."
    );
    el.btnStart.disabled = true;
  }
}

init();
