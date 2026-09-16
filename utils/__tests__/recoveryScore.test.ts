/**
 * Recovery score.  Run with:  npm test
 *
 * The regression under test is a real night: WHOOP does not export HRV to
 * Apple Health (it computes RMSSD, Health stores SDNN), so a WHOOP-only
 * athlete's score is normalised over 60 points instead of 100. On 15 Sep 2026
 * a night of 4h59m and a resting HR of 57 displayed 33 — because 4h59m fell
 * one minute short of the old step function's 5h band and scored zero sleep
 * points. On the 60-point basis that minute was worth 17 displayed points.
 */
import assert from 'node:assert/strict';
import {
  calcRecoveryScore, describeBasis, hrvPoints, rhrPoints, sleepPoints, ramp,
  deriveHrvNote, COMPONENT_WEIGHTS,
} from '../recoveryScore';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const near = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `${a} !== ${b} (tol ${tol})`);

console.log('\nramp()');

test('interpolates linearly between anchors', () => {
  const pts = [[0, 0], [10, 100]] as const;
  near(ramp(0, pts), 0);
  near(ramp(5, pts), 50);
  near(ramp(10, pts), 100);
});

test('is flat outside the table rather than extrapolating', () => {
  const pts = [[2, 20], [4, 40]] as const;
  near(ramp(-99, pts), 20);
  near(ramp(999, pts), 40);
});

test('survives junk input', () => {
  near(ramp(NaN, [[0, 0], [1, 1]]), 0);
  near(ramp(5, []), 0);
});

console.log('\nSleep points — the cliff that shipped');

test('THE BUG: 4h59m no longer scores zero', () => {
  const fourFiftyNine = 4 + 59 / 60;
  assert.ok(sleepPoints(fourFiftyNine) > 9.5, `4h59m scored ${sleepPoints(fourFiftyNine)}`);
});

test('4h59m and 5h00m are within a rounding error of each other', () => {
  const a = sleepPoints(4 + 59 / 60);
  const b = sleepPoints(5);
  assert.ok(Math.abs(a - b) < 0.1, `one minute moved sleep points by ${Math.abs(a - b).toFixed(2)}`);
});

test('every old anchor point still scores exactly what it used to', () => {
  near(sleepPoints(5), 10);
  near(sleepPoints(6), 20);
  near(sleepPoints(7), 30);
  near(sleepPoints(8.5), 30);
  near(sleepPoints(10), 20);
});

test('COUNCIL P3: a destroyed night still scores zero, as it did before', () => {
  for (const h of [0, 1, 2, 3]) {
    assert.equal(sleepPoints(h), 0, `${h}h must score 0`);
  }
  assert.ok(sleepPoints(4) > 0 && sleepPoints(4) < 10, '4h sits on the ramp');
});

test('the curve is continuous across its whole range', () => {
  let worst = 0;
  for (let h = 0; h <= 14; h += 0.01) {
    const step = Math.abs(sleepPoints(h + 0.01) - sleepPoints(h));
    if (step > worst) worst = step;
  }
  assert.ok(worst < 0.2, `largest single-step jump was ${worst.toFixed(3)} points`);
});

test('the optimal window still scores full marks and nothing exceeds the cap', () => {
  near(sleepPoints(7.75), COMPONENT_WEIGHTS.sleep);
  for (let h = 0; h <= 20; h += 0.25) {
    assert.ok(sleepPoints(h) >= 0 && sleepPoints(h) <= COMPONENT_WEIGHTS.sleep);
  }
});

console.log('\nHRV and resting HR points');

test('clamp at both ends', () => {
  near(hrvPoints(20), 0);
  near(hrvPoints(100), 40);
  near(hrvPoints(5), 0);
  near(hrvPoints(250), 40);
  near(rhrPoints(80), 0);
  near(rhrPoints(45), 30);
  near(rhrPoints(120), 0);
  near(rhrPoints(30), 30);
});

test('resting HR 57 scores what the live screen showed', () => {
  near(rhrPoints(57), ((80 - 57) / 35) * 30);
});

console.log('\ncalcRecoveryScore()');

test('all three components present normalises over 100', () => {
  const r = calcRecoveryScore({ hrv: 100, restingHR: 45, sleepHours: 8 });
  assert.equal(r.maxPossible, 100);
  assert.equal(r.score, 100);
  assert.deepEqual(r.basis, ['hrv', 'rhr', 'sleep']);
});

test('THE REGRESSION: WHOOP-only night at 4h59m / 57bpm', () => {
  const r = calcRecoveryScore({ hrv: null, restingHR: 57, sleepHours: 4 + 59 / 60 });
  assert.equal(r.maxPossible, 60, 'HRV absent → 60-point basis');
  assert.deepEqual(r.basis, ['rhr', 'sleep']);
  assert.equal(r.score, 49, `was 33 under the step function, expected 49, got ${r.score}`);
});

test('a missing component never silently counts as zero', () => {
  const withHrv = calcRecoveryScore({ hrv: 20, restingHR: 57, sleepHours: 8 });
  const without = calcRecoveryScore({ hrv: null, restingHR: 57, sleepHours: 8 });
  assert.equal(withHrv.maxPossible, 100);
  assert.equal(without.maxPossible, 60);
  assert.ok(without.score! > withHrv.score!, 'a worst-case HRV must not outrank an absent one');
});

test('no components at all yields null, not zero', () => {
  const r = calcRecoveryScore({ hrv: null, restingHR: null, sleepHours: null });
  assert.equal(r.score, null);
  assert.equal(r.maxPossible, 0);
  assert.deepEqual(r.basis, []);
});

