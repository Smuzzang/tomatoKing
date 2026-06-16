/* =========================================================================
 * cards.js — 화투(花鬪) 48장 데이터 + SVG 렌더링
 * 외부 이미지 의존 없음. 모든 카드를 코드로 그린다.
 * ======================================================================= */

/* 월별 테마: 모티프 이모지 / 대표색 / 한글 이름 */
const MONTH_THEME = {
  1:  { name: '송학',   emoji: '🌅', color: '#1f7a4d', sub: '소나무·학' },
  2:  { name: '매조',   emoji: '🐦', color: '#d6477f', sub: '매화·꾀꼬리' },
  3:  { name: '벚꽃',   emoji: '🌸', color: '#e86a9a', sub: '벚꽃' },
  4:  { name: '흑싸리', emoji: '🦅', color: '#6a4a8a', sub: '흑싸리·두견' },
  5:  { name: '난초',   emoji: '🌿', color: '#2e8b57', sub: '난초·다리' },
  6:  { name: '모란',   emoji: '🦋', color: '#b03060', sub: '모란·나비' },
  7:  { name: '홍싸리', emoji: '🐗', color: '#c0504d', sub: '홍싸리·멧돼지' },
  8:  { name: '공산',   emoji: '🌕', color: '#5a6678', sub: '공산·기러기' },
  9:  { name: '국진',   emoji: '🍶', color: '#c98a1b', sub: '국화·술잔' },
  10: { name: '단풍',   emoji: '🍁', color: '#c8502a', sub: '단풍·사슴' },
  11: { name: '오동',   emoji: '🪶', color: '#7a5a3a', sub: '오동·봉황' },
  12: { name: '비',     emoji: '🌧️', color: '#2f5c8a', sub: '비·제비' },
};

/* 띠 색상 */
const RIBBON_COLOR = {
  hong:  '#d93a3a', // 홍단 (붉은 글씨띠)
  cheong:'#2f5fd0', // 청단 (푸른 글씨띠)
  cho:   '#c0392b', // 초단 (풀잎 붉은띠)
  plain: '#b0392b', // 비띠
};

/* 타입 배지 라벨 */
function typeBadge(card) {
  if (card.type === 'gwang') return '광';
  if (card.type === 'animal') return card.godori ? '고도리' : '열끗';
  if (card.type === 'ribbon') {
    return { hong: '홍단', cheong: '청단', cho: '초단', plain: '비띠' }[card.ribbon] || '띠';
  }
  if (card.type === 'junk') return card.piValue === 2 ? '쌍피' : '피';
  return '';
}

/* -------------------------------------------------------------------------
 * 덱 정의 — 월마다 정확히 4장
 * type: gwang | animal | ribbon | junk
 * ribbon: hong | cheong | cho | plain
 * godori: 고도리 새 (2·4·8월)
 * piValue: junk 일 때 1(피) / 2(쌍피)
 * bi: 비(雨) 계열 (12월) — 비광/비띠 구분용
 * ----------------------------------------------------------------------- */
const MONTH_CARDS = {
  1:  [{ type: 'gwang' }, { type: 'ribbon', ribbon: 'hong' }, { type: 'junk' }, { type: 'junk' }],
  2:  [{ type: 'animal', godori: true }, { type: 'ribbon', ribbon: 'hong' }, { type: 'junk' }, { type: 'junk' }],
  3:  [{ type: 'gwang' }, { type: 'ribbon', ribbon: 'hong' }, { type: 'junk' }, { type: 'junk' }],
  4:  [{ type: 'animal', godori: true }, { type: 'ribbon', ribbon: 'cho' }, { type: 'junk' }, { type: 'junk' }],
  5:  [{ type: 'animal' }, { type: 'ribbon', ribbon: 'cho' }, { type: 'junk' }, { type: 'junk' }],
  6:  [{ type: 'animal' }, { type: 'ribbon', ribbon: 'cheong' }, { type: 'junk' }, { type: 'junk' }],
  7:  [{ type: 'animal' }, { type: 'ribbon', ribbon: 'cho' }, { type: 'junk' }, { type: 'junk' }],
  8:  [{ type: 'gwang' }, { type: 'animal', godori: true }, { type: 'junk' }, { type: 'junk' }],
  9:  [{ type: 'animal', kukjin: true }, { type: 'ribbon', ribbon: 'cheong' }, { type: 'junk' }, { type: 'junk' }],
  10: [{ type: 'animal' }, { type: 'ribbon', ribbon: 'cheong' }, { type: 'junk' }, { type: 'junk' }],
  11: [{ type: 'gwang' }, { type: 'junk', piValue: 2 }, { type: 'junk' }, { type: 'junk' }],
  12: [{ type: 'gwang', bi: true }, { type: 'animal' }, { type: 'ribbon', ribbon: 'plain', bi: true }, { type: 'junk', piValue: 2 }],
};

