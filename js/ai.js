/* =========================================================================
 * ai.js — 싱글플레이 AI (휴리스틱)
 * 엔진 상태를 읽고 (낼 카드 / 매칭 선택 / 고·스톱)을 결정한다.
 * ======================================================================= */

/* 카드 가치 가중치 */
function cardValue(c) {
  if (c.type === 'gwang') return 20;
  if (c.type === 'animal') return c.godori ? 13 : 6;
  if (c.type === 'ribbon') {
    if (window.Rules.HONG_MONTHS.includes(c.month) ||
        window.Rules.CHEONG_MONTHS.includes(c.month) ||
        window.Rules.CHO_MONTHS.includes(c.month)) return 8; // 단 가능 띠
    return 5;
  }
  if (c.type === 'junk') return c.piValue === 2 ? 5 : 3;
  return 1;
}

/* 낼 카드 선택 */
function chooseCard(state) {
  const me = state.players[state.turn];
  let best = me.hand[0], bestScore = -Infinity;

  for (const card of me.hand) {
    const floorM = window.Engine.floorOfMonth(state, card.month);
    let gain;
    if (floorM.length >= 1) {
      // 먹는 수: 내 카드 확보 + 바닥 최고가 카드 회수 + 보너스
      const take = Math.max(...floorM.map(cardValue));
      gain = cardValue(card) + take + 6;
      if (floorM.length >= 3) gain += 12;        // 더미(뻑) 회수
      else if (floorM.length === 2) gain += 3;   // 선택권
    } else {
      // 못 먹음: 좋은 카드는 아껴두고 잡패부터 버림
      gain = cardValue(card) * 0.2 - cardValue(card) * 0.5;
    }
    if (gain > bestScore) { bestScore = gain; best = card; }
  }
  return best.id;
}

/* 2장 중 무엇을 가져갈지 */
function chooseMatch(state) {
  const opts = state.choice.options
    .map(id => state.floor.find(c => c.id === id))
    .filter(Boolean);
  opts.sort((a, b) => cardValue(b) - cardValue(a));
  return opts[0].id;
}

/* 고 / 스톱 */
function chooseGoStop(state) {
  const me = state.players[state.turn];
  const opp = state.players[window.Engine.oppOf(state.turn)];
  const s = me.scoreInfo ? me.scoreInfo.total : window.Rules.scoreOf(me.captured).total;
  const oppScore = window.Rules.scoreOf(opp.captured).total;
  const cardsLeft = me.hand.length;

  if (oppScore >= 5) return 'stop';   // 상대가 위협적 → 확정
  if (s >= 12) return 'stop';         // 충분히 큼
  if (cardsLeft <= 2) return 'stop';  // 더 키울 여지 적음
  if (s < 11 && oppScore < 4 && cardsLeft >= 3) return 'go';
  return 'stop';
}

window.AI = { cardValue, chooseCard, chooseMatch, chooseGoStop };
