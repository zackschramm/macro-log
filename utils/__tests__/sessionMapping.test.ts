/**
 * Wearable ->Session mapping tests.  Run with:  npm test
 *
 * Only the pure half is tested here. The AsyncStorage hand-off needs a device.
 */
import assert from 'node:assert/strict';
import {
  toDiscipline, inferZone, workoutToSession, workoutsToSessions, sessionsForDate,
  type RawWorkout,
} from '../workoutMapping';
import { sessionGrossKcal, sessionLoad } from '../enduranceEnergy';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

console.log('\nDiscipline mapping');

test('the three triathlon disciplines map correctly', () => {
  assert.equal(toDiscipline(46), 'swim');
  assert.equal(toDiscipline(13), 'bike');
  assert.equal(toDiscipline(37), 'run');
});

test('strength work is not counted as endurance', () => {
  assert.equal(toDiscipline(50), 'strength');
  assert.equal(toDiscipline(20), 'strength');
});

test('third-party names are recognised when the type number is useless', () => {
  assert.equal(toDiscipline(3000, 'Zwift Ride'), 'bike');
  assert.equal(toDiscipline(3000, 'Peloton Cycling'), 'bike');
  assert.equal(toDiscipline(3000, 'Treadmill Run'), 'run');
  assert.equal(toDiscipline(3000, 'Open Water Swim'), 'swim');
});

test('anything unrecognised falls back to other, never crashes', () => {
  assert.equal(toDiscipline(9999), 'other');
  assert.equal(toDiscipline(9999, 'Underwater Hockey'), 'other');
});

console.log('\nZone inference from pace');

test('an easy jog is not mistaken for an interval session', () => {
  // 10 km in 60 min = 10 kph
  assert.equal(inferZone('run', 60, 10), 'z2');
});

test('a fast run reads as hard', () => {
  // 15 km in 60 min = 15 kph
  assert.equal(inferZone('run', 60, 15), 'z4');
});

test('a recovery spin is not mistaken for a hard ride', () => {
  assert.equal(inferZone('bike', 90, 27), 'z1');   // 18 kph — genuinely easy
  assert.equal(inferZone('bike', 90, 36), 'z2');   // 24 kph — steady endurance
});

test('a fast group ride reads hard', () => {
  assert.equal(inferZone('bike', 60, 35), 'z4');
});

test('missing distance defaults to moderate, not to zero or maximum', () => {
  assert.equal(inferZone('bike', 60, null), 'z2');
  assert.equal(inferZone('run', 60, 0), 'z2');
});

test('inference is conservative — nothing lands in z5 by accident', () => {
  // A brisk but ordinary ride must not be scored as maximal, because that
  // would inflate both training load and the carbohydrate target.
  assert.equal(inferZone('bike', 120, 56), 'z3');  // 28 kph — tempo, not maximal
  assert.equal(inferZone('bike', 120, 60), 'z3');  // 30 kph — still tempo
  assert.equal(inferZone('bike', 120, 34), 'z1');  // 17 kph — recovery
  // z5 requires a genuinely exceptional average, not just a good day.
  assert.equal(inferZone('bike', 60, 40), 'z5');
});

console.log('\nWorkout conversion');

const hkRide: RawWorkout = {
  type: 13, name: 'Cycling', duration: 180, distance: 75, calories: 1900,
  startDate: '2026-07-30T06:00:00Z',
};

test('a HealthKit ride becomes a usable session', () => {
  const s = workoutToSession(hkRide)!;
  assert.equal(s.discipline, 'bike');
  assert.equal(s.durationMin, 180);
  assert.equal(s.distanceKm, 75);
  assert.equal(s.deviceKcal, 1900);
  assert.ok(sessionGrossKcal(s, 72) > 0);
  assert.ok(sessionLoad(s) > 0);
});

test('zero-duration and malformed entries are dropped, not passed through', () => {
  assert.equal(workoutToSession({ type: 13, duration: 0 }), null);
  assert.equal(workoutToSession({ type: 13, duration: NaN }), null);
  assert.equal(workoutToSession(null as any), null);
});

test('missing distance and calories still yields a costable session', () => {
  const s = workoutToSession({ type: 46, duration: 45 })!;
  assert.equal(s.distanceKm, null);
  assert.equal(s.deviceKcal, null);
  assert.ok(sessionGrossKcal(s, 72) > 0, 'must fall back to METs');
});

test('a zero-calorie reading is treated as missing, not as zero cost', () => {
  const s = workoutToSession({ type: 13, duration: 60, calories: 0 })!;
  assert.equal(s.deviceKcal, null);
  assert.ok(sessionGrossKcal(s, 72) > 0);
});

test('a batch converts and filters in one pass', () => {
  const out = workoutsToSessions([hkRide, { type: 13, duration: 0 }, { type: 37, duration: 30, distance: 6 }]);
  assert.equal(out.length, 2);
});

console.log('\nDate filtering');

test('only today\'s sessions are returned', () => {
  const out = sessionsForDate([
    hkRide,
    { type: 37, duration: 40, distance: 8, startDate: '2026-07-29T06:00:00Z' },
  ], '2026-07-30');
  assert.equal(out.length, 1);
  assert.equal(out[0].discipline, 'bike');
});

test('yesterday\'s brick cannot inflate today\'s target', () => {
  const out = sessionsForDate([
    { type: 13, duration: 300, distance: 150, startDate: '2026-07-29T06:00:00Z' },
  ], '2026-07-30');
  assert.deepEqual(out, []);
});

test('entries with no timestamp are excluded rather than assumed to be today', () => {
  assert.deepEqual(sessionsForDate([{ type: 13, duration: 60 }], '2026-07-30'), []);
});

test('junk input returns empty', () => {
  assert.deepEqual(sessionsForDate(null as any, '2026-07-30'), []);
  assert.deepEqual(workoutsToSessions(null as any), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
