/* =========================================================================
 * engine.js — 맞고(2인 고스톱) 룰 엔진 / 호스트 권위 상태머신
 *
 * 한 턴 흐름:
 *   1) 손패 1장 냄(play)  2) 더미 1장 뒤집음(flip)  3) 획득·특수이벤트 정산
 *   4) 점수 ≥ minGo 이면 고/스톱 선택  5) 차례 넘김
 *
 * 특수이벤트: 쪽 / 뻑 / 따닥 / 싹쓸이 / 뻑먹기(3장 더미 회수)
 * 박: 피박 / 광박 / 멍박 / 고박
 * (폭탄·흔들기는 v2 예정)
 * ======================================================================= */

const MIN_GO = 7; // 맞고 정통: 7점 이상부터 고/스톱

/* ---- 유틸 ---- */
function oppOf(i) { return 1 - i; }

function removeById(arr, ids) {
  const set = new Set(Array.isArray(ids) ? ids : [ids]);
  for (let i = arr.length - 1; i >= 0; i--) if (set.has(arr[i].id)) arr.splice(i, 1);
}

function floorOfMonth(state, month) {
  return state.floor.filter(c => c.month === month);
}

/* 상대에게서 피 count장 빼앗기 (일반 피 우선) */
function stealPi(state, fromIdx, toIdx, count) {
  const from = state.players[fromIdx].captured;
  const to = state.players[toIdx].captured;
  let stolen = 0;
  for (let k = 0; k < count; k++) {
    // 일반 피(piValue 1) 우선, 없으면 쌍피
    let idx = from.findIndex(c => c.type === 'junk' && c.piValue === 1);
    if (idx === -1) idx = from.findIndex(c => c.type === 'junk');
    if (idx === -1) break;
    to.push(from.splice(idx, 1)[0]);
    stolen++;
  }
  return stolen;
}

/* ---- 게임 시작 ---- */
function newGame({ seed, names = ['나', '상대'], aiFlags = [false, true], mode = 'classic' }) {
  const rng = window.Hwatu.makeRng(seed >>> 0);
  let deck, floor, hands;
  // 딜링 (특수상황이면 재딜)
  for (let tries = 0; tries < 50; tries++) {
    const shuffled = window.Hwatu.shuffle(window.Hwatu.createDeck(), rng);
    hands = [shuffled.slice(0, 10), shuffled.slice(10, 20)];
    floor = shuffled.slice(20, 28);
    deck = shuffled.slice(28); // 20장
    // 바닥에 같은 월 4장 → 재딜
    const cnt = {};
    floor.forEach(c => cnt[c.month] = (cnt[c.month] || 0) + 1);
    if (Object.values(cnt).some(v => v >= 4)) continue;
    break;
  }

  const state = {
    seed, mode, minGo: MIN_GO,
    deck, floor,
    players: [0, 1].map(i => ({
      id: i, name: names[i], isAI: aiFlags[i],
      hand: hands[i], captured: [],
      goCount: 0, scoreAtGo: 0, shake: 0,
    })),
    turn: 0,           // 선(先) = 0
    starter: 0,
    phase: 'await_play',
    choice: null,
    turnCtx: null,
    events: [],
    winner: null,
    result: null,
  };

  // 총통: 손패 4장 같은 월 → 즉시 승
  for (let i = 0; i < 2; i++) {
    const cnt = {};
    state.players[i].hand.forEach(c => cnt[c.month] = (cnt[c.month] || 0) + 1);
    const m = Object.keys(cnt).find(k => cnt[k] >= 4);
    if (m) {
      state.phase = 'ended';
      state.winner = i;
      state.result = { winner: i, base: 7, withGo: 7, multiplier: 1, flags: ['총통'], final: 7, goCount: 0, chongtong: true };
    }
  }
  return state;
}

