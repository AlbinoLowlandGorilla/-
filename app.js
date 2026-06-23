/* ============================================================
   복습플랜 — 공부시간 체크 + 복습 진도 관리
   순수 JS + localStorage (서버/설치 불필요)
   ============================================================ */

const STORE_KEY = 'review-plan-v1';

/* ---------- 데이터 ---------- */
const defaultData = { lessons: [], logs: [] };
let data = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return structuredClone(defaultData);
    const parsed = JSON.parse(raw);
    return { lessons: parsed.lessons || [], logs: parsed.logs || [] };
  } catch (e) {
    return structuredClone(defaultData);
  }
}
function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(data));
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 날짜 유틸 ---------- */
const DAY = 86400000;
function todayStr() { return toISO(new Date()); }
function toISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / DAY); }
function addDays(iso, n) { return toISO(parseISO(iso).getTime() + n * DAY); }
function fmtKDate(iso) {
  const d = parseISO(iso);
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${w})`;
}

/* ============================================================
   복습 일정 생성 (Spaced Repetition)
   수업일 ~ 시험일 사이 기간에 맞춰 "적절한 횟수"의 복습을 배치.
   - 기본 간격: 1, 3, 7, 14, 30일 (망각곡선 기반)
   - 시험까지 기간이 길면 복습 횟수↑, 짧으면 핵심만 압축
   - 시험 전날(또는 당일)은 항상 최종 복습으로 포함
   ============================================================ */
function buildSchedule(classDate, examDate) {
  const total = daysBetween(classDate, examDate);
  if (total <= 0) {
    // 시험이 수업일 이전/당일이면 당일 한 번만
    return [{ date: classDate, done: false }];
  }

  const intervals = [1, 3, 7, 14, 30];
  const dates = [];

  for (const iv of intervals) {
    if (iv < total) dates.push(addDays(classDate, iv));
  }

  // 시험 직전 마지막 점검 (시험 전날, 기간이 짧으면 시험 당일)
  const lastReview = total >= 2 ? addDays(examDate, -1) : examDate;

  // 기간이 매우 짧을 때(<=2일) 최소 1회는 보장
  if (dates.length === 0) dates.push(addDays(classDate, Math.max(1, Math.floor(total / 2))));

  // 중복 제거 + 정렬 + 시험일 이내로 제한
  const set = new Set(dates.filter(d => daysBetween(d, examDate) >= 0));
  set.add(lastReview);
  const sorted = [...set].sort((a, b) => parseISO(a) - parseISO(b));

  return sorted.map(date => ({ date, done: false }));
}

/* ---------- 복습 상태 판정 ---------- */
function reviewState(date, done) {
  if (done) return 'done';
  const diff = daysBetween(todayStr(), date); // 양수면 미래
  if (diff < 0) return 'over';   // 지난 날인데 안함 → 밀림
  if (diff === 0) return 'due';  // 오늘 할 차례
  return 'upcoming';
}

/* ============================================================
   렌더링
   ============================================================ */
const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function renderAll() {
  renderDashboard();
  renderLessons();
  renderTimerSubjects();
  renderTodayStudy();
  renderStats();
  refreshSubjectSuggest();
}

/* --- 대시보드 --- */
function renderDashboard() {
  $('#todayLabel').textContent = fmtKDate(todayStr()) + ' · 오늘도 화이팅! 🔥';

  // 오늘 + 밀린 복습 항목
  const due = [];
  data.lessons.forEach(les => {
    les.reviews.forEach((r, i) => {
      const st = reviewState(r.date, r.done);
      if (st === 'due' || st === 'over') due.push({ les, r, i, st });
    });
  });
  $('#dashTodayReviews').textContent = due.length;

  const todayMin = Math.round(studySecondsOn(todayStr()) / 60);
  $('#dashTodayStudy').textContent = todayMin + '분';

  const dl = $('#dashReviewList');
  if (due.length === 0) {
    dl.innerHTML = emptyMsg('오늘 밀린 복습이 없어요. 완벽해요! ✨');
  } else {
    dl.innerHTML = due
      .sort((a, b) => (a.st === 'over' ? -1 : 1))
      .map(({ les, r, i, st }) => `
      <div class="item">
        <div class="item-main">
          <div class="item-title">${esc(les.subject)} · ${esc(les.topic)}</div>
          <div class="item-sub">${st === 'over' ? `⚠️ ${Math.abs(daysBetween(todayStr(), r.date))}일 밀림` : '오늘 복습 차례'}</div>
        </div>
        <button class="btn primary" style="padding:8px 14px" onclick="quickDone('${les.id}',${i})">완료</button>
      </div>`).join('');
  }

  // 다가오는 시험
  const exams = [...new Map(
    data.lessons
      .filter(l => daysBetween(todayStr(), l.examDate) >= 0)
      .map(l => [l.subject + l.examDate, l])
  ).values()].sort((a, b) => parseISO(a.examDate) - parseISO(b.examDate));

  $('#dashExamList').innerHTML = exams.length
    ? exams.slice(0, 5).map(l => {
        const dleft = daysBetween(todayStr(), l.examDate);
        return `<div class="item">
          <div class="item-main">
            <div class="item-title">${esc(l.subject)} 시험</div>
            <div class="item-sub">${fmtKDate(l.examDate)}</div>
          </div>
          <span class="item-badge ${dleft <= 3 ? 'badge-over' : 'badge-today'}">D-${dleft === 0 ? 'DAY' : dleft}</span>
        </div>`;
      }).join('')
    : emptyMsg('등록된 시험이 없어요. 복습 탭에서 추가해 보세요.');
}

/* --- 복습 목록 --- */
let lessonFilter = 'all';
function renderLessons() {
  const wrap = $('#lessonList');
  let list = [...data.lessons];

  if (lessonFilter === 'today') {
    list = list.filter(l => l.reviews.some(r => reviewState(r.date, r.done) === 'due'));
  } else if (lessonFilter === 'overdue') {
    list = list.filter(l => l.reviews.some(r => reviewState(r.date, r.done) === 'over'));
  } else if (lessonFilter === 'done') {
    list = list.filter(l => l.reviews.every(r => r.done));
  }

  list.sort((a, b) => parseISO(a.examDate) - parseISO(b.examDate));

  if (list.length === 0) {
    wrap.innerHTML = emptyMsg('해당하는 수업 내용이 없어요.');
    return;
  }

  wrap.innerHTML = list.map(les => {
    const doneCount = les.reviews.filter(r => r.done).length;
    const pct = Math.round((doneCount / les.reviews.length) * 100);
    const dleft = daysBetween(todayStr(), les.examDate);

    const track = les.reviews.map((r, i) => {
      const st = reviewState(r.date, r.done);
      const cls = r.done ? 'done' : st === 'due' ? 'due' : st === 'over' ? 'over' : '';
      return `<div class="rev ${cls}" onclick="toggleReview('${les.id}',${i})">
        <span class="rev-n">${r.done ? '✓' : i + 1 + '차'}</span>
        <span class="rev-d">${parseISO(r.date).getMonth() + 1}/${parseISO(r.date).getDate()}</span>
      </div>`;
    }).join('');

    return `<div class="lesson">
      <div class="lesson-head">
        <div class="item-main">
          <div class="item-title">${esc(les.topic)}</div>
          <div class="item-sub">${esc(les.subject)} · 시험 ${fmtKDate(les.examDate)} (${dleft < 0 ? '종료' : 'D-' + (dleft === 0 ? 'DAY' : dleft)})</div>
        </div>
        <span class="item-badge ${pct === 100 ? 'badge-done' : 'badge-sub'}">${doneCount}/${les.reviews.length}</span>
      </div>
      ${les.note ? `<div class="lesson-note">📝 ${esc(les.note)}</div>` : ''}
      <div class="review-track">${track}</div>
      <div class="lesson-progress"><span style="width:${pct}%"></span></div>
      <div class="lesson-foot">
        <small>복습 진행률 ${pct}%</small>
        <button class="link-del" onclick="deleteLesson('${les.id}')">삭제</button>
      </div>
    </div>`;
  }).join('');
}

/* --- 타이머 과목 셀렉트 --- */
function renderTimerSubjects() {
  const subs = subjectsList();
  const sel = $('#timerSubject');
  const cur = sel.value;
  sel.innerHTML = (subs.length ? subs : ['공부'])
    .map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')
    + `<option value="__기타">+ 기타 직접입력</option>`;
  if (cur) sel.value = cur;
}

/* --- 오늘 공부 기록 --- */
function renderTodayStudy() {
  const today = todayStr();
  const logs = data.logs.filter(l => l.date === today);
  const wrap = $('#todayStudyList');
  if (logs.length === 0) {
    wrap.innerHTML = emptyMsg('오늘 기록이 아직 없어요. 타이머를 시작해 보세요!');
    return;
  }
  // 과목별 합산
  const bySub = {};
  logs.forEach(l => { bySub[l.subject] = (bySub[l.subject] || 0) + l.seconds; });
  const totalMin = Math.round(Object.values(bySub).reduce((a, b) => a + b, 0) / 60);
  wrap.innerHTML = Object.entries(bySub)
    .sort((a, b) => b[1] - a[1])
    .map(([sub, sec]) => `<div class="item">
      <div class="item-main"><div class="item-title">${esc(sub)}</div></div>
      <span class="item-badge badge-sub">${fmtDur(sec)}</span>
    </div>`).join('')
    + `<div class="item" style="background:var(--primary-soft)">
        <div class="item-main"><div class="item-title">오늘 합계</div></div>
        <span class="item-badge badge-sub">${totalMin}분</span>
      </div>`;
}

/* --- 통계 --- */
function renderStats() {
  // 최근 7일 막대그래프
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(addDays(todayStr(), -i));
  const vals = days.map(d => studySecondsOn(d) / 60);
  const max = Math.max(60, ...vals);
  $('#weekChart').innerHTML = days.map((d, i) => {
    const h = Math.round((vals[i] / max) * 100);
    const lbl = ['일', '월', '화', '수', '목', '금', '토'][parseISO(d).getDay()];
    return `<div class="bar-col">
      <span class="bar-val">${Math.round(vals[i])}</span>
      <div class="bar" style="height:${h}%"></div>
      <span class="bar-lbl">${lbl}</span>
    </div>`;
  }).join('');

  // 과목별 누적
  const bySub = {};
  data.logs.forEach(l => { bySub[l.subject] = (bySub[l.subject] || 0) + l.seconds; });
  const ent = Object.entries(bySub).sort((a, b) => b[1] - a[1]);
  $('#subjectStats').innerHTML = ent.length
    ? ent.map(([s, sec]) => `<div class="item">
        <div class="item-main"><div class="item-title">${esc(s)}</div></div>
        <span class="item-badge badge-sub">${fmtDur(sec)}</span></div>`).join('')
    : emptyMsg('아직 공부 기록이 없어요.');

  // 복습 진행률
  $('#reviewProgress').innerHTML = data.lessons.length
    ? data.lessons.map(l => {
        const done = l.reviews.filter(r => r.done).length;
        const pct = Math.round((done / l.reviews.length) * 100);
        return `<div class="item">
          <div class="item-main">
            <div class="item-title">${esc(l.subject)} · ${esc(l.topic)}</div>
            <div class="lesson-progress" style="margin-top:8px"><span style="width:${pct}%"></span></div>
          </div>
          <span class="item-badge ${pct === 100 ? 'badge-done' : 'badge-sub'}">${pct}%</span>
        </div>`;
      }).join('')
    : emptyMsg('등록된 복습이 없어요.');
}

/* ---------- 보조 ---------- */
function subjectsList() {
  const s = new Set();
  data.lessons.forEach(l => s.add(l.subject));
  data.logs.forEach(l => s.add(l.subject));
  return [...s].filter(Boolean);
}
function refreshSubjectSuggest() {
  $('#subjectSuggest').innerHTML = subjectsList().map(s => `<option value="${esc(s)}">`).join('');
}
function studySecondsOn(iso) {
  return data.logs.filter(l => l.date === iso).reduce((a, b) => a + b.seconds, 0);
}
function fmtDur(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function emptyMsg(t) { return `<div class="empty">${t}</div>`; }

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1900);
}

/* ============================================================
   액션 (전역 노출: onclick 사용)
   ============================================================ */
window.toggleReview = (id, i) => {
  const les = data.lessons.find(l => l.id === id);
  if (!les) return;
  les.reviews[i].done = !les.reviews[i].done;
  save();
  renderAll();
};
window.quickDone = (id, i) => {
  const les = data.lessons.find(l => l.id === id);
  if (!les) return;
  les.reviews[i].done = true;
  save();
  toast('복습 완료! 잘했어요 👏');
  renderAll();
};
window.deleteLesson = (id) => {
  if (!confirm('이 수업 내용을 삭제할까요?')) return;
  data.lessons = data.lessons.filter(l => l.id !== id);
  save();
  toast('삭제했어요');
  renderAll();
};

/* ============================================================
   탭 전환
   ============================================================ */
$('#tabbar').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  $$('.tab').forEach(t => t.classList.toggle('active', t === btn));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + btn.dataset.tab));
});

/* 필터 칩 */
$('.filter-row').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.chip').forEach(c => c.classList.toggle('active', c === chip));
  lessonFilter = chip.dataset.filter;
  renderLessons();
});

/* ============================================================
   수업 추가 모달
   ============================================================ */
const lessonModal = $('#lessonModal');
function openLessonModal() {
  $('#f_subject').value = '';
  $('#f_topic').value = '';
  $('#f_note').value = '';
  $('#f_classDate').value = todayStr();
  $('#f_examDate').value = addDays(todayStr(), 14);
  updateSchedulePreview();
  lessonModal.hidden = false;
}
$('#openAddLesson').addEventListener('click', openLessonModal);
$('#lessonCancel').addEventListener('click', () => (lessonModal.hidden = true));
lessonModal.addEventListener('click', e => { if (e.target === lessonModal) lessonModal.hidden = true; });

['#f_classDate', '#f_examDate'].forEach(s => $(s).addEventListener('change', updateSchedulePreview));
function updateSchedulePreview() {
  const c = $('#f_classDate').value, ex = $('#f_examDate').value;
  if (!c || !ex) { $('#schedulePreview').textContent = ''; return; }
  if (daysBetween(c, ex) < 0) { $('#schedulePreview').textContent = '⚠️ 시험일이 수업일보다 빠릅니다.'; return; }
  const sch = buildSchedule(c, ex);
  $('#schedulePreview').textContent =
    `🔁 시험 전까지 총 ${sch.length}번 복습 추천 → ` +
    sch.map(r => `${parseISO(r.date).getMonth() + 1}/${parseISO(r.date).getDate()}`).join(', ');
}

$('#lessonSave').addEventListener('click', () => {
  const subject = $('#f_subject').value.trim();
  const topic = $('#f_topic').value.trim();
  const note = $('#f_note').value.trim();
  const classDate = $('#f_classDate').value;
  const examDate = $('#f_examDate').value;

  if (!subject) return toast('과목을 입력해 주세요');
  if (!topic) return toast('배운 내용을 입력해 주세요');
  if (!classDate || !examDate) return toast('날짜를 입력해 주세요');
  if (daysBetween(classDate, examDate) < 0) return toast('시험일을 수업일 이후로 설정해 주세요');

  data.lessons.push({
    id: uid(),
    subject, topic, note,
    classDate, examDate,
    reviews: buildSchedule(classDate, examDate),
    createdAt: Date.now(),
  });
  save();
  lessonModal.hidden = true;
  toast('복습 일정을 만들었어요 ✅');
  renderAll();
});

/* ============================================================
   타이머 (스톱워치)
   ============================================================ */
let timerSec = 0, timerHandle = null, timerRunning = false;
const tDisp = $('#timerDisplay');
function paintTimer() {
  const h = String(Math.floor(timerSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((timerSec % 3600) / 60)).padStart(2, '0');
  const s = String(timerSec % 60).padStart(2, '0');
  tDisp.textContent = `${h}:${m}:${s}`;
}
function setTimerButtons() {
  $('#timerStart').disabled = timerRunning;
  $('#timerPause').disabled = !timerRunning;
  $('#timerStop').disabled = timerSec === 0;
}
$('#timerStart').addEventListener('click', () => {
  if (timerRunning) return;
  timerRunning = true;
  timerHandle = setInterval(() => { timerSec++; paintTimer(); }, 1000);
  setTimerButtons();
});
$('#timerPause').addEventListener('click', () => {
  timerRunning = false;
  clearInterval(timerHandle);
  setTimerButtons();
});
$('#timerStop').addEventListener('click', () => {
  if (timerSec < 1) return;
  timerRunning = false;
  clearInterval(timerHandle);
  let subject = $('#timerSubject').value;
  if (subject === '__기타') {
    subject = (prompt('과목명을 입력하세요') || '').trim();
    if (!subject) { setTimerButtons(); return; }
  }
  logStudy(subject, timerSec);
  toast(`${fmtDur(timerSec)} 기록 완료! 📈`);
  timerSec = 0;
  paintTimer();
  setTimerButtons();
  renderAll();
});

function logStudy(subject, seconds) {
  data.logs.push({ id: uid(), subject, seconds, date: todayStr(), ts: Date.now() });
  save();
}

/* 직접 시간 입력 */
const logModal = $('#logModal');
$('#manualLogBtn').addEventListener('click', () => {
  $('#l_subject').value = '';
  $('#l_minutes').value = '';
  logModal.hidden = false;
});
$('#logCancel').addEventListener('click', () => (logModal.hidden = true));
logModal.addEventListener('click', e => { if (e.target === logModal) logModal.hidden = true; });
$('#logSave').addEventListener('click', () => {
  const subject = $('#l_subject').value.trim();
  const min = parseInt($('#l_minutes').value, 10);
  if (!subject) return toast('과목을 입력해 주세요');
  if (!min || min < 1) return toast('시간(분)을 입력해 주세요');
  logStudy(subject, min * 60);
  logModal.hidden = true;
  toast(`${min}분 기록했어요`);
  renderAll();
});

/* 초기화 */
$('#resetData').addEventListener('click', () => {
  if (!confirm('모든 복습 일정과 공부 기록이 삭제됩니다. 계속할까요?')) return;
  data = structuredClone(defaultData);
  save();
  toast('초기화했어요');
  renderAll();
});

/* ---------- 시작 ---------- */
// 안전장치: 시작 시 모든 모달을 확실히 닫아 둠 (CSS가 안 먹어도 클릭 가로채지 않도록)
lessonModal.hidden = true;
logModal.hidden = true;
paintTimer();
setTimerButtons();
renderAll();
