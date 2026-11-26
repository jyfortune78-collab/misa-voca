// ===== 설정 =====
const START_DATE = "2026-11-26"; // 1일차 날짜 (한국 시간)
const PER_DAY = 5;               // 하루 단어 수
const OPEN_HOUR = 7;             // 매일 아침 7시(한국 시간)에 새 단어 공개
const DAY_MS = 86400000;

// ===== 날짜 계산 (한국 시간 기준, 아침 7시에 하루가 바뀜) =====
function kstNow() {
  const params = new URLSearchParams(location.search);
  if (params.get("date")) { // 테스트용: ?date=2026-12-01
    return new Date(params.get("date") + "T08:00:00Z");
  }
  return new Date(Date.now() + 9 * 3600000); // UTC 기준 값을 KST 시각으로 이동
}
function startMs() { return Date.parse(START_DATE + "T00:00:00Z"); }
function currentDayIndex() {
  const shifted = kstNow().getTime() - OPEN_HOUR * 3600000;
  return Math.max(0, Math.floor((shifted - startMs()) / DAY_MS));
}
function dateOfDay(d) { return new Date(startMs() + d * DAY_MS); }
function fmtDate(dt, withDay = true) {
  const days = "일월화수목금토";
  const s = `${dt.getUTCFullYear()}.${String(dt.getUTCMonth() + 1).padStart(2, "0")}.${String(dt.getUTCDate()).padStart(2, "0")}`;
  return withDay ? `${s} (${days[dt.getUTCDay()]})` : s;
}
function wordsOfDay(d) {
  const out = [];
  for (let i = 0; i < PER_DAY; i++) out.push(WORDS[(d * PER_DAY + i) % WORDS.length]);
  return out;
}

// ===== 외운 단어 저장 (내 기기에만) =====
const STORE_KEY = "misa14-learned";
function loadLearned() { try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) || "[]")); } catch { return new Set(); } }
function saveLearned(set) { try { localStorage.setItem(STORE_KEY, JSON.stringify([...set])); } catch {} }
let learned = loadLearned();

// ===== 발음 듣기 =====
// 1순위: 무료 사전 API의 원어민 녹음 / 2순위: 브라우저 음성(미국 영어)
const audioCache = {};
async function findRecording(word) {
  if (word in audioCache) return audioCache[word];
  audioCache[word] = null;
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (res.ok) {
      const data = await res.json();
      const urls = data.flatMap(e => (e.phonetics || []).map(p => p.audio)).filter(Boolean);
      audioCache[word] = urls.find(u => /-us\.mp3$/.test(u)) || urls[0] || null;
    }
  } catch {}
  return audioCache[word];
}
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find(v => v.lang === "en-US" && /Samantha|Google|Natural|Aria|Jenny/i.test(v.name))
      || voices.find(v => v.lang === "en-US") || voices.find(v => v.lang.startsWith("en"));
}
function tts(text, rate) {
  return new Promise(resolve => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US"; u.rate = rate;
    const v = pickVoice(); if (v) u.voice = v;
    u.onend = u.onerror = resolve;
    speechSynthesis.speak(u);
  });
}
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
async function speak(word, slow, btn) {
  btn && btn.classList.add("playing");
  try {
    const url = slow ? null : await findRecording(word);
    if (url) {
      const a = new Audio(url);
      await new Promise((res) => { a.onended = a.onerror = res; a.play().catch(res); });
    } else {
      await tts(word, slow ? 0.55 : 0.9);
    }
  } finally { btn && btn.classList.remove("playing"); }
}

// ===== 카드 그리기 =====
function esc(s) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function highlight(sentence, word) {
  const stem = word.length > 4 ? word.slice(0, word.length - 2) : word;
  const re = new RegExp(`\\b(${stem}\\w*)`, "i");
  return esc(sentence).replace(re, '<span class="hl">$1</span>');
}
function cardHTML(w, n) {
  const done = learned.has(w.w);
  return `
  <article class="card ${done ? "done" : ""}" data-word="${w.w}">
    <div class="card-top">
      <span class="card-num">${n}</span>
      <span class="word">${w.w}</span>
      <span class="ipa">${w.p}</span>
      <span class="pos">${w.pos}</span>
      <div class="speak">
        <button data-say="${w.w}" title="원어민 발음 듣기">🔊 발음 듣기</button>
        <button data-say="${w.w}" data-slow="1" title="천천히 듣기">🐢 천천히</button>
      </div>
    </div>
    <div class="card-body">
      <div><span class="row-label">뜻</span><div class="meaning">${w.m}</div></div>
      <div class="etym"><span class="row-label">어원 이야기</span><p>${esc(w.e)}</p></div>
      <div class="example"><span class="row-label">예문</span>
        <p class="en">${highlight(w.ex, w.w)}
          <button class="mini" data-say-sentence="${esc(w.ex)}" title="예문 듣기" style="border:0;background:none;cursor:pointer;font-size:16px">🔈</button></p>
        <p class="ko">${w.exk}</p>
      </div>
      <div class="card-foot">
        <label class="check"><input type="checkbox" data-learn="${w.w}" ${done ? "checked" : ""}> 외웠어!</label>
      </div>
    </div>
  </article>`;
}

