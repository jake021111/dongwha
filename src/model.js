/**
 * 모델 어댑터 — 이야기 생성과 안전 검사가 부르는 유일한 창구.
 *
 * 제공자를 바꿔도 프롬프트(src/prompt.js)·안전 규칙(src/safety.js)·UI는 그대로 둔다.
 * 공통 계약:
 *   generate({ system, user, schema, maxTokens }) →
 *     { data: object|null, blocked: boolean, reason: string }
 *   - data    : 스키마에 맞는 JSON 객체 (실패 시 null)
 *   - blocked : 제공자의 안전장치가 응답을 거부함 (재생성 대상)
 */
import Anthropic from '@anthropic-ai/sdk';

const isPlaceholder = (k) => !k || k.includes('...') || k.includes('여기에');

/* ───────────────────────────── Claude ───────────────────────────── */

class ClaudeModel {
  constructor({ apiKey, model, effort }) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
    this.effort = effort;
    this.provider = 'claude';
    this.label = `Claude (${model})`;
  }

  async generate({ system, user, schema, maxTokens = 4096 }) {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      // 시스템 프롬프트는 매 턴 동일 → 캐시 히트로 비용·지연 절감
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: this.effort,
        format: { type: 'json_schema', schema },
      },
      messages: [{ role: 'user', content: user }],
    });

    // 안전 분류기가 거절하면 200 + stop_reason:"refusal" 로 온다.
    if (res.stop_reason === 'refusal') {
      return { data: null, blocked: true, reason: '모델이 응답을 거부함' };
    }
    const block = res.content.find((b) => b.type === 'text');
    return { data: safeParse(block?.text), blocked: false, reason: '' };
  }
}

/* ───────────────────────────── Gemini ─────────────────────────────
   SDK 대신 REST를 직접 호출한다. 의존성이 늘지 않고, SDK 버전에 따라
   바뀌는 바인딩에 휘둘리지 않는다.
   https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
   ───────────────────────────────────────────────────────────────── */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// 5~8세 대상이므로 제공자 측 안전장치도 가장 엄격하게 켠다 (안전 계층 ③의 보강).
const GEMINI_SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_LOW_AND_ABOVE' }));

/**
 * Gemini의 responseSchema는 OpenAPI 3.0 부분집합이라
 * JSON Schema의 additionalProperties 같은 키를 받으면 400을 낸다 → 걸러 낸다.
 */
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== 'object') return node;

  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'additionalProperties') continue;
    out[key] = toGeminiSchema(value);
  }
  // 속성 순서를 고정해 두면 출력이 안정적이다
  if (out.type === 'object' && out.properties && !out.propertyOrdering) {
    out.propertyOrdering = Object.keys(out.properties);
  }
  return out;
}

class GeminiModel {
  constructor({ apiKey, model, thinking }) {
    this.apiKey = apiKey;
    this.model = model;
    this.thinking = thinking; // 'off' | 'auto'
    this.provider = 'gemini';
    this.label = `Gemini (${model})`;
  }

