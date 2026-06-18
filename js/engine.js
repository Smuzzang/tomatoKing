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
  const stolen = []; // 뺏어온 카드들(연출용)
  for (let k = 0; k < count; k++) {
    // 일반 피(piValue 1) 우선, 없으면 쌍피
    let idx = from.findIndex(c => c.type === 'junk' && c.piValue === 1);
    if (idx === -1) idx = from.findIndex(c => c.type === 'junk');
    if (idx === -1) break;
    const card = from.splice(idx, 1)[0];
    to.push(card);
    stolen.push(card);
  }
  return stolen;
}

/* ---- 게임 시작 ---- */
function newGame({ seed, names = ['나', '상대'], aiFlags = [false, true], mode = 'classic', starter = 0 }) {
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
      goCount: 0, scoreAtGo: 0, shake: 0, bomb: 0, shakeMonths: [],
      shaken: [], // 흔든 패 공개용 [{month, cards:[3장]}]
      deckDebt: 0, // 폭탄으로 손패를 한꺼번에 털면 그만큼 더미패로 칠 "빚"이 쌓임
    })),
    turn: starter,     // 선(先)
    starter,
    phase: 'await_play',
    choice: null,
    ppeok: {},         // 월 → 뻑 만든 사람(자뻑 판정용)
    kukjinPending: null, // 국진 먹은 직후 무엇으로 쓸지 선택 대기
    turnCtx: null,
    extraTurn: false,  // 폭탄 시 한 번 더
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

/* 폭탄 가능한 월: 손 3장+바닥 1장 (3장 폭탄) 또는 손 2장+바닥 2장 (2장 폭탄) */
function bombableMonths(state) {
  const me = state.players[state.turn];
  const cnt = {};
  me.hand.forEach(c => cnt[c.month] = (cnt[c.month] || 0) + 1);
  return Object.keys(cnt)
    .map(Number)
    .filter(m => {
      const fc = floorOfMonth(state, m).length;
      return (cnt[m] >= 3 && fc >= 1) || (cnt[m] === 2 && fc >= 2);
    });
}

/* 이 카드를 내면 흔들기(같은 월 3장 첫 공개)가 가능한가? — UI가 물어볼지 판단 */
function canShake(state, cardId) {
  const me = state.players[state.turn];
  const c = me.hand.find(x => x.id === cardId);
  if (!c) return false;
  const cnt = me.hand.filter(x => x.month === c.month).length;
  return cnt >= 3 && !me.shakeMonths.includes(c.month);
}