// ===== 오늘의 단어 =====
function renderToday() {
  const d = currentDayIndex();
  const words = wordsOfDay(d);
  document.getElementById("dayBadge").textContent = `${d + 1}일차 · ${fmtDate(dateOfDay(d))}`;
  document.getElementById("todayCards").innerHTML = words.map((w, i) => cardHTML(w, i + 1)).join("");
  updateProgress();
}
function updateProgress() {
  const d = currentDayIndex();
  const seen = new Set();
  for (let i = 0; i <= d; i++) wordsOfDay(i).forEach(w => seen.add(w.w));
  const n = [...seen].filter(w => learned.has(w)).length;
  document.getElementById("progressText").textContent = `내가 외운 단어 ${n} / ${seen.size}`;
  document.getElementById("progressBar").style.width = `${seen.size ? (n / seen.size) * 100 : 0}%`;
}

// ===== 지난 단어 게시판 =====
function renderArchive() {
  const d = currentDayIndex();
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const rows = [];
  for (let i = d; i >= 0; i--) {
    const ws = wordsOfDay(i);
    if (q && !ws.some(w => (w.w + w.m + w.e).toLowerCase().includes(q))) continue;
    rows.push(`<tr class="day-row ${i === d ? "new" : ""}" data-day="${i}">
      <td>${i + 1}</td><td>${fmtDate(dateOfDay(i), false)}</td>
      <td class="words">${ws.map(w => w.w).join(", ")}</td>
      <td class="preview col-hide">${ws.map(w => w.m.split(",")[0]).join(" · ")}</td></tr>`);
  }
  document.getElementById("archiveBody").innerHTML = rows.join("") ||
    `<tr><td colspan="4" class="empty">검색 결과가 없어.</td></tr>`;
}
function toggleArchiveDay(tr) {
  const next = tr.nextElementSibling;
  if (next && next.classList.contains("detail-row")) { next.remove(); tr.classList.remove("open"); return; }
  const d = +tr.dataset.day;
  const detail = document.createElement("tr");
  detail.className = "detail-row";
  detail.innerHTML = `<td colspan="4"><div class="cards">${wordsOfDay(d).map((w, i) => cardHTML(w, i + 1)).join("")}</div></td>`;
  tr.after(detail); tr.classList.add("open");
}

