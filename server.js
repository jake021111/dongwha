import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { createModel } from './src/model.js';
import {
  APPEARANCES, TRAITS, WORLDS, STICKERS, STATS, BACKDROPS, PROPS, FRIENDS,
  NAME_SUGGESTIONS, DESC_EXAMPLES, findById,
} from './src/config.js';
import {
  validateName, validateDescription, moderateDescription,
  DESCRIPTION_MAX, SAFETY_LAYERS,
} from './src/safety.js';
import { StoryEngine } from './src/engine.js';
import { perIp, createBudget } from './src/ratelimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// 공개 링크로 여러 사람이 들어오는 상황 (배포). 켜면:
//  - 놀이 시간 제한이 '서버 전체'가 아니라 '한 아이의 모험'마다 따로 걸린다
//  - 부모 설정 변경이 잠긴다 (한 사람이 바꾸면 모두에게 적용되므로)
const PUBLIC_DEMO = (process.env.PUBLIC_DEMO ?? '0') === '1';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES ?? 120) * 60_000;
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 500);

// 제공자(Claude / Gemini) 선택은 src/model.js 가 .env 를 보고 결정한다.
// .env.example 을 그대로 복사해 둔 자리표시자 키는 걸러 내고 오프라인 데모로 안내한다.
const { model: ai, status: aiStatus, detail: aiDetail } = createModel(process.env);

// ───────────────────────── 상태 (프로토타입: 서버 메모리에만 보관) ─────────────────────────
// 안전 계층 ⑥ 규정 준수: 아동 데이터 최소 수집. 이름은 별명이고, 디스크에 쓰지 않는다.
const sessions = new Map();
const playLog = []; // 안전 계층 ⑤ 부모 통제: 콘텐츠 로그 열람
const parentTokens = new Map();
const parentChallenges = new Map();

const settings = {
  dailyLimitMinutes: Number(process.env.DAILY_LIMIT_MINUTES ?? 20),
  modelClassifier: (process.env.SAFETY_LLM_CHECK ?? '1') !== '0',
  effort: process.env.STORY_EFFORT ?? 'low',
};

const usage = { day: today(), seconds: 0 }; // 서버 전체 집계 (부모 대시보드 표시용)

// 무료 API 할당량을 지키는 상한
const aiBudget = createBudget({
  windowMs: 3_600_000,
  max: Number(process.env.AI_CALLS_PER_HOUR ?? 400),
});

/** 오래된 세션을 정리한다 (공개 배포 시 메모리 무한 증가 방지) */
function sweepSessions() {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) if (s.createdAt < cutoff) sessions.delete(id);
  // 그래도 많으면 오래된 순으로 잘라 낸다
  if (sessions.size > MAX_SESSIONS) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of oldest.slice(0, sessions.size - MAX_SESSIONS)) sessions.delete(id);
  }
}
setInterval(sweepSessions, 10 * 60_000).unref();

// 자유 서술 검사 결과를 서명해 두면, 세션 생성 때 모델 검사를 두 번 돌리지 않아도 된다.
// (클라이언트가 보낸 "통과했음"을 믿지 않으면서도 비용·지연을 아끼는 방법)
const APPROVAL_SECRET = crypto.randomBytes(32);
const signDescription = (text) =>
  crypto.createHmac('sha256', APPROVAL_SECRET).update(text).digest('hex');
const verifyDescription = (text, token) => {
  if (typeof token !== 'string' || token.length !== 64) return false;
  const expected = Buffer.from(signDescription(text));
  const got = Buffer.from(token);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
};

function today() {
  return new Date().toISOString().slice(0, 10);
}
function rollUsage() {
  if (usage.day !== today()) {
    usage.day = today();
    usage.seconds = 0;
  }
}
function pushLog(entry) {
  playLog.push({ at: new Date().toISOString(), ...entry });
  if (playLog.length > 500) playLog.splice(0, playLog.length - 500);
}

const engine = new StoryEngine(ai, {
  useModelClassifier: settings.modelClassifier,
  onLog: (e) => pushLog({ kind: 'safety', ...e }),
});