/* ---- 손패 내기 (shake = 흔들기 선택 여부) ---- */
function playCard(state, cardId, shake) {
  if (state.phase !== 'await_play') return err('지금은 카드를 낼 수 없습니다');
  const me = state.players[state.turn];
  const hi = me.hand.findIndex(c => c.id === cardId);
  if (hi === -1) return err('손에 없는 카드');
  const h = me.hand[hi];
  // 흔들기: 그 월을 3장 이상 들고 첫 공개면 "흔들기 가능" → shake=true일 때만 ×2 적용
  const monthCnt = me.hand.filter(c => c.month === h.month).length;
  me.hand.splice(hi, 1);
  const d = state.deck.length ? state.deck.shift() : null; // 더미 위(top) 한 장
  // 마지막 손패였으면 쪽·따닥·판쓸이 불성립(피 안 뺏음)
  state.turnCtx = { h, d, hcap: [], dcap: [], pi: 0, took3: false, events: [], lastHandCard: me.hand.length === 0 };
  if (monthCnt >= 3 && !me.shakeMonths.includes(h.month)) {
    me.shakeMonths.push(h.month);            // 첫 공개 시점에 결정(이후 다시 안 물음)
    if (shake) {                             // 유저가 흔들기 선택했을 때만 ×2
      me.shake = (me.shake || 0) + 1;
      state.turnCtx.events.push('흔들기');
      // 흔든 패 3장 공개용 기록 (낸 패 + 손에 남은 같은 월 2장)
      const trio = [h, ...me.hand.filter(c => c.month === h.month)].map(c => ({ ...c }));
      (me.shaken = me.shaken || []).push({ month: h.month, cards: trio });
    }
  }
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
      // 쪽: 빈 패 냈는데 더미가 손패와 짝 → 둘 다 먹음 (마지막 손패면 쪽 불성립=피 X)
      ctx.hcap = [h, d];
      if (!ctx.lastHandCard) { ctx.events.push('쪽'); ctx.pi += 1; }
    } else if (floorM.length === 1) {
      // 뻑: 바닥1 + 손패 + 더미 = 3장 쌓임, 회수 못함 (뻑 만든 사람 기록 → 자뻑 판정)
      state.floor.push(h); state.floor.push(d);
      state.ppeok = state.ppeok || {};
      state.ppeok[M] = state.turn;
      ctx.events.push('뻑');
    } else if (floorM.length >= 2) {
      // 4장 완성(손패+더미 같은 월 + 바닥 2장) = 따닥 (마지막 손패면 불성립=피 X)
      const take = floorM.slice(0, 2);
      removeById(state.floor, take.map(c => c.id));
      ctx.hcap = [h, d, ...take];
      if (!ctx.lastHandCard) { ctx.pi += 1; ctx.events.push('따닥'); }
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
  // 3장 이상 (뻑 회수)
  removeById(state.floor, fm.map(c => c.id));
  setCap(ctx, stage, [card, ...fm]);
  ctx.took3 = true; ctx.ppeokMonth = card.month;
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
  // 더미패(폭탄 빚)는 ctx.h가 null → 항상 ctx.d. (널 가드: 선택해도 진행 안 되던 버그 수정)
  const card = (ctx.h && ch.cardId === ctx.h.id) ? ctx.h : ctx.d;
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

  // 뻑먹기 / 자뻑(내가 만든 뻑을 내가 먹으면 2피)
  if (ctx.took3) {
    const owner = (state.ppeok && ctx.ppeokMonth != null) ? state.ppeok[ctx.ppeokMonth] : undefined;
    if (owner === state.turn) { ctx.pi += 2; ctx.events.push('자뻑'); }
    else { ctx.pi += 1; ctx.events.push('뻑먹기'); }
    if (state.ppeok && ctx.ppeokMonth != null) delete state.ppeok[ctx.ppeokMonth];
  }

  me.captured.push(...cap);

  // 판쓸이(싹쓸이): 바닥 비우고 뭔가 먹음 (마지막 손패면 불성립=피 X)
  if (cap.length > 0 && state.floor.length === 0 && !ctx.lastHandCard) { ctx.events.push('싹쓸이'); ctx.pi += 1; }

  // 피 뺏기
  let stolenCards = [];
  if (ctx.pi > 0) {
    stolenCards = stealPi(state, oppOf(state.turn), state.turn, ctx.pi);
    if (stolenCards.length > 0) ctx.events.push(`피 +${stolenCards.length}`);
  }

  // 애니메이션용: 이번 턴에 회수한 카드 정보 (바닥→먹은패 쓸어담기 연출)
  state.lastCapture = {
    seq: state.playSeq, by: state.turn,
    handCard: ctx.h, deckCard: ctx.d || null,
    handCaptured: ctx.hcap.length > 0,
    deckCaptured: ctx.dcap.length > 0,
    floorCards: cap.filter(c => c !== ctx.h && c !== ctx.d),
    allIds: cap.map(c => c.id),
    stolen: stolenCards,                  // 상대에게서 뺏어온 피(연출용)
    stolenIds: stolenCards.map(c => c.id),
  };

  state.events = ctx.events.slice();

  // 이번 턴에 국진을 먹었고 아직 안 정했으면 → 무엇으로 쓸지 선택(한 번만)
  const kj = cap.find(c => c.kukjin && !c.kukjinDecided);
  if (kj) {
    state.phase = 'await_kukjin';
    state.kukjinPending = { player: state.turn, cardId: kj.id };
    state.turnCtx = null;
    return { ok: true, kukjin: true };
  }
  return scoreAndAdvance(state);
}

