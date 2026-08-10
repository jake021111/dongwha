/* 우리만의 세상 RPG — 클라이언트
   읽기·쓰기 부담 최소화: 이야기는 TTS로 읽어 주고,
   캐릭터 서술은 타이핑 대신 🎤 말하기로도 넣을 수 있다. */

const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...opts,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message ?? body.error ?? '오류'), { body, status: res.status });
  return body;
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  presets: null,
  name: '',
  appearanceId: null,
  traitIds: [],
  worldId: null,
  description: '',
  descriptionToken: null, // 서버가 서명해 준 "검사 통과" 증표
  sessionId: null,
  hero: '⭐',
  busy: false,
  parentToken: null,
  gateId: null,
};

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  window.scrollTo(0, 0);
}
document.querySelectorAll('[data-back]').forEach((b) =>
  b.addEventListener('click', () => show(b.dataset.back)),
);

// ───────────────────────── 음성 낭독 (TTS) ─────────────────────────
const tts = {
  voice: null,
  pick() {
    const voices = speechSynthesis.getVoices();
    this.voice = voices.find((v) => v.lang === 'ko-KR') || voices.find((v) => v.lang?.startsWith('ko')) || null;
  },
  speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (this.voice) u.voice = this.voice;
    u.rate = 0.92;
    u.pitch = 1.15;
    const btn = $('btn-speak');
    u.onstart = () => btn.classList.add('speaking');
    u.onend = u.onerror = () => btn.classList.remove('speaking');
    speechSynthesis.speak(u);
  },
  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('btn-speak').classList.remove('speaking');
  },
};
if ('speechSynthesis' in window) {
  tts.pick();
  speechSynthesis.onvoiceschanged = () => tts.pick();
}

// ───────────────────────── 음성 입력 (말해서 쓰기) ─────────────────────────
const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let recognizer = null;

function setupMic() {
  const btn = $('btn-mic');
  const label = $('mic-state');

  if (!SR) {
    btn.hidden = true;
    label.textContent = '';
    return;
  }

  btn.addEventListener('click', () => {
    if (recognizer) { recognizer.stop(); return; }

    const r = new SR();
    r.lang = 'ko-KR';
    r.interimResults = true;
    r.continuous = false;
    recognizer = r;

    const before = $('desc-input').value.trim();
    btn.classList.add('on');
    label.textContent = '듣고 있어요…';

    r.onresult = (e) => {
      const said = Array.from(e.results).map((x) => x[0].transcript).join('');
      $('desc-input').value = (before ? before + ' ' : '') + said;
      onDescInput();
    };
    r.onerror = (e) => {
      label.textContent = e.error === 'not-allowed' ? '마이크를 허용해 주세요' : '잘 안 들렸어요';
    };
    r.onend = () => {
      recognizer = null;
      btn.classList.remove('on');
      if (label.textContent === '듣고 있어요…') label.textContent = '';
      setTimeout(() => { if (!recognizer) label.textContent = ''; }, 2500);
    };
    r.start();
  });
}

// ───────────────────────── 프리셋 로드 ─────────────────────────
async function boot() {
  state.presets = await api('/api/presets');
  const p = state.presets;

  $('mode-badge').textContent =
    p.mode === 'live'
      ? `AI 이야기꾼 준비 완료 · 하루 ${p.dailyLimitMinutes}분`
      : '오프라인 데모 모드 (AI 미연결)';

  renderPicker($('pick-appearance'), p.appearances, (id) => {
    state.appearanceId = id;
    syncMakeButton();
  });

  renderPicker(
    $('pick-trait'),
    p.traits,
    (id, el) => {
      const i = state.traitIds.indexOf(id);
      if (i >= 0) state.traitIds.splice(i, 1);
      else {
        if (state.traitIds.length >= 2) {
          const dropped = state.traitIds.shift();
          el.parentElement.querySelector(`[data-id="${dropped}"]`)?.setAttribute('aria-pressed', 'false');
        }
        state.traitIds.push(id);
      }
      el.setAttribute('aria-pressed', String(state.traitIds.includes(id)));
      syncMakeButton();
      return false;
    },
    { multi: true },
  );

  renderPicker($('pick-world'), p.worlds, (id) => {
    state.worldId = id;
    $('btn-begin').disabled = false;
  });

  $('name-chips').replaceChildren(
    ...p.names.map((n) => chip(n, () => { $('name-input').value = n; onNameInput(); })),
  );
  $('desc-chips').replaceChildren(
    ...p.descExamples.map((t) =>
      chip(t, () => { $('desc-input').value = t; onDescInput(); $('desc-input').focus(); }, 'long'),
    ),
  );
  $('desc-input').maxLength = p.descriptionMax;
  onDescInput();
  setupMic();
}