// ───────────────────────────────── 앱 ─────────────────────────────────
const app = express();
app.set('trust proxy', 1); // 호스팅 프록시 뒤에서 진짜 IP를 보려면 필요
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 호스팅 헬스체크
app.get('/healthz', (_req, res) => res.json({ ok: true, mode: ai ? 'live' : 'offline' }));

// AI를 쓰는 경로에만 IP 제한을 건다 (프리셋 조회 등은 자유)
const aiLimit = perIp({ windowMs: 60_000, max: Number(process.env.RPM_PER_IP ?? 30) });

app.get('/api/presets', (_req, res) => {
  res.json({
    appearances: APPEARANCES,
    traits: TRAITS,
    worlds: WORLDS,
    names: NAME_SUGGESTIONS,
    descExamples: DESC_EXAMPLES,
    descriptionMax: DESCRIPTION_MAX,
    art: { backdrops: BACKDROPS, props: PROPS, friends: FRIENDS },
    stickers: STICKERS,
    stats: STATS,
    mode: ai ? 'live' : 'offline',
    dailyLimitMinutes: settings.dailyLimitMinutes,
  });
});

/**
 * 안전 계층 ① — 아이가 쓴 자유 서술 검사.
 * 형식·금칙어·프롬프트 주입(즉시) → 모델 검사(뉘앙스).
 * 통과하면 서명 토큰을 함께 주어, 세션 생성 때 모델 검사를 반복하지 않는다.
 */
app.post('/api/describe/check', aiLimit, async (req, res) => {
  const checked = validateDescription(req.body?.text);
  if (!checked.ok) {
    pushLog({ kind: 'safety', type: 'blocked', layer: 'input-guard', detail: String(req.body?.text ?? '').slice(0, 80) });
    return res.json({ ok: false, reason: checked.reason });
  }
  if (!checked.value) return res.json({ ok: true, text: '', token: signDescription('') });

  if (ai && !aiBudget.take()) {
    return res.status(503).json({ ok: false, reason: '지금 친구들이 많아요. 잠시 뒤에 다시 해 주세요.' });
  }

  let verdict;
  try {
    verdict = await moderateDescription(ai, checked.value);
  } catch (err) {
    console.error('[describe/check]', err);
    // 검사기를 못 돌렸으면 통과시키지 않는다 (보수적으로)
    return res.status(502).json({ ok: false, reason: '지금은 확인이 어려워요. 잠시 뒤에 다시 해 주세요.' });
  }
  if (!verdict.safe) {
    pushLog({ kind: 'safety', type: 'blocked', layer: 'input-moderation', detail: checked.value });
    return res.json({ ok: false, reason: verdict.reason || '조금 다르게 써 볼까요?' });
  }
  res.json({ ok: true, text: checked.value, token: signDescription(checked.value) });
});

/** 캐릭터 만들기 + 세계 고르기 → 세션 생성 */
app.post('/api/session', aiLimit, async (req, res) => {
  const { name, appearanceId, traitIds, worldId, description, descriptionToken } = req.body ?? {};

  // 안전 계층 ① 입력 가드
  const checked = validateName(name);
  if (!checked.ok) return res.status(400).json({ error: checked.reason });

  // 자유 서술은 클라이언트 검사를 믿지 않는다. 서명이 없거나 틀리면 여기서 다시 검사한다.
  const desc = validateDescription(description);
  if (!desc.ok) return res.status(400).json({ error: desc.reason });
  if (desc.value && !verifyDescription(desc.value, descriptionToken)) {
    try {
      const verdict = await moderateDescription(ai, desc.value);
      if (!verdict.safe) {
        pushLog({ kind: 'safety', type: 'blocked', layer: 'input-moderation', detail: desc.value });
        return res.status(400).json({ error: verdict.reason || '조금 다르게 써 볼까요?' });
      }
    } catch (err) {
      console.error('[session/describe]', err);
      return res.status(502).json({ error: '지금은 확인이 어려워요. 잠시 뒤에 다시 해 주세요.' });
    }
  }

  const appearance = findById(APPEARANCES, appearanceId);
  const world = findById(WORLDS, worldId);
  const traits = (Array.isArray(traitIds) ? traitIds : [])
    .slice(0, 2)
    .map((id) => findById(TRAITS, id))
    .filter(Boolean);

  if (!appearance) return res.status(400).json({ error: '모습을 골라 주세요.' });
  if (!world) return res.status(400).json({ error: '세계를 골라 주세요.' });
  if (traits.length === 0) return res.status(400).json({ error: '성격을 하나 이상 골라 주세요.' });

  const id = crypto.randomUUID();
  const character = { name: checked.value, appearance, traits, description: desc.value };
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    character,
    world,
    turn: 0,
    history: [],
    stickers: [],
    stats: { brave: 0, wise: 0, kind: 0 },
    // 놀이 시간은 이 모험에만 적용된다 (공개 링크에서 서로의 시간을 잡아먹지 않도록)
    secondsUsed: 0,
    limitSeconds: settings.dailyLimitMinutes * 60,
  });
  sweepSessions();

  pushLog({ kind: 'session', detail: `모험 시작 — ${checked.value} / ${world.label}` });
  if (desc.value) pushLog({ kind: 'description', detail: desc.value });
  res.json({ sessionId: id, character, world });
});