/* 현재 차례 플레이어가 낼 수 있는 손패 + 매칭 힌트 */
function handHints(state) {
  const me = state.players[state.turn];
  return me.hand.map(c => ({
    id: c.id,
    matches: floorOfMonth(state, c.month).length,
  }));
}

/* ---- 손패 내기 ---- */
function playCard(state, cardId) {
  if (state.phase !== 'await_play') return err('지금은 카드를 낼 수 없습니다');
  const me = state.players[state.turn];
  const hi = me.hand.findIndex(c => c.id === cardId);
  if (hi === -1) return err('손에 없는 카드');
  const h = me.hand.splice(hi, 1)[0];
  const d = state.deck.length ? state.deck.shift() : null; // 더미 위(top) 한 장
  state.turnCtx = { h, d, hcap: [], dcap: [], pi: 0, took3: false, events: [] };
  state.playSeq = (state.playSeq || 0) + 1;
  state.lastPlay = { hand: h, deck: d, by: state.turn, seq: state.playSeq };
  return beginResolve(state);
}

function beginResolve(state) {
  const ctx = state.turnCtx;
  const { h, d } = ctx;
  const M = h.month;
  const floorM = floorOfMonth(state, M);

  if (d && d.month === M) {
    // ── 같은 월 특수 (손패·뒤집은패가 같은 월) ──
    if (floorM.length === 0) {
      // 쪽: 바닥에 없던 월인데 더미가 손패와 짝 → 둘 다 먹고 피 1장
      ctx.hcap = [h, d]; ctx.events.push('쪽'); ctx.pi += 1;
    } else if (floorM.length === 1) {
      // 뻑: 바닥1 + 손패 + 더미 = 3장 쌓임, 회수 못함
      state.floor.push(h); state.floor.push(d);
      ctx.events.push('뻑');
    } else if (floorM.length >= 2) {
      // 4장 완성 → 싹 회수 + 피 1장
      const take = floorM.slice(0, 2);
      removeById(state.floor, take.map(c => c.id));
      ctx.hcap = [h, d, ...take]; ctx.took3 = true;
      ctx.events.push('따닥');
    }
    return finalizeTurn(state);
  }

  // ── 일반: 손패 먼저, 그다음 더미 ──
  return resolveStage(state, 'hand', h);
}

function resolveStage(state, stage, card) {
  const ctx = state.turnCtx;
  if (!card) { return proceedAfter(state, stage); } // 더미 소진 등

  const fm = floorOfMonth(state, card.month);
  if (fm.length === 0) {
    state.floor.push(card);
    setCap(ctx, stage, []);
    return proceedAfter(state, stage);
  }
  if (fm.length === 1) {
    removeById(state.floor, fm[0].id);
    setCap(ctx, stage, [card, fm[0]]);
    return proceedAfter(state, stage);
  }
  if (fm.length === 2) {
    // 선택 필요
    state.phase = 'await_match';
    state.choice = { stage, cardId: card.id, options: fm.map(c => c.id) };
    return { ok: true, needChoice: true };
  }
  // 3장 이상 (뻑 더미 회수)
  removeById(state.floor, fm.map(c => c.id));
  setCap(ctx, stage, [card, ...fm]);
  ctx.took3 = true;
  return proceedAfter(state, stage);
}

function setCap(ctx, stage, arr) {
  if (stage === 'hand') ctx.hcap = arr; else ctx.dcap = arr;
}

/* 2장 중 선택 해소 */
function resolveMatch(state, chosenId) {
  if (state.phase !== 'await_match') return err('선택할 게 없습니다');
  const ctx = state.turnCtx;
  const ch = state.choice;
  if (!ch.options.includes(chosenId)) return err('잘못된 선택');
  const card = (ch.cardId === ctx.h.id) ? ctx.h : ctx.d;
  const chosen = state.floor.find(c => c.id === chosenId);
  removeById(state.floor, chosenId);
  setCap(ctx, ch.stage, [card, chosen]);
  state.choice = null;
  state.phase = 'await_play'; // 임시; proceedAfter가 다시 설정
  return proceedAfter(state, ch.stage);
}