/* 덱 한 벌 생성 (정렬된 48장) */
function createDeck() {
  const deck = [];
  for (let m = 1; m <= 12; m++) {
    MONTH_CARDS[m].forEach((c, i) => {
      deck.push({
        id: `m${m}_${i}`,
        month: m,
        type: c.type,
        ribbon: c.ribbon || null,
        godori: !!c.godori,
        kukjin: !!c.kukjin,
        bi: !!c.bi,
        piValue: c.type === 'junk' ? (c.piValue || 1) : 0,
        name: MONTH_THEME[m].name,
      });
    });
  }
  return deck;
}

/* 시드 기반 셔플 (Fisher–Yates). 시드를 넘기면 재현 가능 → 온라인 동기화에 사용 */
function shuffle(arr, rng) {
  const a = arr.slice();
  const rand = rng || Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 간단한 시드 PRNG (mulberry32) */
function makeRng(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/* -------------------------------------------------------------------------
 * SVG 카드 렌더링
 * card === null  → 뒷면
 * ----------------------------------------------------------------------- */
/* ---- 플랫 화투 일러스트 빌더 ---- */
function blossom(cx, cy, r, pc, cc) {
  let s = '<g>';
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5;
    s += `<circle cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r).toFixed(1)}" r="${(r * 0.66).toFixed(1)}" fill="${pc}"/>`;
  }
  s += `<circle cx="${cx}" cy="${cy}" r="${(r * 0.46).toFixed(1)}" fill="${cc}"/></g>`;
  return s;
}
function branch(d, col, w) { return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`; }
function leaf(cx, cy, rx, ry, col, rot) { return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${col}" transform="rotate(${rot} ${cx} ${cy})"/>`; }
function bird(cx, cy, s, body, wing) {
  return `<g><path d="M${cx} ${cy} q${-6 * s} ${-5 * s} ${-11 * s} ${-2 * s} q${5 * s} ${1 * s} ${8 * s} ${4 * s}Z" fill="${wing}"/>`
    + `<path d="M${cx} ${cy} q${6 * s} ${-5 * s} ${11 * s} ${-2 * s} q${-5 * s} ${1 * s} ${-8 * s} ${4 * s}Z" fill="${wing}"/>`
    + `<ellipse cx="${cx}" cy="${cy + 1.5 * s}" rx="${3 * s}" ry="${4 * s}" fill="${body}"/>`
    + `<circle cx="${cx}" cy="${cy - 2 * s}" r="${2 * s}" fill="${body}"/></g>`;
}
/* 세로 띠(리본) */
function ribbon(card) {
  const col = card.ribbon === 'cheong' ? '#2f63d6' : card.ribbon === 'plain' ? '#d6502a' : '#d6342e';
  const dark = shade(col, -45);
  let marks = '';
  if (card.ribbon === 'hong' || card.ribbon === 'cheong') {
    const mc = card.ribbon === 'hong' ? '#7a1010' : '#fff';
    marks = `<g stroke="${mc}" stroke-width="1.6" stroke-linecap="round" opacity="0.85">
      <line x1="33" y1="30" x2="39" y2="30"/><line x1="36" y1="27" x2="36" y2="41"/>
      <line x1="33" y1="52" x2="39" y2="52"/><line x1="33" y1="60" x2="39" y2="60"/><line x1="36" y1="50" x2="36" y2="64"/></g>`;
  }
  return `<rect x="29" y="16" width="14" height="68" rx="3" fill="${col}" stroke="${dark}" stroke-width="1"/>
    <rect x="29" y="16" width="5" height="68" rx="3" fill="#fff" opacity="0.18"/>${marks}`;
}

/* 월별 식물(모든 카드 공통 배경) */
function plant(month) {
  switch (month) {
    case 1: return branch('M20 92 Q30 70 26 50', '#5a3a1e', 3) +
      `<g>${leaf(24,52,9,4,'#1f6b3a',-30)}${leaf(22,62,9,4,'#1f6b3a',-10)}${leaf(28,72,9,4,'#1f6b3a',20)}${leaf(50,86,9,4,'#1f6b3a',60)}</g>`;
    case 2: return branch('M18 90 Q34 64 52 58', '#6b4423', 2.6) +
      blossom(48, 54, 6, '#f06a9a', '#ffe08a') + blossom(34, 64, 5, '#f06a9a', '#ffe08a') + blossom(22, 80, 5, '#f48ab0', '#ffe08a');
    case 3: return branch('M20 92 Q30 70 44 60', '#6b4423', 2.6) +
      blossom(46, 56, 6.5, '#f8b6cf', '#e86a9a') + blossom(30, 70, 6, '#f8b6cf', '#e86a9a') + blossom(50, 78, 5, '#fcd0e0', '#e86a9a');
    case 4: return branch('M40 14 Q34 50 24 90', '#2e2a26', 2.4) +
      `<g fill="#2f2f33">${leaf(30,40,4,9,'#2f2f33',20)}${leaf(26,58,4,10,'#2f2f33',15)}${leaf(22,76,4,10,'#2f2f33',10)}${leaf(40,34,4,9,'#2f2f33',-25)}</g>`;
    case 5: return branch('M28 92 L30 50 M40 92 L38 54 M34 92 L34 48', '#2e7d4f', 2.4) +
      blossom(30, 44, 6, '#7a4fb0', '#ffe08a') + blossom(42, 50, 5, '#9a6fd0', '#ffe08a');
    case 6: return `<g>${leaf(24,84,5,9,'#2e7d4f',-20)}${leaf(48,84,5,9,'#2e7d4f',20)}</g>` +
      blossom(36, 60, 9, '#c0306a', '#ffd24a') + blossom(24, 50, 6, '#d65a88', '#ffd24a');
    case 7: return branch('M30 92 Q34 64 40 40', '#7a3a2a', 2.4) +
      `<g>${leaf(34,56,5,8,'#c03030',10)}${leaf(44,48,5,8,'#c03030',-20)}${leaf(26,68,5,8,'#b82c2c',25)}</g>`;
    case 8: return `<path d="M8 96 Q36 84 64 96" fill="#3a4a3a"/>` +
      branch('M22 92 Q24 74 20 60 M40 92 Q42 72 46 58 M52 92 Q50 76 54 64', '#7a8a5a', 1.6);
    case 9: return branch('M28 92 Q32 66 40 48', '#2e7d4f', 2.4) +
      blossom(42, 44, 7, '#f0b81e', '#d6741e') + blossom(28, 56, 6, '#f5c93e', '#d6741e') + blossom(48, 60, 5, '#f0b81e', '#d6741e');
    case 10: return branch('M26 92 Q32 66 42 46', '#8a4a2a', 2.4) +
      maple(44, 42, 7, '#d6502a') + maple(28, 56, 6, '#e0732a') + maple(50, 62, 5, '#c0401e');
    case 11: return branch('M24 92 Q28 64 30 42', '#3a6a4a', 2.6) +
      `<g>${leaf(36,46,7,11,'#3a7a52',20)}${leaf(24,52,7,11,'#3a7a52',-15)}</g>` + blossom(40, 34, 4.5, '#9a6fd0', '#ffe08a');
    case 12: return branch('M44 12 Q40 40 30 70 Q26 84 22 94', '#5a3a1e', 2.6) +
      `<g stroke="#5fa0d0" stroke-width="1.4" opacity="0.8"><line x1="12" y1="40" x2="9" y2="58"/><line x1="20" y1="44" x2="17" y2="62"/><line x1="54" y1="38" x2="51" y2="56"/></g>`;
    default: return '';
  }
}
function maple(cx, cy, r, col) {
  let s = '<g>';
  for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i * 2 * Math.PI / 5; s += `<path d="M${cx} ${cy} L${(cx + Math.cos(a - 0.3) * r).toFixed(1)} ${(cy + Math.sin(a - 0.3) * r).toFixed(1)} L${(cx + Math.cos(a) * r * 1.3).toFixed(1)} ${(cy + Math.sin(a) * r * 1.3).toFixed(1)} L${(cx + Math.cos(a + 0.3) * r).toFixed(1)} ${(cy + Math.sin(a + 0.3) * r).toFixed(1)} Z" fill="${col}"/>`; }
  return s + '</g>';
}