/* 국진 선택 반영(또는 없을 때) 후 점수/고스톱 판정 */
function scoreAndAdvance(state) {
  const me = state.players[state.turn];
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

/* 국진을 열끗/쌍피 중 무엇으로 쓸지 확정 (먹은 사람만, 한 번) */
function resolveKukjin(state, asPi) {
  if (state.phase !== 'await_kukjin') return err('국진 선택 차례가 아닙니다');
  const pend = state.kukjinPending; if (!pend) return err('선택 대상이 없습니다');
  const p = state.players[pend.player];
  const c = p.captured.find(x => x.id === pend.cardId);
  if (c) { c.kukjinAsPi = !!asPi; c.kukjinDecided = true; }
  state.kukjinPending = null;
  state.turn = pend.player; // 점수 판정은 먹은 사람 기준
  return scoreAndAdvance(state);
}

/* 아직 낼 게 있나? 손패가 있거나, (폭탄)빚 + 더미가 남아 더미패로 칠 수 있으면 true */
function canStillPlay(state, i) {
  const p = state.players[i];
  if (p.hand.length > 0) return true;
  if ((p.deckDebt || 0) > 0 && state.deck.length > 0) return true;
  return false;
}

function endTurnAdvance(state) {
  const extra = state.extraTurn;   // 폭탄 → 한 번 더
  state.extraTurn = false;
  state.turnCtx = null;
  state.choice = null;
  // 나가리: 양쪽 다 더 낼 게 없음(손패·더미빚 모두 소진)
  if (!canStillPlay(state, 0) && !canStillPlay(state, 1)) {
    state.phase = 'ended';
    state.result = { draw: true };
    return { ok: true, ended: true };
  }
  if (!extra) state.turn = oppOf(state.turn);
  // 낼 게 없는 사람 차례면 상대에게 넘김
  if (!canStillPlay(state, state.turn)) state.turn = oppOf(state.turn);
  state.phase = 'await_play';
  return { ok: true };
}

/* 폭탄 빚 갚기: 손패 대신 더미 1장을 까서 친다 (손패 없을 때) */
function playFromDeck(state) {
  if (state.phase !== 'await_play') return err('지금은 칠 수 없습니다');
  const me = state.players[state.turn];
  if ((me.deckDebt || 0) <= 0) return err('더미패로 칠 차례가 아닙니다');
  me.deckDebt--;
  const d = state.deck.length ? state.deck.shift() : null;
  state.playSeq = (state.playSeq || 0) + 1;
  state.lastPlay = { hand: null, deck: d, by: state.turn, seq: state.playSeq, deckPlay: true };
  state.turnCtx = { h: null, d, hcap: [], dcap: [], pi: 0, took3: false, events: [], deckPlay: true };
  if (!d) return finalizeTurn(state);          // 더미가 비면 빈 턴으로 정산
  return resolveStage(state, 'deck', d);        // 더미 카드를 단독으로 바닥과 정산
}

/* ---- 폭탄: 같은 월 3장(+바닥1) 또는 2장(+바닥2)으로 한 번에 4장 털기 ---- */
function playBomb(state, month) {
  if (state.phase !== 'await_play') return err('지금은 폭탄을 칠 수 없습니다');
  month = Number(month);
  const me = state.players[state.turn];
  const handM = me.hand.filter(c => c.month === month);
  const floorM = floorOfMonth(state, month);
  const valid = (handM.length >= 3 && floorM.length >= 1) || (handM.length === 2 && floorM.length >= 2);
  if (!valid) return err('폭탄 조건이 아닙니다');

  const playCount = handM.length >= 3 ? 3 : 2;   // 3장 폭탄 / 2장 폭탄
  const cards = handM.slice(0, playCount);
  removeById(me.hand, cards.map(c => c.id));     // 손에서 제거
  removeById(state.floor, floorM.map(c => c.id)); // 바닥의 그 월 전부 제거

  const d = state.deck.length ? state.deck.shift() : null;
  state.playSeq = (state.playSeq || 0) + 1;
  state.lastPlay = { hand: cards[0], deck: d, by: state.turn, seq: state.playSeq, bomb: true, bombCards: cards };

  me.bomb = (me.bomb || 0) + 1;                   // ×2 배수
  me.deckDebt = (me.deckDebt || 0) + (playCount - 1); // 낸 장수-1 만큼 더미패로 칠 빚
  state.extraTurn = true;                         // 한 번 더
  state.turnCtx = {
    h: cards[0], d, hcap: [...cards, ...floorM], dcap: [],
    pi: 1, took3: false, events: ['폭탄'],
  };
  // 더미 패 정산(매칭/깔림/선택) 후 마무리
  return resolveStage(state, 'deck', d);
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
  const bak = window.Rules.bakMultiplier(w.captured, lo.captured, { goBak, shake: w.shake, bomb: w.bomb });
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
  playBomb, bombableMonths, playFromDeck, resolveKukjin, canShake,
};