test('NaN is treated as absent, not as a number', () => {
  const r = calcRecoveryScore({ hrv: NaN, restingHR: 57, sleepHours: 7 });
  assert.deepEqual(r.basis, ['rhr', 'sleep']);
  assert.equal(r.maxPossible, 60);
});

test('score stays inside 0-100 across a wide input sweep', () => {
  for (const hrv of [null, 0, 20, 60, 200]) {
    for (const rhr of [null, 30, 57, 80, 140]) {
      for (const sleep of [null, 0, 4.98, 7, 12]) {
        const r = calcRecoveryScore({ hrv, restingHR: rhr, sleepHours: sleep });
        if (r.score === null) continue;
        assert.ok(r.score >= 0 && r.score <= 100, `${r.score} out of range`);
      }
    }
  }
});

console.log('\ndescribeBasis()');

test('says nothing when the score is the full measurement', () => {
  assert.equal(describeBasis(['hrv', 'rhr', 'sleep']), null);
  assert.equal(describeBasis([]), null);
});

test('names the components a partial score was built from', () => {
  assert.equal(describeBasis(['rhr', 'sleep']), 'from resting HR + sleep');
  assert.equal(describeBasis(['hrv']), 'from HRV');
});

console.log('\nderiveHrvNote() — why the HRV headline is empty');

const D = (over: Partial<Parameters<typeof deriveHrvNote>[0]> = {}) => ({
  hrv: null as number | null, hrvTrend: [] as { date: string; value: number }[],
  sources: {} as Record<string, string>, ...over,
});

test('a live reading needs no explanation', () => {
  assert.equal(deriveHrvNote(D({ hrv: 47, hrvTrend: [{ date: '2026-09-15', value: 47 }] })), undefined);
});

test('THE SCREENSHOT: empty headline over a populated chart reports the last reading', () => {
  const note = deriveHrvNote(D({
    hrvTrend: [
      { date: '2026-09-08', value: 41 },
      { date: '2026-09-09', value: 52 },
      { date: '2026-09-10', value: 49 },
    ],
    sources: { rhr: 'WHOOP', sleep: 'WHOOP' },
  }));
  assert.deepEqual(note, { kind: 'stale', date: '2026-09-10', value: 49 });
});

test('stale takes the NEWEST trend point, not the first', () => {
  const note = deriveHrvNote(D({
    hrvTrend: [{ date: '2026-09-08', value: 41 }, { date: '2026-09-10', value: 49 }],
  }));
  assert.equal(note?.kind === 'stale' && note.date, '2026-09-10');
});

test('nothing for 7 days while WHOOP writes recovery data → not-shared', () => {
  const note = deriveHrvNote(D({ sources: { rhr: 'WHOOP', sleep: 'WHOOP' } }));
  assert.deepEqual(note, { kind: 'not-shared', source: 'WHOOP' });
});

test('falls back to the sleep source when resting HR has none', () => {
  const note = deriveHrvNote(D({ sources: { sleep: 'WHOOP' } }));
  assert.deepEqual(note, { kind: 'not-shared', source: 'WHOOP' });
});

test('strips the "has nothing recent" caption decoration off the source name', () => {
  const note = deriveHrvNote(D({ sources: { rhr: 'WHOOP \u00b7 Apple Watch has nothing recent' } }));
  assert.deepEqual(note, { kind: 'not-shared', source: 'WHOOP' });
});

console.log('\n  COUNCIL: only verified vendors may be named');

test('THE DEFECT: an Apple Watch is never told it does not send HRV', () => {
  for (const src of ["Zack's Apple Watch", 'Apple Watch', 'Apple Health']) {
    const note = deriveHrvNote(D({ sources: { rhr: src, sleep: src } }));
    assert.equal(note?.kind, 'none-recent', `${src} was accused`);
    assert.equal((note as any).source, undefined, 'must name no device');
  }
});

test('Oura and Garmin — which DO export HRV — are not accused either', () => {
  for (const src of ['Oura', 'Garmin Connect', 'iPhone', 'Polar Flow']) {
    assert.equal(deriveHrvNote(D({ sources: { rhr: src } }))?.kind, 'none-recent', src);
  }
});

test('a fallback caption never lets the WRONG device be accused', () => {
  // filterBySource fell back to the watch because the preferred WHOOP had
  // nothing recent. rawSourceName strips to "Apple Watch" — which must not
  // then be blamed for WHOOP going quiet.
  const note = deriveHrvNote(D({
    sources: { rhr: 'Apple Watch \u00b7 WHOOP has nothing recent' },
  }));
  assert.equal(note?.kind, 'none-recent');
});

test('vendor matching is case- and owner-name-insensitive', () => {
  for (const src of ['whoop', 'Whoop', 'WHOOP 4.0', "Zack's Whoop"]) {
    assert.equal(deriveHrvNote(D({ sources: { rhr: src } }))?.kind, 'not-shared', src);
  }
});

test('no HRV and no other tracker either → still says something true', () => {
  assert.equal(deriveHrvNote(D())?.kind, 'none-recent');
  assert.equal(deriveHrvNote(D({ sources: { rhr: '', sleep: '   ' } }))?.kind, 'none-recent');
});

test('a tracker that DOES write HRV never gets accused of not sharing it', () => {
  // Guard: this must hold for an EMPTY trend too, which is the case the
  // original version of this test failed to cover.
  const stale = deriveHrvNote(D({
    hrvTrend: [{ date: '2026-09-14', value: 55 }],
    sources: { rhr: 'Apple Watch' },
  }));
  assert.equal(stale?.kind, 'stale');
  const empty = deriveHrvNote(D({ sources: { rhr: 'Apple Watch' } }));
  assert.notEqual(empty?.kind, 'not-shared');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