/* 카드별 특수 요소(광/동물/쌍피) */
function feature(card) {
  const m = card.month;
  if (card.type === 'gwang') {
    if (m === 1) return disc(46, 30, 11, '#e23b2e') + crane(30, 40);
    if (m === 3) return `<rect x="12" y="14" width="48" height="13" rx="2" fill="#d6342e"/><g stroke="#fff" stroke-width="2">${'<line x1="20" y1="14" x2="20" y2="27"/><line x1="30" y1="14" x2="30" y2="27"/><line x1="40" y1="14" x2="40" y2="27"/><line x1="50" y1="14" x2="50" y2="27"/>'}</g>` + blossom(36, 50, 8, '#f8b6cf', '#e86a9a');
    if (m === 8) return disc(36, 32, 15, '#f3edd0', '#cfc7a0') + geese();
    if (m === 11) return phoenix(40, 52);
    if (m === 12) return rainman(38, 46);
    return disc(40, 32, 12, '#f0d040');
  }
  if (card.type === 'animal') {
    if (m === 2) return bird(46, 40, 1.2, '#3a8a3a', '#7bc043');           // 매조 꾀꼬리
    if (m === 4) return bird(40, 40, 1.2, '#23406a', '#2f7fd0');           // 흑싸리 두견
    if (m === 5) return `<path d="M16 64 Q36 50 56 64" fill="none" stroke="#a06a2a" stroke-width="4"/><rect x="14" y="62" width="44" height="4" fill="#8a5a22"/>`; // 다리
    if (m === 6) return butterfly(40, 46);                                  // 나비
    if (m === 7) return boar(36, 50);                                       // 멧돼지
    if (m === 8) return bird(40, 46, 1.3, '#222', '#444');                  // 기러기
    if (m === 9) return `<path d="M28 42 h16 l-2 9 q-6 4 -12 0 Z" fill="#d6b04a" stroke="#a07a1e" stroke-width="0.8"/><ellipse cx="36" cy="52" rx="9" ry="2.4" fill="#b03030"/>`; // 술잔
    if (m === 10) return deer(38, 50);                                      // 사슴
    if (m === 12) return bird(40, 60, 1.2, '#222', '#444');                 // 제비
    return '';
  }
  if (card.type === 'junk' && card.piValue === 2) {
    return `<g><circle cx="52" cy="92" r="9" fill="#caa23a"/><text x="52" y="95.5" text-anchor="middle" font-size="9" font-weight="900" fill="#fff">쌍</text></g>`;
  }
  return '';
}

