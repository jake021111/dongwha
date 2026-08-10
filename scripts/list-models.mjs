/**
 * 쓸 수 있는 모델 목록 — `npm run list-models`
 *
 * 모델 이름은 예고 없이 바뀌고, 목록에 보여도 신규 키에는 막혀 있는 경우가 있다.
 * 404를 만나면 이 명령으로 지금 내 키에 열려 있는 모델을 확인하면 된다.
 */
import 'dotenv/config';

const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();

if (!geminiKey) {
  console.error('\n  .env 에 GEMINI_API_KEY 가 없습니다.');
  console.error('  (Claude 모델 목록은 https://platform.claude.com/docs 를 참고하세요.)\n');
  process.exitCode = 1;
} else {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': geminiKey },
  });

  if (!res.ok) {
    console.error(`\n✗ 조회 실패 (HTTP ${res.status})`);
    console.error(`  ${(await res.text()).slice(0, 300)}\n`);
    process.exitCode = 1;
  } else {
    const { models = [] } = await res.json();
    const usable = models
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''))
      // 이 앱에 맞는 것만: 텍스트 생성용 일반 모델
      .filter((id) => id.startsWith('gemini-') &&
        !/(image|tts|robotics|computer-use|deep-research|omni|embedding)/.test(id));

    console.log('\n  이 앱에 쓸 만한 모델 (텍스트 생성):\n');
    for (const id of usable) console.log('    ' + id);
    console.log('\n  .env 에서 골라 쓰세요:  GEMINI_MODEL=<이름>');
    console.log('  빠르고 저렴한 쪽은 이름에 flash-lite 가 붙은 모델입니다.');
    console.log('  고른 뒤 `npm run check-ai` 로 실제 동작을 확인하세요.\n');
  }
}
