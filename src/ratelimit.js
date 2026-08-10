/**
 * 아주 작은 인메모리 요청 제한기.
 *
 * 공개 링크로 열어 두면 두 가지를 막아야 한다:
 *   1) 한 사람이 새로고침을 연타해 남의 차례를 잡아먹는 것  → perIp
 *   2) 전체 트래픽이 무료 API 할당량을 태워 버리는 것        → globalBudget
 *
 * 프로세스가 하나라는 전제(무료 호스팅의 단일 인스턴스)에서만 정확하다.
 * 인스턴스를 늘릴 계획이라면 Redis 같은 공유 저장소로 옮겨야 한다.
 */

/** 고정 창(fixed window) 카운터 */
function createCounter(windowMs) {
  const hits = new Map(); // key → { count, resetAt }

  // 오래된 항목이 쌓이지 않게 주기적으로 청소
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
  }, windowMs).unref?.();
  void sweep;

  return {
    take(key, max) {
      const now = Date.now();
      const cur = hits.get(key);
      if (!cur || cur.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfter: 0 };
      }
      if (cur.count >= max) {
        return { ok: false, retryAfter: Math.ceil((cur.resetAt - now) / 1000) };
      }
      cur.count += 1;
      return { ok: true, retryAfter: 0 };
    },
    peek(key) {
      const cur = hits.get(key);
      return cur && cur.resetAt > Date.now() ? cur.count : 0;
    },
  };
}

/**
 * IP 단위 제한 미들웨어.
 * 아이가 화면을 여러 번 눌러도 막히지 않게 넉넉히 잡되, 자동화된 연타는 막는다.
 */
export function perIp({ windowMs = 60_000, max = 40, message }) {
  const counter = createCounter(windowMs);
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const { ok, retryAfter } = counter.take(key, max);
    if (ok) return next();
    res.set('retry-after', String(retryAfter));
    res.status(429).json({
      error: 'rate_limit',
      message: message ?? '조금만 천천히 눌러 주세요!',
    });
  };
}

/**
 * 서버 전체의 AI 호출 예산.
 * 무료 등급 할당량을 하루아침에 태우지 않도록 상한을 둔다.
 */
export function createBudget({ windowMs = 3_600_000, max = 400 }) {
  const counter = createCounter(windowMs);
  return {
    /** 호출 직전에 부른다. false 면 이번 요청은 AI를 쓰지 않는다. */
    take() {
      return counter.take('global', max).ok;
    },
    used() {
      return counter.peek('global');
    },
    max,
  };
}