function disc(cx, cy, r, fill, stroke) { return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="1.4"` : ''}/>`; }
function crane(cx, cy) { return `<g fill="#fff" stroke="#bbb" stroke-width="0.5"><ellipse cx="${cx}" cy="${cy}" rx="9" ry="4.5"/><circle cx="${cx - 8}" cy="${cy - 4}" r="2.5"/><path d="M${cx - 8} ${cy - 6} l-3 -5" stroke="#e23b2e" stroke-width="1.5"/><path d="M${cx + 6} ${cy + 3} l6 6 M${cx + 2} ${cy + 4} l4 7" stroke="#333" stroke-width="1.2"/></g>`; }
function geese() { return `<g fill="#2a2a2a">${bird(24, 70, 0.8, '#2a2a2a', '#444')}${bird(40, 78, 0.8, '#2a2a2a', '#444')}${bird(52, 68, 0.8, '#2a2a2a', '#444')}</g>`; }
function butterfly(cx, cy) { return `<g><ellipse cx="${cx - 6}" cy="${cy - 3}" rx="7" ry="9" fill="#5a3fb0" transform="rotate(-20 ${cx - 6} ${cy - 3})"/><ellipse cx="${cx + 6}" cy="${cy - 3}" rx="7" ry="9" fill="#7a5fd0" transform="rotate(20 ${cx + 6} ${cy - 3})"/><ellipse cx="${cx - 5}" cy="${cy + 7}" rx="5" ry="6" fill="#4a2f9a"/><ellipse cx="${cx + 5}" cy="${cy + 7}" rx="5" ry="6" fill="#6a4fc0"/><rect x="${cx - 1}" y="${cy - 6}" width="2" height="18" rx="1" fill="#2a1a4a"/></g>`; }
function boar(cx, cy) { return `<g fill="#5a4636"><ellipse cx="${cx}" cy="${cy}" rx="14" ry="9"/><circle cx="${cx - 13}" cy="${cy - 1}" r="5"/><path d="M${cx - 17} ${cy} l-3 1" stroke="#fff" stroke-width="1.5"/><rect x="${cx - 6}" y="${cy + 7}" width="2.5" height="6" fill="#3a2c20"/><rect x="${cx + 5}" y="${cy + 7}" width="2.5" height="6" fill="#3a2c20"/></g>`; }
function deer(cx, cy) { return `<g fill="#b07a44"><ellipse cx="${cx}" cy="${cy}" rx="12" ry="8"/><circle cx="${cx + 12}" cy="${cy - 5}" r="4.5"/><path d="M${cx + 11} ${cy - 9} l-2 -6 M${cx + 14} ${cy - 9} l3 -6" stroke="#7a4a22" stroke-width="1.3"/><rect x="${cx - 8}" y="${cy + 6}" width="2.4" height="7" fill="#7a5230"/><rect x="${cx + 6}" y="${cy + 6}" width="2.4" height="7" fill="#7a5230"/></g>`; }
function phoenix(cx, cy) { return `<g><path d="M${cx} ${cy} q-14 -10 -20 4 q10 -2 16 6" fill="#e0902a"/><path d="M${cx} ${cy} q14 -14 22 -2 q-10 -2 -16 8" fill="#f0b84a"/><ellipse cx="${cx}" cy="${cy + 2}" rx="6" ry="8" fill="#d6741e"/><circle cx="${cx}" cy="${cy - 6}" r="4" fill="#e0902a"/><path d="M${cx} ${cy + 9} l-3 10 m6 -10 l3 10" stroke="#c0401e" stroke-width="1.5"/></g>`; }
function rainman(cx, cy) { return `<g><path d="M${cx - 12} ${cy - 6} q12 -10 24 0 Z" fill="#2a2a2a"/><rect x="${cx - 1}" y="${cy - 6}" width="2" height="14" fill="#2a2a2a"/><circle cx="${cx}" cy="${cy + 11}" r="4" fill="#caa27a"/><rect x="${cx - 4}" y="${cy + 14}" width="8" height="12" rx="2" fill="#3a5a8a"/></g>`; }

