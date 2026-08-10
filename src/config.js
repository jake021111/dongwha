/**
 * 프리셋 정의 = 안전 설계 1계층(입력 가드).
 *
 * 아이가 넣을 수 있는 값은 원칙적으로 여기 있는 ID뿐이다.
 * 자유 입력은 '이름' 하나로 제한하고, 그마저도 safety.js에서 화이트리스트 정규식으로 검사한다.
 */

export const APPEARANCES = [
  { id: 'knight', emoji: '🧝', label: '반짝이 요정' },
  { id: 'cat', emoji: '🐱', label: '용감한 고양이' },
  { id: 'robot', emoji: '🤖', label: '똑똑한 로봇' },
  { id: 'dino', emoji: '🦕', label: '초록 공룡' },
  { id: 'bear', emoji: '🐻', label: '포근한 곰돌이' },
  { id: 'star', emoji: '⭐', label: '반짝 별님' },
  { id: 'bunny', emoji: '🐰', label: '깡충 토끼' },
  { id: 'penguin', emoji: '🐧', label: '뒤뚱 펭귄' },
];

export const TRAITS = [
  { id: 'brave', emoji: '🔥', label: '용감해요' },
  { id: 'kind', emoji: '💖', label: '친절해요' },
  { id: 'smart', emoji: '💡', label: '똑똑해요' },
  { id: 'fast', emoji: '💨', label: '빨라요' },
  { id: 'funny', emoji: '😆', label: '웃겨요' },
  { id: 'strong', emoji: '💪', label: '힘이 세요' },
  { id: 'curious', emoji: '🔍', label: '궁금한 게 많아요' },
  { id: 'singer', emoji: '🎵', label: '노래를 잘해요' },
];

export const WORLDS = [
  {
    id: 'forest',
    emoji: '🌳',
    label: '반짝이는 숲',
    backdrop: 'forest',
    seed: '햇빛이 반짝이는 커다란 숲. 말하는 동물 친구들과 달콤한 열매가 가득하다.',
  },
  {
    id: 'space',
    emoji: '🚀',
    label: '무지개 우주',
    backdrop: 'space',
    seed: '알록달록한 별과 폭신한 구름 행성이 떠 있는 우주. 작은 우주선을 타고 다닌다.',
  },
  {
    id: 'ocean',
    emoji: '🐠',
    label: '반짝 바닷속',
    backdrop: 'ocean',
    seed: '따뜻한 바닷속 마을. 물고기 친구들과 산호 정원, 반짝이는 조개가 있다.',
  },
  {
    id: 'candy',
    emoji: '🍭',
    label: '달콤 과자나라',
    backdrop: 'candy',
    seed: '초콜릿 강과 사탕 나무가 있는 과자 마을. 젤리 친구들이 산다.',
  },
];

/**
 * 장면 삽화용 아트 토큰 화이트리스트.
 * (이미지 생성 AI는 같은 캐릭터를 매번 똑같이 그리기 어렵고 검열도 어렵다 →
 *  기획서 권고대로 초기에는 프리셋 아트로 우회한다.)
 * 모델은 이 ID 밖의 값을 낼 수 없다(structured outputs의 enum으로 강제).
 */
export const BACKDROPS = {
  forest: { emoji: '🌲', sky: 'linear-gradient(180deg,#cdeecd,#8fd39a)' },
  space: { emoji: '🌌', sky: 'linear-gradient(180deg,#2b2560,#5a4fa3)' },
  ocean: { emoji: '🌊', sky: 'linear-gradient(180deg,#a5e5f5,#3fa9d4)' },
  candy: { emoji: '🍬', sky: 'linear-gradient(180deg,#ffe0f0,#ffb3d1)' },
  cave: { emoji: '🪨', sky: 'linear-gradient(180deg,#cfc7bb,#9d9182)' },
  village: { emoji: '🏘️', sky: 'linear-gradient(180deg,#ffeec2,#ffcf8f)' },
  meadow: { emoji: '🌼', sky: 'linear-gradient(180deg,#e6f7c9,#b5e08a)' },
  night: { emoji: '🌙', sky: 'linear-gradient(180deg,#3b4a80,#6f7fc0)' },
};

export const PROPS = {
  tree: '🌳', flower: '🌸', mushroom: '🍄', river: '💧', rainbow: '🌈',
  star: '⭐', cloud: '☁️', sun: '☀️', moon: '🌙', gift: '🎁',
  key: '🗝️', door: '🚪', boat: '⛵', rocket: '🚀', shell: '🐚',
  cake: '🍰', candy: '🍬', book: '📖', music: '🎵', lantern: '🏮',
  bridge: '🌉', treasure: '💎', map: '🗺️', ball: '⚽', balloon: '🎈',
};

export const FRIENDS = {
  rabbit: '🐰', fox: '🦊', owl: '🦉', bear: '🐻', turtle: '🐢',
  fish: '🐠', whale: '🐳', crab: '🦀', bird: '🐦', squirrel: '🐿️',
  dog: '🐶', cat: '🐱', bee: '🐝', butterfly: '🦋', frog: '🐸',
  robot: '🤖', alien: '👽', ghost_friendly: '👻', dragon: '🐲', unicorn: '🦄',
};

export const STICKERS = {
  courage_badge: { emoji: '🏅', label: '용기 배지' },
  friend_heart: { emoji: '💝', label: '우정 하트' },
  clever_gem: { emoji: '💎', label: '지혜 보석' },
  star_seal: { emoji: '🌟', label: '반짝 도장' },
  flower_crown: { emoji: '👑', label: '꽃 왕관' },
  music_note: { emoji: '🎶', label: '노래 쪽지' },
  map_piece: { emoji: '🧩', label: '지도 조각' },
  rainbow_ribbon: { emoji: '🎀', label: '무지개 리본' },
};

export const STATS = {
  brave: { emoji: '🔥', label: '용기' },
  wise: { emoji: '💡', label: '지혜' },
  kind: { emoji: '💖', label: '친절' },
};

// 이름 프리셋(글자를 잘 못 쓰는 아이를 위해 '고르기'도 제공)
export const NAME_SUGGESTIONS = [
  '별이', '토리', '루루', '코코', '하늘', '반짝', '뭉치', '초코',
  '방울', '두리', '미르', '노을', '솜이', '햇살',
];

// 자유 서술을 어려워하는 아이를 위한 예시 (탭하면 입력창에 들어간다)
export const DESC_EXAMPLES = [
  '무지개 날개가 달린 파란 고양이예요',
  '별을 모으는 걸 좋아하는 작은 로봇이에요',
  '구름으로 만든 솜사탕을 먹고 살아요',
  '노래를 부르면 꽃이 피어나요',
  '주머니에 신기한 물건이 잔뜩 들어 있어요',
  '아주 작지만 힘이 세요',
];

export const findById = (list, id) => list.find((x) => x.id === id) || null;