  #buildConfig(schema, maxTokens, withThinking) {
    const config = {
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(schema),
      // 생각(thinking) 토큰도 maxOutputTokens 에 포함된다 → 켜져 있으면 여유를 둔다.
      maxOutputTokens: withThinking ? Math.max(maxTokens, 8192) : maxTokens,
    };
    // 생각을 끌 수 있는 모델에서만 0으로 지정한다.
    // 최신 모델 중에는 끌 수 없어서 thinkingBudget:0 을 400으로 거부하는 것들이 있다.
    if (!withThinking) config.thinkingConfig = { thinkingBudget: 0 };
    return config;
  }

  async #post(system, user, generationConfig) {
    return fetch(`${GEMINI_BASE}/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig,
        safetySettings: GEMINI_SAFETY,
      }),
    });
  }

  async generate({ system, user, schema, maxTokens = 4096 }) {
    const wantThinking = this.thinking !== 'off';
    let res = await this.#post(system, user, this.#buildConfig(schema, maxTokens, wantThinking));

    // thinkingBudget:0 을 받지 않는 모델이 있다 → 400이면 그 설정만 빼고 한 번 더 시도.
    if (!res.ok && res.status === 400 && !wantThinking) {
      res = await this.#post(system, user, this.#buildConfig(schema, maxTokens, true));
      if (res.ok) this.thinking = 'auto'; // 다음 호출부터는 헛걸음하지 않는다
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const json = await res.json();

    // 입력 자체가 막힌 경우
    if (json.promptFeedback?.blockReason) {
      return { data: null, blocked: true, reason: `입력 차단(${json.promptFeedback.blockReason})` };
    }

    const candidate = json.candidates?.[0];
    if (!candidate) return { data: null, blocked: true, reason: '응답 없음' };

    // SAFETY / RECITATION / PROHIBITED_CONTENT 등은 재생성 대상으로 본다.
    // MAX_TOKENS 는 잘린 JSON이므로 파싱에서 걸러진다.
    if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      return { data: null, blocked: true, reason: `차단(${candidate.finishReason})` };
    }

    const text = (candidate.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return { data: safeParse(text), blocked: false, reason: '' };
  }
}

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ─────────────────────── 제공자 선택 ─────────────────────── */

/**
 * .env 를 보고 쓸 모델을 고른다.
 * @returns {{ model: object|null, status: string, detail: string }}
 */
export function createModel(env = process.env) {
  const want = (env.AI_PROVIDER ?? 'auto').trim().toLowerCase();

  const claudeKey = (env.ANTHROPIC_API_KEY ?? '').trim();
  const geminiKey = (env.GEMINI_API_KEY ?? '').trim();

  const claudeOk = claudeKey.startsWith('sk-ant-') && claudeKey.length >= 40 && !isPlaceholder(claudeKey);
  const geminiOk = geminiKey.length >= 20 && !isPlaceholder(geminiKey);

  const claudeBad = claudeKey.length > 0 && !claudeOk;
  const geminiBad = geminiKey.length > 0 && !geminiOk;

  const makeClaude = () => ({
    model: new ClaudeModel({
      apiKey: claudeKey,
      model: env.CLAUDE_MODEL?.trim() || 'claude-opus-5',
      effort: env.STORY_EFFORT?.trim() || 'low',
    }),
    status: 'live',
    detail: '',
  });

  const makeGemini = () => ({
    model: new GeminiModel({
      apiKey: geminiKey,
      // 모델 이름은 자주 바뀐다. 404가 나면 `npm run list-models` 로 확인할 것.
      model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
      // 최신 모델 상당수가 생각(thinking)을 끌 수 없다 → 기본은 건드리지 않는 auto.
      thinking: (env.GEMINI_THINKING ?? 'auto').trim().toLowerCase(),
    }),
    status: 'live',
    detail: '',
  });

  if (want === 'gemini') {
    if (geminiOk) return makeGemini();
    return { model: null, status: 'offline', detail: geminiBad ? 'GEMINI_API_KEY 값이 예시값이거나 형식이 이상합니다.' : 'GEMINI_API_KEY 가 없습니다.' };
  }
  if (want === 'claude') {
    if (claudeOk) return makeClaude();
    return { model: null, status: 'offline', detail: claudeBad ? 'ANTHROPIC_API_KEY 값이 예시값 그대로입니다.' : 'ANTHROPIC_API_KEY 가 없습니다.' };
  }
  if (want === 'offline') return { model: null, status: 'offline', detail: 'AI_PROVIDER=offline' };

  // auto: 쓸 수 있는 키를 찾아서 쓴다
  if (claudeOk) return makeClaude();
  if (geminiOk) return makeGemini();

  const hints = [];
  if (claudeBad) hints.push('ANTHROPIC_API_KEY 가 예시값 그대로입니다.');
  if (geminiBad) hints.push('GEMINI_API_KEY 가 예시값이거나 형식이 이상합니다.');
  return {
    model: null,
    status: 'offline',
    detail: hints.join(' ') || 'API 키가 없습니다 (ANTHROPIC_API_KEY 또는 GEMINI_API_KEY).',
  };
}