/** 한 턴 진행: (선택 없음 = 첫 장면) */
app.post('/api/session/:id/turn', aiLimit, async (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s) return res.status(404).json({ error: '모험을 찾을 수 없어요. 다시 시작해 주세요.' });

  // 안전 계층 ⑤ 부모 통제 — 시간 제한 (서버에서 강제, 모험 단위)
  rollUsage();
  if (s.secondsUsed >= s.limitSeconds) {
    return res.status(429).json({ error: 'time_limit', message: '오늘의 놀이 시간이 끝났어요!' });
  }
  if (ai && !aiBudget.take()) {
    return res.status(503).json({
      error: 'busy',
      message: '지금 친구들이 아주 많아요. 잠시 뒤에 다시 눌러 주세요.',
    });
  }

  const { choiceIndex } = req.body ?? {};
  let chosenLabel = null;

  if (s.turn > 0) {
    const last = s.history[s.history.length - 1];
    const choice = last?.choices?.[Number(choiceIndex)];
    if (!choice) return res.status(400).json({ error: '선택을 다시 눌러 주세요.' });
    chosenLabel = choice.label;
    last.chosen = chosenLabel;
  }

  s.turn += 1;

  let result;
  try {
    result = await engine.nextScene({
      character: s.character,
      world: s.world,
      history: s.history,
      chosenLabel,
      turn: s.turn,
    });
  } catch (err) {
    s.turn -= 1;
    console.error('[turn]', err);
    const overloaded = err?.status === 429 || err?.status >= 500;
    return res.status(502).json({
      error: 'engine',
      message: overloaded
        ? '이야기꾼이 잠깐 쉬고 있어요. 다시 눌러 주세요.'
        : '이야기를 만들지 못했어요. 다시 눌러 주세요.',
    });
  }

  const { scene, meta } = result;

  // 성장·보상 반영
  const gained = { sticker: null, stat: null };
  const stickerId = scene.reward?.sticker;
  if (stickerId && stickerId !== 'none' && STICKERS[stickerId] && !s.stickers.includes(stickerId)) {
    s.stickers.push(stickerId);
    gained.sticker = { id: stickerId, ...STICKERS[stickerId] };
  }
  const statId = scene.reward?.stat;
  if (statId && statId !== 'none' && STATS[statId]) {
    s.stats[statId] += 1;
    gained.stat = { id: statId, ...STATS[statId] };
  }

  s.history.push({ narration: scene.narration, choices: scene.choices, chosen: null });
  const spent = Math.round(meta.ms / 1000) + 12; // 생성 시간 + 읽고 고르는 시간 추정
  s.secondsUsed += spent;
  usage.seconds += spent;

  pushLog({
    kind: 'scene',
    turn: s.turn,
    chosen: chosenLabel,
    narration: scene.narration,
    mode: meta.mode,
    attempts: meta.attempts,
    blocked: meta.blocked?.length ?? 0,
  });

  res.json({
    turn: s.turn,
    scene: { narration: scene.narration, choices: scene.choices, art: scene.art },
    gained,
    stats: s.stats,
    stickers: s.stickers.map((id) => ({ id, ...STICKERS[id] })),
    meta: { mode: meta.mode, ms: meta.ms, attempts: meta.attempts },
    timeLeftMinutes: Math.max(0, Math.round((s.limitSeconds - s.secondsUsed) / 60)),
  });
});