// ===== 퀴즈 =====
let quiz = null;
function shuffle(a) { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function startQuiz(kind) {
  const d = currentDayIndex();
  let pool;
  if (kind === "today") pool = wordsOfDay(d);
  else { const m = new Map(); for (let i = 0; i <= d; i++) wordsOfDay(i).forEach(w => m.set(w.w, w)); pool = shuffle([...m.values()]).slice(0, 10); }
  quiz = { items: shuffle(pool), i: 0, score: 0 };
  showQuestion();
}
function showQuestion() {
  const area = document.getElementById("quizArea");
  if (quiz.i >= quiz.items.length) {
    const t = quiz.items.length, s = quiz.score;
    const msg = s === t ? "완벽해! 🎉" : s >= t * 0.6 ? "잘했어! 조금만 더 👍" : "어원 이야기를 한 번 더 읽어 볼까? 💪";
    area.innerHTML = `<div class="quiz-result"><div class="score">${s} / ${t}</div><p>${msg}</p>
      <button class="btn" data-quiz="again">다시 풀기</button></div>`;
    return;
  }
  const w = quiz.items[quiz.i];
  const wrong = shuffle(WORDS.filter(x => x.w !== w.w)).slice(0, 3);
  const choices = shuffle([w, ...wrong]);
  area.innerHTML = `
    <div class="quiz-q">문제 ${quiz.i + 1} / ${quiz.items.length} · 알맞은 뜻을 골라 봐</div>
    <div class="quiz-word">${w.w} <button data-say="${w.w}" title="발음 듣기">🔊</button></div>
    <div class="ipa">${w.p}</div>
    <div class="choices">${choices.map(c => `<button class="choice" data-ans="${c.w === w.w ? 1 : 0}">${c.m}</button>`).join("")}</div>
    <div id="quizFeedback"></div>`;
}
function answer(btn) {
  const w = quiz.items[quiz.i];
  const right = btn.dataset.ans === "1";
  if (right) quiz.score++;
  document.querySelectorAll(".choice").forEach(b => { b.disabled = true; if (b.dataset.ans === "1") b.classList.add("right"); });
  if (!right) btn.classList.add("wrong");
  document.getElementById("quizFeedback").innerHTML = `
    <div class="quiz-hint"><b>${right ? "정답! ⭕" : "아쉽다 ❌"}</b> ${esc(w.e)}</div>
    <button class="btn quiz-next" data-quiz="next">${quiz.i + 1 < quiz.items.length ? "다음 문제 →" : "결과 보기"}</button>`;
}

// ===== 탭 이동 =====
function showTab() {
  const tab = (location.hash || "#today").slice(1);
  const valid = ["today", "archive", "quiz", "about"].includes(tab) ? tab : "today";
  document.querySelectorAll(".tab").forEach(s => s.hidden = s.id !== `tab-${valid}`);
  document.querySelectorAll(".gnb a").forEach(a => a.classList.toggle("active", a.dataset.tab === valid));
  document.getElementById("gnb").classList.remove("open");
  if (valid === "archive") renderArchive();
  if (valid === "today") renderToday();
}

// ===== 다음 공개까지 카운트다운 =====
function tickCountdown() {
  const now = kstNow().getTime();
  const shifted = now - OPEN_HOUR * 3600000;
  const nextOpen = Math.max(Math.floor((shifted - startMs()) / DAY_MS) + 1, 0) * DAY_MS + startMs() + OPEN_HOUR * 3600000;
  let left = Math.max(0, nextOpen - now);
  const h = Math.floor(left / 3600000), m = Math.floor(left % 3600000 / 60000), s = Math.floor(left % 60000 / 1000);
  document.getElementById("countdown").textContent = `⏰ 다음 단어 공개까지 ${h}시간 ${String(m).padStart(2, "0")}분 ${String(s).padStart(2, "0")}초`;
  if (left < 1000) setTimeout(() => { showTab(); }, 1500);
}

// ===== 이벤트 =====
document.addEventListener("click", e => {
  const say = e.target.closest("[data-say]");
  if (say) { speak(say.dataset.say, !!say.dataset.slow, say); return; }
  const sent = e.target.closest("[data-say-sentence]");
  if (sent) { tts(sent.dataset.saySentence, 0.85); return; }
  const row = e.target.closest("tr.day-row");
  if (row) { toggleArchiveDay(row); return; }
  const choice = e.target.closest(".choice");
  if (choice && !choice.disabled) { answer(choice); return; }
  const qb = e.target.closest("[data-quiz]");
  if (qb) {
    const k = qb.dataset.quiz;
    if (k === "next") { quiz.i++; showQuestion(); }
    else if (k === "again") { quiz.items = shuffle(quiz.items); quiz.i = 0; quiz.score = 0; showQuestion(); }
    else startQuiz(k);
  }
});
document.addEventListener("change", e => {
  const cb = e.target.closest("[data-learn]");
  if (!cb) return;
  cb.checked ? learned.add(cb.dataset.learn) : learned.delete(cb.dataset.learn);
  saveLearned(learned);
  document.querySelectorAll(`.card[data-word="${cb.dataset.learn}"]`).forEach(c => c.classList.toggle("done", cb.checked));
  updateProgress();
});
document.getElementById("searchInput").addEventListener("input", renderArchive);
document.getElementById("menuBtn").addEventListener("click", () => document.getElementById("gnb").classList.toggle("open"));
window.addEventListener("hashchange", () => { showTab(); window.scrollTo({ top: 0 }); });

document.getElementById("todayLabel").textContent = `오늘은 ${fmtDate(kstNow())}`;
showTab();
tickCountdown(); setInterval(tickCountdown, 1000);
document.getElementById("quizArea").innerHTML = `<p class="empty">위 버튼을 눌러서 퀴즈를 시작해 봐!</p>`;
