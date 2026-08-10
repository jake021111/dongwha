/**
 * 한 턴의 데이터 흐름 (기획서 9장)
 *
 *   아이 입력 → [캐릭터+세계+진행상황+안전지침]으로 프롬프트 구성
 *            → 모델이 장면·선택지 생성
 *            → 출력 안전필터(규칙 → 모델)
 *            → 앱에서 이야기+선택 버튼 표시 (TTS는 클라이언트)
 *
 * 모델 호출은 src/model.js 의 어댑터를 통해서만 한다 (제공자 교체 가능).
 */
import { SYSTEM_PROMPT, SCENE_SCHEMA, buildTurnMessage, RETRY_HINT } from './prompt.js';
import { screenOutput, classifyWithModel, fallbackScene } from './safety.js';
import { nextOfflineScene } from './offline.js';

const MAX_REGENERATIONS = 2;

export class StoryEngine {
  /**
   * @param {object|null} model - src/model.js 의 어댑터. null 이면 오프라인 데모 모드.
   */
  constructor(model, options = {}) {
    this.model = model;
    this.useModelClassifier = options.useModelClassifier ?? true;
    this.onLog = options.onLog ?? (() => {});
  }

  get offline() {
    return this.model === null;
  }

  /** 한 턴을 생성하고, 안전 필터를 통과한 장면만 돌려준다. */
  async nextScene({ character, world, history, chosenLabel, turn }) {
    const started = Date.now();

    if (this.offline) {
      const scene = nextOfflineScene({ character, world, turn, chosenLabel });
      return { scene, meta: { mode: 'offline', ms: Date.now() - started, attempts: 1 } };
    }

    const userMessage = buildTurnMessage({ character, world, history, chosenLabel, turn });
    const blocked = [];

    for (let attempt = 1; attempt <= MAX_REGENERATIONS + 1; attempt++) {
      const { data: scene, blocked: refused, reason } = await this.model.generate({
        system: SYSTEM_PROMPT,
        user: attempt > 1 ? userMessage + RETRY_HINT : userMessage,
        schema: SCENE_SCHEMA,
        maxTokens: 4096,
      });

      if (refused || scene === null) {
        blocked.push({ attempt, layer: 'provider', detail: reason || '응답을 해석하지 못함' });
        this.onLog({ type: 'blocked', layer: 'provider', detail: reason || '응답을 해석하지 못함' });
        continue;
      }

      // 안전 계층 ③-a: 규칙 기반 필터 (즉시)
      const ruled = screenOutput(scene);
      if (!ruled.ok) {
        blocked.push({ attempt, layer: 'rule-filter', detail: ruled.matched });
        this.onLog({ type: 'blocked', layer: 'rule-filter', detail: ruled.matched });
        continue;
      }

      // 안전 계층 ③-b: 모델 기반 재검사
      if (this.useModelClassifier) {
        const verdict = await classifyWithModel(this.model, scene);
        if (!verdict.safe) {
          blocked.push({ attempt, layer: 'model-classifier', detail: verdict.reason });
          this.onLog({ type: 'blocked', layer: 'model-classifier', detail: verdict.reason });
          continue;
        }
      }

      return {
        scene,
        meta: { mode: 'live', ms: Date.now() - started, attempts: attempt, blocked },
      };
    }

    // 재생성을 모두 소진 → 최후의 안전망
    this.onLog({ type: 'fallback', detail: '재생성 한도 초과' });
    return {
      scene: fallbackScene(world),
      meta: { mode: 'fallback', ms: Date.now() - started, attempts: MAX_REGENERATIONS + 1, blocked },
    };
  }
}
