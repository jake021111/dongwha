/**
 * 오프라인 데모 모드.
 * ANTHROPIC_API_KEY가 없을 때 UX(그림·음성·선택 루프)를 그대로 확인할 수 있게
 * 미리 써 둔 장면을 돌려준다. AI 생성이 아니므로 이야기가 반복된다.
 */

/** 받침 유무에 따른 조사 선택 — 오프라인 문장이 어색하지 않게 */
function josa(word, withBatchim, withoutBatchim) {
  const last = word.charCodeAt(word.length - 1);
  const hasBatchim = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return word + (hasBatchim ? withBatchim : withoutBatchim);
}
const 이가 = (n) => josa(n, '이', '가');
const 은는 = (n) => josa(n, '은', '는');
const 을를 = (n) => josa(n, '을', '를');

const TEMPLATES = [
  {
    narration: (c, w) =>
      `${이가(c.name)} ${w.label}에 도착했어요. 발밑에서 반짝 빛이 났어요. ` +
      `작은 새 한 마리가 포르르 날아왔어요. 무언가 말하고 싶은 것 같아요.`,
    choices: [
      { emoji: '🐦', label: '새에게 인사해요' },
      { emoji: '✨', label: '반짝이는 빛을 봐요' },
      { emoji: '🌳', label: '주변을 둘러봐요' },
    ],
    art: { backdrop: 'meadow', props: ['flower', 'star'], friends: ['bird'] },
    reward: { sticker: 'none', stat: 'none' },
  },
  {
    narration: (c) =>
      `새가 작은 지도 조각을 떨어뜨렸어요. 지도에는 예쁜 문이 그려져 있어요. ` +
      `저 멀리 진짜 문이 보여요. ${은는(c.name)} 두근두근해요.`,
    choices: [
      { emoji: '🚪', label: '문으로 달려가요' },
      { emoji: '🗺️', label: '지도를 더 봐요' },
      { emoji: '🐦', label: '새에게 물어봐요' },
    ],
    art: { backdrop: 'forest', props: ['map', 'door'], friends: ['bird', 'rabbit'] },
    reward: { sticker: 'none', stat: 'none' },
  },
  {
    narration: (c) =>
      `문 앞에 토끼가 앉아 울고 있어요. 열쇠를 잃어버렸대요. ` +
      `${이가(c.name)} 함께 찾아 주자 토끼가 활짝 웃었어요. 문이 스르르 열렸어요!`,
    choices: [
      { emoji: '🐰', label: '토끼와 같이 들어가요' },
      { emoji: '🎁', label: '문 안을 살펴봐요' },
      { emoji: '💖', label: '토끼를 안아 줘요' },
    ],
    art: { backdrop: 'village', props: ['key', 'door', 'gift'], friends: ['rabbit'] },
    reward: { sticker: 'friend_heart', stat: 'kind' },
  },
  {
    narration: (c, w) =>
      `문 너머는 반짝이는 정원이었어요. 무지개 다리가 하늘로 이어져 있어요. ` +
      `친구들이 손을 흔들며 ${을를(c.name)} 불러요. 오늘 모험이 즐거웠어요.`,
    choices: [
      { emoji: '🌈', label: '무지개 다리를 건너요' },
      { emoji: '🎈', label: '친구들과 놀아요' },
      { emoji: '🍰', label: '간식을 나눠 먹어요' },
    ],
    art: { backdrop: 'candy', props: ['rainbow', 'cake', 'balloon'], friends: ['rabbit', 'butterfly'] },
    reward: { sticker: 'star_seal', stat: 'brave' },
  },
];

export function nextOfflineScene({ character, world, turn }) {
  const t = TEMPLATES[(turn - 1) % TEMPLATES.length];
  return {
    narration: t.narration(character, world),
    choices: t.choices,
    art: turn === 1 ? { ...t.art, backdrop: world.backdrop } : t.art,
    reward: t.reward,
    is_offline: true,
  };
}
