/**
 * AI 연결 점검 — `npm run check-ai`
 *
 * 앱을 켜기 전에 키·모델·스키마가 실제로 통하는지 한 번에 확인한다.
 * 실패하면 무엇이 문제인지 그대로 보여 준다.
 */
import 'dotenv/config';
import { createModel } from '../src/model.js';
import { SYSTEM_PROMPT, SCENE_SCHEMA, buildTurnMessage } from '../src/prompt.js';
import { screenOutput } from '../src/safety.js';
import { APPEARANCES, TRAITS, WORLDS } from '../src/config.js';

/** 제공자마다 상태 코드 관례가 다르다 (Gemini는 잘못된 키에도 400을 준다). */
function explain(err) {
  const msg = err.message ?? '';
  if (/API_KEY_INVALID|API key not valid|invalid x-api-key|authentication_error/i.test(msg)) {
    return '키가 잘못됐습니다. .env 의 값을 다시 확인해 주세요 (앞뒤 공백·따옴표 주의).';
  }
  if (err.status === 401 || err.status === 403 || /PERMISSION_DENIED/i.test(msg)) {
    return '키에 권한이 없습니다. 콘솔에서 해당 키가 활성 상태인지 확인해 주세요.';
  }
  if (err.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
    return '요청 한도에 걸렸습니다. 무료 등급이면 분당/일일 한도일 수 있어요. 잠시 뒤 다시 시도해 주세요.';
  }
  if (err.status === 404 || /NOT_FOUND|no longer available|not found for API version/i.test(msg)) {
    return '이 키로는 쓸 수 없는 모델입니다.\n     `npm run list-models` 로 지금 열려 있는 목록을 보고\n     .env 의 GEMINI_MODEL 을 바꿔 주세요.';
  }
  if (err.status === 400) {
    return '요청 형식 문제입니다. 위 메시지에 어떤 필드가 문제인지 나와 있습니다.';
  }
  if (err.status >= 500) return '제공자 서버 문제입니다. 잠시 뒤 다시 시도해 주세요.';
  return '네트워크 또는 알 수 없는 오류입니다.';
}

async function main() {
  const { model, detail } = createModel(process.env);

  if (!model) {
    console.error('\n✗ 사용할 수 있는 API 키가 없습니다.');
    if (detail) console.error(`  ${detail}`);
    console.error('\n  .env 에 아래 중 하나를 넣어 주세요:');
    console.error('    GEMINI_API_KEY=...           (Google AI Studio, 무료 등급 있음)');
    console.error('    ANTHROPIC_API_KEY=sk-ant-... (Anthropic Console, 선불 크레딧)\n');
    return 1;
  }

  console.log(`\n  제공자: ${model.label}`);
  console.log('  실제 장면을 한 번 생성해 봅니다…\n');

  const character = {
    name: '별이',
    appearance: APPEARANCES.find((a) => a.id === 'cat'),
    traits: [TRAITS.find((t) => t.id === 'brave')],
    description: '무지개 날개가 달린 파란 고양이예요',
  };
  const world = WORLDS.find((w) => w.id === 'forest');

  const started = Date.now();
  let result;
  try {
    result = await model.generate({
      system: SYSTEM_PROMPT,
      user: buildTurnMessage({ character, world, history: [], chosenLabel: null, turn: 1 }),
      schema: SCENE_SCHEMA,
      maxTokens: 4096,
    });
  } catch (err) {
    console.error('✗ 호출 실패\n');
    console.error(`  ${err.message}\n`);
    console.error(`  → ${explain(err)}\n`);
    return 1;
  }
  const ms = Date.now() - started;

  if (result.blocked) {
    console.error(`✗ 제공자가 응답을 거부했습니다 — ${result.reason}`);
    console.error('  → 안전 설정이 과하게 걸렸을 수 있습니다. 앱에서는 자동으로 재생성을 시도합니다.\n');
    return 1;
  }
  if (!result.data) {
    console.error('✗ JSON을 받지 못했습니다 (구조화 출력이 안 먹었을 가능성).');
    console.error('  → 다른 모델로 바꾸거나 .env 의 모델 이름을 확인해 보세요.\n');
    return 1;
  }

  const scene = result.data;
  const shape = {
    narration: typeof scene.narration === 'string' && scene.narration.length > 0,
    choices: Array.isArray(scene.choices) && scene.choices.length === 3,
    art: Boolean(scene.art?.backdrop),
    reward: Boolean(scene.reward),
  };
  const filtered = screenOutput(scene);

  console.log('  ── 생성된 장면 ──');
  console.log(`  ${scene.narration}`);
  console.log('  선택지: ' + (scene.choices ?? []).map((c) => `${c.emoji} ${c.label}`).join(' | '));
  console.log(`  삽화: ${JSON.stringify(scene.art)}`);
  console.log('\n  ── 점검 ──');
  console.log(`  응답 시간        ${ms}ms`);
  console.log(`  스키마 형식      ${Object.values(shape).every(Boolean) ? 'OK' : 'X ' + JSON.stringify(shape)}`);
  console.log(`  안전 규칙 필터   ${filtered.ok ? '통과' : '차단 (' + filtered.matched + ')'}`);

  const ok = Object.values(shape).every(Boolean) && filtered.ok;
  console.log(ok
    ? '\n✓ 준비 끝. npm start 로 실행하세요.\n'
    : '\n△ 생성은 되지만 형식/안전 점검에 걸렸습니다. 위 내용을 확인해 주세요.\n');
  return ok ? 0 : 1;
}

// process.exit() 를 바로 부르면 Windows에서 stdout 플러시 중 libuv 어서션이 난다.
// 종료 코드만 세팅하고 이벤트 루프가 자연스럽게 끝나게 둔다.
process.exitCode = await main();