function chip(text, onClick, extra = '') {
  const b = document.createElement('button');
  b.className = 'chip ' + extra;
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function renderPicker(root, items, onPick, { multi = false } = {}) {
  root.replaceChildren(
    ...items.map((it) => {
      const b = document.createElement('button');
      b.className = 'card-btn';
      b.type = 'button';
      b.dataset.id = it.id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="emo">${it.emoji}</span><span class="lab">${escapeHtml(it.label)}</span>`;
      b.addEventListener('click', () => {
        const handled = onPick(it.id, b);
        if (!multi && handled !== false) {
          root.querySelectorAll('.card-btn').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
        }
      });
      return b;
    }),
  );
}

// ───────────────────────── 캐릭터 만들기 ─────────────────────────
function onNameInput() {
  const v = $('name-input').value.trim();
  const hint = $('name-hint');
  const bad = v && !/^[가-힣a-zA-Z0-9 ]{1,10}$/.test(v);
  hint.textContent = bad ? '이름은 한글이나 영어로 10글자까지 쓸 수 있어요.' : '진짜 이름 말고 별명을 써도 좋아요.';
  hint.classList.toggle('bad', Boolean(bad));
  state.name = bad ? '' : v;
  syncMakeButton();
}
$('name-input').addEventListener('input', onNameInput);

$('btn-dice').addEventListener('click', () => {
  const names = state.presets.names;
  $('name-input').value = names[Math.floor(Math.random() * names.length)];
  onNameInput();
});

/** 설명이 바뀌면 이전 검사 통과 증표는 무효가 된다. */
function onDescInput() {
  const v = $('desc-input').value.trim();
  $('desc-count').textContent = `${$('desc-input').value.length} / ${state.presets?.descriptionMax ?? 80}`;
  if (v !== state.description) {
    state.description = v;
    state.descriptionToken = null;
    const hint = $('desc-hint');
    hint.textContent = '';
    hint.className = 'hint';
  }
}
$('desc-input').addEventListener('input', onDescInput);

function syncMakeButton() {
  $('btn-to-world').disabled = !(state.name && state.appearanceId && state.traitIds.length > 0);
}

$('btn-start').addEventListener('click', () => show('screen-make'));

/** 다음으로 넘어가기 전에 자유 서술을 검사한다 (안전 계층 ①). */
$('btn-to-world').addEventListener('click', async () => {
  const btn = $('btn-to-world');
  const hint = $('desc-hint');

  if (!state.description || state.descriptionToken) { show('screen-world'); return; }

  btn.disabled = true;
  btn.textContent = '확인하는 중…';
  hint.className = 'hint';
  hint.textContent = '';
  try {
    const r = await api('/api/describe/check', {
      method: 'POST',
      body: JSON.stringify({ text: state.description }),
    });
    if (r.ok) {
      state.description = r.text;
      state.descriptionToken = r.token;
      show('screen-world');
    } else {
      hint.className = 'hint bad';
      hint.textContent = r.reason;
      $('desc-input').focus();
    }
  } catch (e) {
    hint.className = 'hint bad';
    hint.textContent = e.message;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '다음 <span aria-hidden="true">▸</span>';
    syncMakeButton();
  }
});

// ───────────────────────── 모험 ─────────────────────────
$('btn-begin').addEventListener('click', async () => {
  const btn = $('btn-begin');
  btn.disabled = true;
  try {
    const r = await api('/api/session', {
      method: 'POST',
      body: JSON.stringify({
        name: state.name,
        appearanceId: state.appearanceId,
        traitIds: state.traitIds,
        worldId: state.worldId,
        description: state.description,
        descriptionToken: state.descriptionToken,
      }),
    });
    state.sessionId = r.sessionId;
    state.hero = r.character.appearance.emoji;
    $('sticker-shelf').replaceChildren();
    $('choices').replaceChildren();
    $('stat-strip').replaceChildren();
    $('narration').textContent = '이야기를 준비하고 있어요…';
    show('screen-play');
    await takeTurn(null);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
});

$('btn-quit').addEventListener('click', () => {
  tts.stop();
  state.sessionId = null;
  show('screen-title');
});

$('btn-speak').addEventListener('click', () => tts.speak($('narration').textContent));

async function takeTurn(choiceIndex) {
  if (state.busy || !state.sessionId) return;
  state.busy = true;
  tts.stop();
  $('loading').hidden = false;
  $('choices').querySelectorAll('button').forEach((b) => (b.disabled = true));

  try {
    const r = await api(`/api/session/${state.sessionId}/turn`, {
      method: 'POST',
      body: JSON.stringify({ choiceIndex }),
    });
    renderScene(r);
  } catch (e) {
    if (e.body?.error === 'time_limit') {
      $('overlay-time').hidden = false;
    } else {
      $('narration').textContent = e.message ?? '앗, 잠깐 문제가 생겼어요. 다시 눌러 주세요.';
      renderChoices([{ emoji: '🔁', label: '다시 해 볼래요' }], () => takeTurn(choiceIndex));
    }
  } finally {
    $('loading').hidden = true;
    state.busy = false;
  }
}

function renderScene(r) {
  const { scene, gained, stats, stickers } = r;
  const art = state.presets.art;

  const bd = art.backdrops[scene.art?.backdrop] ?? art.backdrops.meadow;
  $('stage-sky').style.background = bd.sky;
  $('stage-props').replaceChildren(
    ...(scene.art?.props ?? []).slice(0, 3).map((k) => el('span', art.props[k] ?? '')),
  );
  $('stage-actors').replaceChildren(
    el('span', state.hero, 'hero'),
    ...(scene.art?.friends ?? []).slice(0, 2).map((k) => el('span', art.friends[k] ?? '')),
  );

  $('narration').textContent = scene.narration;
  tts.speak(scene.narration);

  renderChoices(scene.choices, (i) => takeTurn(i));

  $('stat-strip').replaceChildren(
    ...Object.entries(state.presets.stats).map(([k, v]) => el('span', `${v.emoji} ${stats[k] ?? 0}`)),
  );
  $('sticker-shelf').replaceChildren(
    ...stickers.map((s) => {
      const sp = el('span', s.emoji);
      sp.title = s.label;
      return sp;
    }),
  );

  if (gained?.sticker) toast(`${gained.sticker.emoji} ${gained.sticker.label}를 받았어요!`);
  else if (gained?.stat) toast(`${gained.stat.emoji} ${gained.stat.label}이(가) 자랐어요!`);
}

function renderChoices(choices, onPick) {
  $('choices').replaceChildren(
    ...choices.map((c, i) => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.type = 'button';
      b.innerHTML = `<span class="emo">${c.emoji ?? '✨'}</span><span>${escapeHtml(c.label)}</span>`;
      b.addEventListener('click', () => onPick(i));
      return b;
    }),
  );
}

function el(tag, text, cls) {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

$('btn-time-ok').addEventListener('click', () => {
  $('overlay-time').hidden = true;
  tts.stop();
  show('screen-title');
});

// ───────────────────────── 부모 게이트 & 대시보드 ─────────────────────────
async function openGate() {
  const ch = await api('/api/parent/challenge');
  state.gateId = ch.id;
  $('gate-question').textContent = ch.question;
  $('gate-answer').value = '';
  $('gate-err').textContent = '';
  $('overlay-gate').hidden = false;
  $('gate-answer').focus();
}
$('btn-parent-open').addEventListener('click', openGate);
$('btn-parent-open-2').addEventListener('click', openGate);
$('btn-gate-cancel').addEventListener('click', () => ($('overlay-gate').hidden = true));
$('gate-answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-gate-ok').click(); });

$('btn-gate-ok').addEventListener('click', async () => {
  try {
    const r = await api('/api/parent/verify', {
      method: 'POST',
      body: JSON.stringify({ id: state.gateId, answer: Number($('gate-answer').value) }),
    });
    state.parentToken = r.token;
    $('overlay-gate').hidden = true;
    await openDashboard();
  } catch {
    $('gate-err').textContent = '답이 맞지 않아요. 다시 시도해 주세요.';
    await openGate();
  }
});

const hhmm = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

async function openDashboard() {
  const d = await api('/api/parent/dashboard', { headers: { 'x-parent-token': state.parentToken } });

  $('parent-usage').textContent = d.publicDemo
    ? `모험당 ${d.settings.dailyLimitMinutes}분 · 지금 놀고 있는 모험 ${d.activeSessions}개`
    : `${d.usage.minutes}분 / ${d.settings.dailyLimitMinutes}분 (${d.usage.day})`;
  $('limit-input').value = d.settings.dailyLimitMinutes;
  $('classifier-input').checked = d.settings.modelClassifier;
  $('blocked-count').textContent = d.blockedCount > 0 ? `· 지금까지 ${d.blockedCount}건 차단됨` : '· 차단 기록 없음';

  // 공개 데모에서는 한 사람의 설정 변경이 모두에게 적용되므로 잠근다
  $('demo-note').hidden = !d.publicDemo;
  for (const id of ['limit-input', 'classifier-input', 'btn-save-settings', 'btn-reset-timer']) {
    $(id).disabled = Boolean(d.publicDemo);
  }

  $('parent-desc').replaceChildren(
    ...(d.descriptions.length
      ? d.descriptions.map((e) => row(`<span class="t">${hhmm(e.at)}</span>${escapeHtml(e.detail)}`))
      : [row('<span class="empty">아직 아이가 쓴 설명이 없어요.</span>')]),
  );

  $('safety-layers').replaceChildren(
    ...d.safetyLayers.map((l) => row(`<b>${l.id}. ${escapeHtml(l.name)}</b> — ${escapeHtml(l.desc)}`)),
  );

  $('parent-log').replaceChildren(
    ...d.log.map((e) => {
      const text =
        e.kind === 'scene' ? `${e.chosen ? `선택: ${e.chosen} → ` : ''}${e.narration}`
        : e.kind === 'safety' ? `⚠️ ${e.layer} 차단 — ${e.detail ?? ''}`
        : e.kind === 'description' ? `✏️ 캐릭터 설명 — ${e.detail}`
        : e.detail ?? e.kind;
      return row(`<span class="t">${hhmm(e.at)}</span><span class="${e.kind === 'safety' ? 'blocked' : ''}">${escapeHtml(text)}</span>`);
    }),
  );

  $('overlay-parent').hidden = false;
}

function row(html) {
  const li = document.createElement('li');
  li.innerHTML = html;
  return li;
}

$('btn-parent-close').addEventListener('click', () => ($('overlay-parent').hidden = true));

$('btn-save-settings').addEventListener('click', async () => {
  await api('/api/parent/settings', {
    method: 'POST',
    headers: { 'x-parent-token': state.parentToken },
    body: JSON.stringify({
      dailyLimitMinutes: Number($('limit-input').value),
      modelClassifier: $('classifier-input').checked,
    }),
  });
  await openDashboard();
  toast('설정을 저장했어요');
});

$('btn-reset-timer').addEventListener('click', async () => {
  await api('/api/parent/reset-timer', {
    method: 'POST',
    headers: { 'x-parent-token': state.parentToken },
  });
  await openDashboard();
});

boot().catch((e) => {
  document.body.innerHTML = `<p style="padding:40px;font-size:18px">서버에 연결하지 못했어요.<br><small>${escapeHtml(e.message)}</small></p>`;
});