/* 카드 → 실제 화투 이미지 경로 (cards/MMI.png, MM=월, I=월내 1~4) */
function cardImage(card) {
  const mm = String(card.month).padStart(2, '0');
  const idx = parseInt(card.id.split('_')[1], 10) + 1; // m{m}_{0..3} → 1..4
  return `cards/${mm}${idx}.png`;
}

function cardFaceSVG(card) {
  return `<img class="hwatu-svg" src="${cardImage(card)}" alt="${card.month}월 ${typeBadge(card)}" draggable="false" loading="lazy">`;
}

const RIBBON_KO = { hong: '홍단', cheong: '청단', cho: '초단', plain: '비' };

/* 색 밝기 조절 */
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function cardBackSVG() {
  return `<img class="hwatu-svg" src="cards/back.png" alt="뒷면" draggable="false">`;
}

/* DOM 요소 생성: 클릭 가능한 카드 */
function makeCardEl(card, { faceUp = true, small = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' card-sm' : '');
  el.innerHTML = faceUp && card ? cardFaceSVG(card) : cardBackSVG();
  if (card) el.dataset.cardId = card.id;
  return el;
}

/* 외부로 노출 */
window.Hwatu = {
  createDeck, shuffle, makeRng, typeBadge,
  cardFaceSVG, cardBackSVG, makeCardEl,
  MONTH_THEME,
};
