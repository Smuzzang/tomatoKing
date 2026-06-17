/* =========================================================================
 * rules.js — 맞고 점수 계산 (순수 함수)
 * captured: 한 플레이어가 먹은 카드 배열
 * ======================================================================= */

const HONG_MONTHS = [1, 2, 3];   // 홍단
const CHEONG_MONTHS = [6, 9, 10]; // 청단
const CHO_MONTHS = [4, 5, 7];     // 초단

/* 카드 배열을 카테고리별로 분류 */
function classify(captured) {
  const gwang = captured.filter(c => c.type === 'gwang');
  // 국진이 쌍피로 선택되면 열끗이 아니라 피로 셈
  const animals = captured.filter(c => c.type === 'animal' && !(c.kukjin && c.kukjinAsPi));
  const ribbons = captured.filter(c => c.type === 'ribbon');
  const junks = captured.filter(c => c.type === 'junk');
  const kukjinPi = captured.filter(c => c.type === 'animal' && c.kukjin && c.kukjinAsPi).length;
  const piTotal = junks.reduce((s, c) => s + (c.piValue || 1), 0) + kukjinPi * 2;
  return { gwang, animals, ribbons, junks, piTotal };
}

/* 점수 상세 계산 → { total, parts:[{label, pts}], piTotal, gwangPts, ... } */
function scoreOf(captured) {
  const { gwang, animals, ribbons, piTotal } = classify(captured);
  const parts = [];
  let total = 0;

  // 광
  let gwangPts = 0;
  const n = gwang.length;
  const hasBi = gwang.some(c => c.bi);
  if (n >= 5) gwangPts = 15;
  else if (n === 4) gwangPts = 4;
  else if (n === 3) gwangPts = hasBi ? 2 : 3;
  if (gwangPts) { parts.push({ label: `${n}광`, pts: gwangPts }); total += gwangPts; }

  // 고도리 (2·4·8월 새 3장)
  const godori = animals.filter(c => c.godori).length;
  if (godori >= 3) { parts.push({ label: '고도리', pts: 5 }); total += 5; }

  // 열끗 (5장부터 1점, 추가 1장당 +1)
  const animalPts = animals.length >= 5 ? animals.length - 4 : 0;
  if (animalPts) { parts.push({ label: `열끗 ${animals.length}장`, pts: animalPts }); total += animalPts; }

  // 띠
  const hong = ribbons.filter(c => HONG_MONTHS.includes(c.month)).length;
  const cheong = ribbons.filter(c => CHEONG_MONTHS.includes(c.month)).length;
  const cho = ribbons.filter(c => CHO_MONTHS.includes(c.month)).length;
  if (hong >= 3) { parts.push({ label: '홍단', pts: 3 }); total += 3; }
  if (cheong >= 3) { parts.push({ label: '청단', pts: 3 }); total += 3; }
  if (cho >= 3) { parts.push({ label: '초단', pts: 3 }); total += 3; }
  const ribbonPts = ribbons.length >= 5 ? ribbons.length - 4 : 0;
  if (ribbonPts) { parts.push({ label: `띠 ${ribbons.length}장`, pts: ribbonPts }); total += ribbonPts; }

  // 피 (10장부터 1점)
  const piPts = piTotal >= 10 ? piTotal - 9 : 0;
  if (piPts) { parts.push({ label: `피 ${piTotal}장`, pts: piPts }); total += piPts; }

  return { total, parts, piTotal, gwangPts, animalCount: animals.length, ribbonCount: ribbons.length };
}

/* 박(bak) 배수 계산
 * winnerCap / loserCap: 카드 배열
 * opts: { goCount, goBak(상대고박), shake(흔들기 횟수) }
 * → { multiplier, flags:[...] }  */
function bakMultiplier(winnerCap, loserCap, opts = {}) {
  const w = scoreOf(winnerCap);
  const l = classify(loserCap);
  let mult = 1;
  const flags = [];

  // 피박: 승자가 피로 점수 + 패자 피 ≤ 6
  if (w.piTotal >= 10 && l.piTotal <= 6) { mult *= 2; flags.push('피박'); }
  // 광박: 승자가 광점수 + 패자 광 0장
  if (w.gwangPts > 0 && l.gwang.length === 0) { mult *= 2; flags.push('광박'); }
  // 멍박(열끗박): 승자가 열끗 7장 이상 + 패자 열끗 0장
  if (w.animalCount >= 7 && l.animals.length === 0) { mult *= 2; flags.push('멍박'); }
  // 고박(독박): 패자가 마지막에 GO 외쳤는데 짐
  if (opts.goBak) { mult *= 2; flags.push('고박'); }
  // 흔들기
  if (opts.shake) { for (let i = 0; i < opts.shake; i++) { mult *= 2; } flags.push(`흔들기×${opts.shake}`); }
  // 폭탄
  if (opts.bomb) { for (let i = 0; i < opts.bomb; i++) { mult *= 2; } flags.push(`폭탄×${opts.bomb}`); }

  return { multiplier: mult, flags };
}

/* GO 보너스: base 점수에 고 횟수 반영
 * 1고 +1, 2고 +2, 3고부터 (base+go)×2^(go-2) */
function applyGo(base, goCount) {
  if (goCount <= 0) return base;
  let s = base + goCount; // 고당 +1 누적
  if (goCount >= 3) s = s * Math.pow(2, goCount - 2);
  return s;
}

window.Rules = { classify, scoreOf, bakMultiplier, applyGo,
  HONG_MONTHS, CHEONG_MONTHS, CHO_MONTHS };