function proceedAfter(state, stage) {
  if (stage === 'hand') return resolveStage(state, 'deck', state.turnCtx.d);
  return finalizeTurn(state);
}

function finalizeTurn(state) {
  const ctx = state.turnCtx;
  const me = state.players[state.turn];
  const cap = [...ctx.hcap, ...ctx.dcap];

  // 따닥: 손패·더미 양쪽 다 먹음(서로 다른 월)
  if (ctx.hcap.length && ctx.dcap.length && !ctx.events.includes('따닥')) {
    ctx.events.push('따닥'); ctx.pi += 1;
  }
  // 뻑먹기(3장 더미 회수)
  if (ctx.took3 && !ctx.events.includes('따닥')) { ctx.pi += 1; ctx.events.push('뻑먹기'); }

  me.captured.push(...cap);

  // 싹쓸이: 바닥이 비었고 뭔가 먹었을 때
  if (cap.length > 0 && state.floor.length === 0) { ctx.events.push('싹쓸이'); ctx.pi += 1; }

  // 피 뺏기
  if (ctx.pi > 0) {
    const got = stealPi(state, oppOf(state.turn), state.turn, ctx.pi);
    if (got > 0) ctx.events.push(`피 +${got}`);
  }

  state.events = ctx.events.slice();
  me.scoreInfo = window.Rules.scoreOf(me.captured);
  const score = me.scoreInfo.total;

  // 고/스톱 판단: minGo 이상 + 직전 고시점보다 점수 상승
  if (score >= state.minGo && score > me.scoreAtGo) {
    state.phase = 'await_go_stop';
    state.turnCtx = null;
    return { ok: true, goStop: true };
  }
  return endTurnAdvance(state);
}

function endTurnAdvance(state) {
  state.turnCtx = null;
  state.choice = null;
  // 나가리: 양쪽 손패 소진
  if (state.players[0].hand.length === 0 && state.players[1].hand.length === 0) {
    state.phase = 'ended';
    state.result = { draw: true };
    return { ok: true, ended: true };
  }
  state.turn = oppOf(state.turn);
  state.phase = 'await_play';
  return { ok: true };
}

/* 고/스톱 결정 */
function decideGoStop(state, decision) {
  if (state.phase !== 'await_go_stop') return err('고/스톱 차례가 아닙니다');
  const me = state.players[state.turn];
  if (decision === 'go') {
    me.goCount++;
    me.scoreAtGo = me.scoreInfo.total;
    return endTurnAdvance(state);
  }
  // stop → 승리
  return finishGame(state, state.turn);
}

function finishGame(state, winner) {
  const w = state.players[winner];
  const lo = state.players[oppOf(winner)];
  const base = window.Rules.scoreOf(w.captured).total;
  const withGo = window.Rules.applyGo(base, w.goCount);
  const goBak = lo.goCount > 0; // 패자가 고 외쳤었다 → 고박
  const bak = window.Rules.bakMultiplier(w.captured, lo.captured, { goBak, shake: w.shake });
  const final = withGo * bak.multiplier;
  state.phase = 'ended';
  state.winner = winner;
  state.result = {
    winner, base, withGo, multiplier: bak.multiplier,
    flags: bak.flags, final, goCount: w.goCount, goBak,
  };
  return { ok: true, ended: true };
}

function err(msg) { return { ok: false, error: msg }; }

/* 직렬화: 네트워크 전송용 (turnCtx 등 내부상태 포함해 전체 복제) */
function clone(state) { return JSON.parse(JSON.stringify(state)); }

window.Engine = {
  MIN_GO, newGame, handHints, playCard, resolveMatch,
  decideGoStop, finishGame, floorOfMonth, clone, oppOf,
};