// ───────────────────── 안전 계층 ⑤ 부모 게이트 / 대시보드 ─────────────────────
app.get('/api/parent/challenge', (_req, res) => {
  const a = 3 + Math.floor(Math.random() * 7); // 3~9
  const b = 3 + Math.floor(Math.random() * 7);
  const id = crypto.randomUUID();
  parentChallenges.set(id, { answer: a * b, expires: Date.now() + 3 * 60_000 });
  res.json({ id, question: `${a} × ${b} = ?` });
});

app.post('/api/parent/verify', (req, res) => {
  const { id, answer } = req.body ?? {};
  const ch = parentChallenges.get(id);
  parentChallenges.delete(id);
  if (!ch || ch.expires < Date.now() || Number(answer) !== ch.answer) {
    return res.status(401).json({ error: '답이 맞지 않아요.' });
  }
  const token = crypto.randomUUID();
  parentTokens.set(token, Date.now() + 15 * 60_000);
  res.json({ token });
});

function requireParent(req, res, next) {
  const token = req.get('x-parent-token') ?? req.query.token;
  const exp = parentTokens.get(token);
  if (!exp || exp < Date.now()) {
    parentTokens.delete(token);
    return res.status(401).json({ error: '부모 인증이 필요해요.' });
  }
  next();
}

app.get('/api/parent/dashboard', requireParent, (_req, res) => {
  rollUsage();
  res.json({
    settings,
    safetyLayers: SAFETY_LAYERS,
    usage: { day: usage.day, minutes: Math.round(usage.seconds / 60) },
    mode: ai ? 'live' : 'offline',
    publicDemo: PUBLIC_DEMO,
    activeSessions: sessions.size,
    aiBudget: { used: aiBudget.used(), max: aiBudget.max },
    log: playLog.slice(-80).reverse(),
    descriptions: playLog.filter((e) => e.kind === 'description').slice(-20).reverse(),
    blockedCount: playLog.filter((e) => e.type === 'blocked').length,
  });
});

app.post('/api/parent/settings', requireParent, (req, res) => {
  if (PUBLIC_DEMO) {
    return res.status(403).json({
      error: '공개 데모에서는 설정을 바꿀 수 없어요. (한 사람의 변경이 모두에게 적용되기 때문입니다)',
    });
  }
  const { dailyLimitMinutes, modelClassifier } = req.body ?? {};
  if (Number.isFinite(dailyLimitMinutes)) {
    settings.dailyLimitMinutes = Math.min(180, Math.max(5, Math.round(dailyLimitMinutes)));
  }
  if (typeof modelClassifier === 'boolean') {
    settings.modelClassifier = modelClassifier;
    engine.useModelClassifier = modelClassifier;
  }
  pushLog({ kind: 'parent', detail: '설정 변경' });
  res.json({ settings });
});

app.post('/api/parent/reset-timer', requireParent, (_req, res) => {
  if (PUBLIC_DEMO) {
    return res.status(403).json({ error: '공개 데모에서는 초기화할 수 없어요.' });
  }
  usage.seconds = 0;
  pushLog({ kind: 'parent', detail: '놀이 시간 초기화' });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\n  우리만의 세상 RPG — http://localhost:${PORT}`);
  if (ai) {
    console.log(`  모드: AI 연결됨 — ${ai.label}`);
  } else {
    console.log('  모드: 오프라인 데모 (이야기가 반복됩니다)');
    if (aiDetail) console.log(`  ⚠ ${aiDetail}`);
    console.log('  → 실제 연결 확인: npm run check-ai');
  }
  void aiStatus;
  const scope = PUBLIC_DEMO ? '모험당' : '하루';
  console.log(`  놀이 시간: ${scope} ${settings.dailyLimitMinutes}분 / 모델 안전 재검사: ${settings.modelClassifier ? '켜짐' : '꺼짐'}`);
  if (PUBLIC_DEMO) {
    console.log(`  공개 데모 모드: 부모 설정 잠금 · IP당 ${process.env.RPM_PER_IP ?? 30}회/분 · AI ${aiBudget.max}회/시간`);
  }
  console.log('');
});
