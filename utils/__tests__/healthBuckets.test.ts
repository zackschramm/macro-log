/**
 * iOS 27 HealthKit fallback bucketing.  Run with:  npm test
 *
 * These buckets stand in for what HKStatisticsCollectionQuery would have
 * returned, so the property that matters is that every existing caller keeps
 * working: ones that sum the array, ones that group by `sourceName`, and ones
 * that read per-day values.
 */
import assert from 'node:assert/strict';
import { bucketByDayAndSource, classifySleepSample, sleepDays, sleepSessions, sleepTrendByDay, summarizeLastNight, unionMs, SAMPLE_UNITS, type LocalClock, type RawSample, type SleepSample } from '../healthBuckets';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

const S = (value: number, start: string, sourceName = 'Apple Watch'): RawSample =>
  ({ value, start, end: start, sourceName });

console.log('\nBucketing raw samples');

test('samples on the same day from the same source collapse into one bucket', () => {
  const out = bucketByDayAndSource([
    S(100, '2026-07-30T08:00:00Z'),
    S(150, '2026-07-30T12:00:00Z'),
    S(50,  '2026-07-30T18:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 300);
});

test('different days stay separate', () => {
  const out = bucketByDayAndSource([
    S(100, '2026-07-29T08:00:00Z'),
    S(200, '2026-07-30T08:00:00Z'),
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(b => b.value), [100, 200]);
});

test('different sources stay separate on the same day', () => {
  // The active-energy caller groups by sourceName and takes the largest, to
  // avoid double-counting a phone and a watch recording the same activity.
  const out = bucketByDayAndSource([
    S(300, '2026-07-30T08:00:00Z', 'Apple Watch'),
    S(120, '2026-07-30T08:05:00Z', 'iPhone'),
  ]);
  assert.equal(out.length, 2);
  const bySource = Object.fromEntries(out.map(b => [b.sourceName, b.value]));
  assert.equal(bySource['Apple Watch'], 300);
  assert.equal(bySource['iPhone'], 120);
});

test('the total is preserved — the thing every summing caller relies on', () => {
  const raw = Array.from({ length: 50 }, (_, i) =>
    S(10, `2026-07-30T${String(i % 24).padStart(2, '0')}:00:00Z`, i % 2 ? 'A' : 'B'));
  const out = bucketByDayAndSource(raw);
  assert.equal(out.reduce((s, b) => s + b.value, 0), 500);
});

test('a bucket spans from its earliest sample to its latest', () => {
  const out = bucketByDayAndSource([
    { value: 1, start: '2026-07-30T18:00:00Z', end: '2026-07-30T19:00:00Z', sourceName: 'W' },
    { value: 1, start: '2026-07-30T06:00:00Z', end: '2026-07-30T07:00:00Z', sourceName: 'W' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].startDate, '2026-07-30T06:00:00Z');
  assert.equal(out[0].endDate, '2026-07-30T19:00:00Z');
});

test('output is ordered oldest first', () => {
  const out = bucketByDayAndSource([
    S(1, '2026-07-30T08:00:00Z'), S(1, '2026-07-28T08:00:00Z'), S(1, '2026-07-29T08:00:00Z'),
  ]);
  assert.deepEqual(out.map(b => b.startDate.slice(0, 10)),
                   ['2026-07-28', '2026-07-29', '2026-07-30']);
});

console.log('\nShape compatibility with the native API');

test('the aggregated API shape (startDate/endDate) is accepted too', () => {
  const out = bucketByDayAndSource([
    { value: 42, startDate: '2026-07-30T08:00:00Z', endDate: '2026-07-30T09:00:00Z', sourceName: 'W' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 42);
});

test('buckets expose startDate/endDate, not start/end', () => {
  const out = bucketByDayAndSource([S(1, '2026-07-30T08:00:00Z')]);
  assert.ok('startDate' in out[0] && 'endDate' in out[0]);
});

console.log('\nUnit scaling — the bug that blanked Stats on iOS 27');

test('energy types ask for `calorie`, never `kilocalorie`', () => {
  // react-native-health's TS enum exports `kilocalorie`, but its native unit
  // parser does not recognise that string. It silently falls back to a count
  // unit, every energy sample throws "incompatible units" internally, each
  // throw is caught and skipped, and the query returns [] with NO error.
  for (const type of ['ActiveEnergyBurned', 'BasalEnergyBurned']) {
    assert.equal(SAMPLE_UNITS[type].unit, 'calorie',
      `${type} must not request an unparseable unit string`);
  }
  const accepted = new Set([
    'gram', 'kg', 'stone', 'pound', 'meter', 'cm', 'inch', 'mile', 'foot',
    'second', 'minute', 'hour', 'day', 'joule', 'calorie', 'count', 'percent',
    'bpm', 'fahrenheit', 'celsius', 'mmhg', 'mmolPerL', 'literPerMinute',
    'mgPerdL', 'mlPerKgMin',
  ]);
  for (const [type, { unit }] of Object.entries(SAMPLE_UNITS)) {
    assert.ok(accepted.has(unit), `${type} requests "${unit}", which hkUnitFromOptions cannot parse`);
  }
});

test('gram calories are scaled to kcal — 1 kcal = 1000 cal', () => {
  // A 500 kcal ride comes back as 500,000 from HealthKit's calorieUnit.
  const { scale } = SAMPLE_UNITS.ActiveEnergyBurned;
  const out = bucketByDayAndSource([S(500_000, '2026-07-30T08:00:00Z')], scale);
  assert.equal(out[0].value, 500);
});

test('steps are not scaled', () => {
  const { scale } = SAMPLE_UNITS.StepCount;
  const out = bucketByDayAndSource([S(8421, '2026-07-30T08:00:00Z')], scale);
  assert.equal(out[0].value, 8421);
});

test('scaling applies to every sample in a bucket, not just the first', () => {
  const out = bucketByDayAndSource([
    S(120_000, '2026-07-30T08:00:00Z'),
    S(80_000,  '2026-07-30T12:00:00Z'),
  ], 1 / 1000);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 200);
});

test('omitting scale leaves values untouched — existing callers are unaffected', () => {
  const out = bucketByDayAndSource([S(300, '2026-07-30T08:00:00Z')]);
  assert.equal(out[0].value, 300);
});

console.log('\nJunk tolerance — this runs against live device data');

test('undateable samples are dropped, not counted at epoch', () => {
  const out = bucketByDayAndSource([
    { value: 999, sourceName: 'W' },
    S(10, '2026-07-30T08:00:00Z'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 10);
});

test('missing or non-numeric values count as zero, never NaN', () => {
  const out = bucketByDayAndSource([
    { start: '2026-07-30T08:00:00Z', sourceName: 'W' },
    { value: NaN, start: '2026-07-30T09:00:00Z', sourceName: 'W' },
    S(25, '2026-07-30T10:00:00Z', 'W'),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 25);
  assert.ok(Number.isFinite(out[0].value));
});

test('a missing source name is grouped, not dropped', () => {
  const out = bucketByDayAndSource([{ value: 5, start: '2026-07-30T08:00:00Z' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].sourceName, 'unknown');
});

test('null, undefined and non-arrays return empty', () => {
  assert.deepEqual(bucketByDayAndSource(null), []);
  assert.deepEqual(bucketByDayAndSource(undefined), []);
  assert.deepEqual(bucketByDayAndSource([] as RawSample[]), []);
  assert.deepEqual(bucketByDayAndSource('nope' as any), []);
});

test('an end date earlier than the start does not corrupt the bucket span', () => {
  const out = bucketByDayAndSource([
    { value: 1, start: '2026-07-30T10:00:00Z', end: '2026-07-30T09:00:00Z', sourceName: 'W' },
  ]);
  assert.ok(out[0].endDate >= out[0].startDate || out[0].endDate === '2026-07-30T09:00:00Z');
  assert.equal(out.length, 1);
});


// ---------------------------------------------------------------------------
// The key the native bridge ACTUALLY uses.
//
// react-native-health's index.d.ts types getSamples as HealthValue{value}, but
// RCTAppleHealthKit+Queries.m writes `quantity` (:371) — or `distance` (:373)
// for mile/metre units — and only the quantity-sample path used by HRV writes
// `value` (:264). Reading `value` alone therefore zeroed every step and
// energy bucket while HRV kept working, with no error anywhere. These tests
// exist so that never silently regresses again.

test('quantity is read — the key getSamples actually returns for steps', () => {
  const out = bucketByDayAndSource([
    { quantity: 1200, start: '2026-08-01T08:00:00Z', end: '2026-08-01T09:00:00Z', sourceName: 'iPhone' },
    { quantity: 800,  start: '2026-08-01T18:00:00Z', end: '2026-08-01T19:00:00Z', sourceName: 'iPhone' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 2000);
});

test('distance is read — the key used for mile and metre units', () => {
  const out = bucketByDayAndSource([
    { distance: 5.5, start: '2026-08-01T08:00:00Z', end: '2026-08-01T09:00:00Z', sourceName: 'Watch' },
  ]);
  assert.equal(out[0].value, 5.5);
});

test('value still wins when present, so the HRV path is untouched', () => {
  const out = bucketByDayAndSource([
    { value: 42, quantity: 999, start: '2026-08-01T08:00:00Z', sourceName: 'Watch' },
  ]);
  assert.equal(out[0].value, 42);
});

test('quantity is scaled like value — gram calories become kcal', () => {
  const out = bucketByDayAndSource(
    [{ quantity: 450_000, start: '2026-08-01T08:00:00Z', sourceName: 'Watch' }],
    SAMPLE_UNITS.ActiveEnergyBurned.scale,
  );
  assert.equal(out[0].value, 450);
});

test('a sample with no magnitude under any key counts as zero, never NaN', () => {
  const out = bucketByDayAndSource([
    { start: '2026-08-01T08:00:00Z', sourceName: 'Watch' } as any,
  ]);
  assert.equal(out[0].value, 0);
  assert.ok(Number.isFinite(out[0].value));
});


// ---------------------------------------------------------------------------
// Sleep staging. getSleepSamples returns STRINGS, not the HKCategoryValue enum
// (RCTAppleHealthKit+Queries.m:612-643). Comparing them to 1/3/4/5 is always
// false, which zeroed sleep on every device until this was found.

test('the strings the bridge actually returns are recognised as sleep', () => {
  for (const v of ['ASLEEP', 'CORE', 'DEEP', 'REM']) {
    assert.equal(classifySleepSample(v).asleep, true, `${v} should count as sleep`);
  }
});

test('in-bed and awake are NOT sleep', () => {
  assert.equal(classifySleepSample('INBED').asleep, false);
  assert.equal(classifySleepSample('AWAKE').asleep, false);
  assert.equal(classifySleepSample('UNKNOWN').asleep, false);
});

test('deep and REM are flagged separately AND counted in the total', () => {
  const deep = classifySleepSample('DEEP');
  assert.deepEqual(deep, { asleep: true, deep: true, rem: false });
  const rem = classifySleepSample('REM');
  assert.deepEqual(rem, { asleep: true, deep: false, rem: true });
});

test('the numeric enum still works, so a future bridge cannot re-zero sleep', () => {
  assert.equal(classifySleepSample(1).asleep, true);   // ASLEEP
  assert.equal(classifySleepSample(3).asleep, true);   // CORE
  assert.equal(classifySleepSample(4).deep, true);     // DEEP
  assert.equal(classifySleepSample(5).rem, true);      // REM
  assert.equal(classifySleepSample(0).asleep, false);  // INBED
  assert.equal(classifySleepSample(2).asleep, false);  // AWAKE
});

test('casing and junk are handled without throwing', () => {
  assert.equal(classifySleepSample('deep').deep, true);
  assert.equal(classifySleepSample(null).asleep, false);
  assert.equal(classifySleepSample(undefined).asleep, false);
  assert.equal(classifySleepSample({}).asleep, false);
});


console.log('\nSleep: one day, one tracker');

const SL = (value: string, startDate: string, endDate: string, sourceName: string): SleepSample =>
  ({ value, startDate, endDate, sourceName });
// Tests run on a UTC clock so they pass in any timezone; production uses the device clock.
const utc: LocalClock = { dateKey: d => d.toISOString().slice(0, 10), hour: d => d.getUTCHours() };
const WATCH = "Zack's Apple Watch";
const WHOOP = 'WHOOP';

test('unionMs counts overlapping time once and ignores empty intervals', () => {
  assert.equal(unionMs([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 25 }]), 20);
  assert.equal(unionMs([{ start: 10, end: 10 }, { start: 12, end: 8 }]), 0);
  assert.equal(unionMs([]), 0);
});

test('two trackers on the same night are never summed — the fuller record wins', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T02:00:00Z', WHOOP),
    SL('DEEP', '2026-09-02T02:00:00Z', '2026-09-02T03:00:00Z', WHOOP),
    SL('CORE', '2026-09-02T03:00:00Z', '2026-09-02T06:00:00Z', WHOOP),
    SL('CORE', '2026-09-01T23:10:00Z', '2026-09-02T02:30:00Z', WATCH),
    SL('REM',  '2026-09-02T02:30:00Z', '2026-09-02T03:30:00Z', WATCH),
    SL('CORE', '2026-09-02T03:30:00Z', '2026-09-02T06:30:00Z', WATCH),
  ], utc);
  assert.ok(night);
  assert.equal(night!.source, WATCH);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 7.33);   // a naive sum reports 14.33
  assert.equal(night!.remHours, 1);
  assert.equal(night!.deepHours, 0);        // WHOOP's deep hour is not borrowed
});

test('a tracker that has not synced last night loses to the one that has', () => {
  const night = summarizeLastNight([
    SL('ASLEEP', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WATCH),   // night before, only
    SL('ASLEEP', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WHOOP),
    SL('ASLEEP', '2026-09-01T23:00:00Z', '2026-09-02T06:00:00Z', WHOOP),   // last night
  ], utc);
  assert.equal(night!.source, WHOOP);
  assert.equal(night!.asleepHours, 7);
  assert.equal(night!.end, Date.parse('2026-09-02T06:00:00Z'));
});

test('two nights inside the window yield only the latest night', () => {
  const night = summarizeLastNight([
    SL('ASLEEP', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WHOOP),
    SL('ASLEEP', '2026-09-01T23:00:00Z', '2026-09-02T05:00:00Z', WHOOP),
  ], utc);
  assert.equal(night!.asleepHours, 6);      // not 13
});

test('an afternoon nap is reported beside the night, never added to it', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // 7.5h
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T15:30:00Z', WHOOP),   // 1.5h nap, same sleep day
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 7.5);    // what the WHOOP app shows for that night
  assert.equal(night!.napHours, 1.5);
  assert.equal(night!.start, Date.parse('2026-09-01T23:00:00Z'));
});

test('a long (≥3h) afternoon sleep counts as sleep, but the night is still the night', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T17:30:00Z', WHOOP),   // 3.5h — a real sleep, not a doze
  ], utc);
  // Through the seventh revision this asserted 11h, on the rule that any ≥3h
  // session is main sleep whatever the clock says. That rule broke the module's
  // own contract ("a nap cannot evict OR inflate last night"), disagreed with
  // what WHOOP's app shows for the same night, and pushed calcScore past its
  // 8.5h ceiling so a good night plus a long nap scored WORSE than the night
  // alone. The night is the longest bout that began at night; the afternoon
  // sleep is reported beside it.
  assert.equal(night!.asleepHours, 7.5);
  assert.equal(night!.napHours, 3.5);
});

test('a short night plus a longer daytime nap: the night is last night, the nap stays a nap', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-02T01:30:00Z', '2026-09-02T03:30:00Z', WHOOP),   // 2h night
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T16:30:00Z', WHOOP),   // 2.5h nap, longer than the night
  ], utc);
  assert.equal(night!.asleepHours, 2);
  assert.equal(night!.napHours, 2.5);
});

test('a nap-only tracker today cannot anchor "last night" to the nap', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // real night
    SL('CORE', '2026-09-02T16:00:00Z', '2026-09-02T16:30:00Z', WATCH),   // 30-min nap, newest end
  ], utc);
  assert.equal(night!.source, WHOOP);
  assert.equal(night!.asleepHours, 7.5);
});

test('a broken night counts both fragments when the first one crossed midnight', () => {
  const samples = [
    SL('CORE', '2026-09-01T22:00:00Z', '2026-09-02T00:30:00Z', WATCH),   // 2.5h, crosses midnight
    SL('CORE', '2026-09-02T04:00:00Z', '2026-09-02T07:00:00Z', WATCH),   // 3h after a 3.5h wake
  ];
  assert.equal(sleepSessions(samples).length, 2);
  const night = summarizeLastNight(samples, utc)!;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 5.5);
});

test('the pre-midnight first half of a broken night is filed against that night, as its nap', () => {
  const broken = summarizeLastNight([
    SL('CORE', '2026-09-01T22:00:00Z', '2026-09-01T23:45:00Z', WATCH),   // 1.75h, in bed at 22:00, never reached midnight
    SL('CORE', '2026-09-02T02:00:00Z', '2026-09-02T07:00:00Z', WATCH),   // 5h after a 2h15 wake
  ], utc)!;
  // The defect this replaces was the 1.75h landing on the PREVIOUS sleep day,
  // where nothing ever showed it. It is now filed under the night it precedes.
  // It is not added to the night: a 2h15 wake before midnight is a separate
  // sleep, exactly as WHOOP and Apple Health score it, and the seventh
  // revision's attempt to fold it in produced a one-minute cliff at 21:00 that
  // moved 1.5h into the headline (council pass 6, confirmed).
  assert.equal(broken.date, '2026-09-02');
  assert.equal(broken.asleepHours, 5);
  assert.equal(broken.napHours, 1.75);
});

test('an early alarm is not a broken night: the post-workout nap after a 05:30 wake stays a nap', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T22:30:00Z', '2026-09-02T05:30:00Z', WHOOP),   // 7h, alarm at 05:30
    SL('CORE', '2026-09-02T08:00:00Z', '2026-09-02T09:00:00Z', WHOOP),   // nap after the morning ride
  ], utc)!;
  assert.equal(night.asleepHours, 7);
  assert.equal(night.napHours, 1);
});

test('a long afternoon sleep does not demote the morning resume of a broken night', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T03:00:00Z', WHOOP),   // 4h, woke at 03:00
    SL('CORE', '2026-09-02T06:30:00Z', '2026-09-02T08:30:00Z', WHOOP),   // resumed 06:30–08:30
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T17:30:00Z', WHOOP),   // 3.5h afternoon sleep
  ], utc)!;
  assert.equal(night.asleepHours, 6);      // 4 + 2 — the 03:00 wake did not end the night, so the resume counts
  assert.equal(night.napHours, 3.5);       // and the afternoon sleep neither replaces it nor inflates it
});

test('a small-hours fragment after a long wake joins the night; a pre-midnight doze does not', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T20:00:00Z', '2026-09-01T21:30:00Z', WATCH),   // 1.5h evening doze, 3h before the night → nap
    SL('CORE', '2026-09-02T00:30:00Z', '2026-09-02T02:00:00Z', WATCH),   // 1.5h small-hours fragment
    SL('CORE', '2026-09-02T04:30:00Z', '2026-09-02T08:00:00Z', WATCH),   // 3.5h main, after a 2.5h wake
  ], utc)!;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 5);       // 3.5 + 1.5, not 6.5
  assert.equal(night.napHours, 1.5);
});

test('an evening doze before bed is not "last night", before or after the night is recorded', () => {
  const before = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // real night, sleep day Sep 2
    SL('CORE', '2026-09-02T20:00:00Z', '2026-09-02T21:30:00Z', WHOOP),   // 1.5h couch doze, opened at 22:00
  ], utc)!;
  assert.equal(before.date, '2026-09-02');
  assert.equal(before.asleepHours, 7.5);
  const after = summarizeLastNight([
    SL('CORE', '2026-09-02T20:00:00Z', '2026-09-02T21:30:00Z', WHOOP),   // same doze
    SL('CORE', '2026-09-03T00:00:00Z', '2026-09-03T06:30:00Z', WHOOP),   // then the night, 2.5h later
  ], utc)!;
  assert.equal(after.date, '2026-09-03');
  assert.equal(after.asleepHours, 6.5);     // the doze is a nap beside it
  assert.equal(after.napHours, 1.5);
});

test('a ≥2h afternoon nap that runs past 19:00 stays a nap on its own day', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
    SL('CORE', '2026-09-02T17:00:00Z', '2026-09-02T19:30:00Z', WHOOP),   // 2.5h, ends after 19:00, opened at 21:00
  ], utc)!;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 7.5);
  assert.equal(night.napHours, 2.5);
});

test('a ≥2h evening doze (started after 19:00) is still not a night', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
    SL('CORE', '2026-09-02T20:00:00Z', '2026-09-02T22:30:00Z', WHOOP),   // 2.5h, opened at 23:00
  ], utc)!;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 7.5);
});

test('a broken night that resumes after 06:00 still counts both halves when the wake was before dawn', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T03:00:00Z', WHOOP),   // 4h, woke at 03:00
    SL('CORE', '2026-09-02T06:30:00Z', '2026-09-02T08:30:00Z', WHOOP),   // back to sleep 06:30–08:30
  ], utc)!;
  assert.equal(night.asleepHours, 6);
  assert.equal(night.napHours, 0);
});

test('after an all-nighter, a 1.5h sleep at 06:30 is the night, but a 1.5h nap at 15:00 is not', () => {
  const morning = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WATCH),
    SL('CORE', '2026-09-02T06:30:00Z', '2026-09-02T08:00:00Z', WATCH),
  ], utc)!;
  assert.equal(morning.date, '2026-09-02');
  assert.equal(morning.asleepHours, 1.5);
});

test('a post-workout nap two hours after waking is its own session, not part of the night', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
    SL('CORE', '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z', WHOOP),   // 2.5h after waking
  ], utc)!;
  assert.equal(night.asleepHours, 7.5);
  assert.equal(night.napHours, 1);
});

test('night-shift day-sleeps stay on their own dates and are never summed together', () => {
  const trend = sleepTrendByDay([
    SL('CORE', '2026-09-01T12:00:00Z', '2026-09-01T18:30:00Z', WHOOP),   // 6.5h, ends before 19:00
    SL('CORE', '2026-09-02T11:00:00Z', '2026-09-02T19:30:00Z', WHOOP),   // 8.5h, ends after 19:00 but started at 11
  ], utc);
  assert.deepEqual(trend, [{ date: '2026-09-01', value: 6.5 }, { date: '2026-09-02', value: 8.5 }]);
});

test('a night cut by the query window is not reported', () => {
  const windowStart = Date.parse('2026-09-01T01:00:00Z');
  const cut = summarizeLastNight([
    SL('CORE', '2026-09-01T01:20:00Z', '2026-09-01T06:30:00Z', WHOOP),   // first surviving sample, 20 min past the edge
  ], utc, { windowStart });
  assert.equal(cut, null);
  const whole = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
  ], utc, { windowStart });
  assert.equal(whole!.asleepHours, 7.5);
});

test('a couch doze that ends after midnight does not become a new "last night"', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // real night, sleep day Sep 2
    SL('CORE', '2026-09-02T23:30:00Z', '2026-09-03T00:20:00Z', WHOOP),   // 50-min doze, ends Sep 3
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 7.5);
});

test('a sleep that starts after noon (night shift) is the sleep of the day it ends on', () => {
  const days = sleepDays([SL('CORE', '2026-09-02T13:00:00Z', '2026-09-02T20:00:00Z', WHOOP)], utc);
  assert.equal(days.length, 1);
  assert.equal(days[0].date, '2026-09-02');
  assert.equal(days[0].trackers[0].nightMs, 7 * 3_600_000);
});

test('a short sleep starting after 05:00 after an all-nighter reports as itself', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T07:00:00Z', WHOOP),   // 8h, sleep day Sep 1
    SL('CORE', '2026-09-02T05:30:00Z', '2026-09-02T08:00:00Z', WHOOP),   // 2.5h, sleep day Sep 2
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 2.5);
});

test('a 2.5h sleep starting at 06:15 (no night-hours start at all) still reports as itself', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T07:00:00Z', WHOOP),
    SL('CORE', '2026-09-02T06:15:00Z', '2026-09-02T08:45:00Z', WHOOP),
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 2.5);
});

test('a genuinely short night is reported as itself, not replaced by the night before', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WATCH),   // 7h, sleep day Sep 1
    SL('CORE', '2026-09-02T01:30:00Z', '2026-09-02T03:30:00Z', WATCH),   // 2h night before a race
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 2);
});

test('a lone daytime nap today does not hide a real night yesterday', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WATCH),   // real night, sleep day Sep 1
    SL('CORE', '2026-09-02T15:00:00Z', '2026-09-02T16:30:00Z', WATCH),   // 1.5h nap, no night that day
  ], utc);
  assert.equal(night!.date, '2026-09-01');
  assert.equal(night!.asleepHours, 7);
});

test('after an all-nighter, a lone 2.5h daytime sleep is the day\'s sleep', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T06:00:00Z', WATCH),
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T16:30:00Z', WATCH),
  ], utc);
  assert.equal(night!.date, '2026-09-02');
  assert.equal(night!.asleepHours, 2.5);
});

test('a lone short sleep (≥1h, small hours) still reports rather than returning nothing', () => {
  const night = summarizeLastNight([SL('ASLEEP', '2026-09-02T01:00:00Z', '2026-09-02T02:30:00Z', WATCH)], utc);
  assert.equal(night!.asleepHours, 1.5);
});

test('only dozes in the window → null, so the UI shows "no data" instead of a fake night', () => {
  assert.equal(summarizeLastNight([SL('ASLEEP', '2026-09-02T14:00:00Z', '2026-09-02T14:40:00Z', WATCH)], utc), null);
  assert.equal(summarizeLastNight([SL('ASLEEP', '2026-09-02T20:00:00Z', '2026-09-02T21:30:00Z', WATCH)], utc), null);
});

test('in-bed and awake samples are not sleep, and overlaps within one tracker count once', () => {
  const night = summarizeLastNight([
    SL('INBED',  '2026-09-01T22:30:00Z', '2026-09-02T07:00:00Z', WATCH),
    SL('ASLEEP', '2026-09-01T23:00:00Z', '2026-09-02T06:00:00Z', WATCH),
    SL('DEEP',   '2026-09-02T01:00:00Z', '2026-09-02T02:00:00Z', WATCH),
    SL('AWAKE',  '2026-09-02T03:00:00Z', '2026-09-02T03:10:00Z', WATCH),
  ], utc);
  assert.equal(night!.asleepHours, 7);      // not 8.5 (in-bed) and not 8 (deep double-counted)
  assert.equal(night!.deepHours, 1);
});

test('sessions split on a gap longer than two hours, per tracker', () => {
  const sessions = sleepSessions([
    SL('ASLEEP', '2026-09-01T23:00:00Z', '2026-09-02T06:00:00Z', WHOOP),
    SL('ASLEEP', '2026-09-02T14:00:00Z', '2026-09-02T15:00:00Z', WHOOP),
    SL('ASLEEP', '2026-09-01T23:00:00Z', '2026-09-02T06:00:00Z', WATCH),
  ]);
  assert.equal(sessions.length, 3);
  assert.deepEqual(sessions.map(s => s.source), [WHOOP, WATCH, WHOOP]);   // ascending by end
});

test('trend: a night split at midnight lands on its wake date, and trackers are not summed', () => {
  const trend = sleepTrendByDay([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T00:00:00Z', WATCH),
    SL('CORE', '2026-09-02T00:00:00Z', '2026-09-02T06:00:00Z', WATCH),
    SL('CORE', '2026-09-01T23:05:00Z', '2026-09-02T06:10:00Z', WHOOP),
    SL('CORE', '2026-08-31T23:00:00Z', '2026-09-01T05:00:00Z', WHOOP),
  ], utc);
  assert.deepEqual(trend, [
    { date: '2026-09-01', value: 6 },
    { date: '2026-09-02', value: 7.08 },   // max(7.0 watch, 7.08 whoop), not 14.08
  ]);
});

test('trend: fromDate drops the stub day created by the widened query window', () => {
  const trend = sleepTrendByDay([
    SL('CORE', '2026-08-25T11:30:00Z', '2026-08-25T13:00:00Z', WHOOP),   // tail of a late sleep, outside range
    SL('CORE', '2026-08-25T23:00:00Z', '2026-08-26T06:00:00Z', WHOOP),
  ], utc, '2026-08-26');
  assert.deepEqual(trend, [{ date: '2026-08-26', value: 7 }]);
});

test('headline and trend agree, naps excluded from both', () => {
  const samples = [
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),
    SL('CORE', '2026-09-02T14:00:00Z', '2026-09-02T15:30:00Z', WHOOP),   // nap
    SL('CORE', '2026-09-02T15:00:00Z', '2026-09-02T15:40:00Z', WATCH),   // nap-only tracker
  ];
  const night = summarizeLastNight(samples, utc)!;
  const trend = sleepTrendByDay(samples, utc);
  assert.equal(trend[trend.length - 1].date, night.date);
  assert.equal(trend[trend.length - 1].value, night.asleepHours);
  assert.equal(night.asleepHours, 7.5);
});

// ── Council pass 6: one test per CONFIRMED defect of the seventh revision ────

test('pass 6 P1: a 3h evening crash does not evict the real night or land on tomorrow', () => {
  const samples = [
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // the real night, 7.5h
    SL('CORE', '2026-09-02T19:30:00Z', '2026-09-02T22:45:00Z', WHOOP),   // 3.25h couch crash, app opened at 23:05
  ];
  const night = summarizeLastNight(samples, utc)!;
  assert.equal(night.date, '2026-09-02');   // NOT 2026-09-04 — nothing is ever dated forward
  assert.equal(night.asleepHours, 7.5);     // was 3.25 in the seventh revision
  assert.equal(night.napHours, 3.25);
  // ...and the trend gains no future-dated bar.
  assert.deepEqual(sleepTrendByDay(samples, utc).map(d => d.date), ['2026-09-02']);
});

test('pass 6 P1: the crash cannot switch the tracker caption either', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T23:00:00Z', '2026-09-02T06:30:00Z', WHOOP),   // real night on the WHOOP
    SL('CORE', '2026-09-02T19:30:00Z', '2026-09-02T22:45:00Z', WATCH),   // crash recorded only by the Watch
  ], utc)!;
  assert.equal(night.source, WHOOP);        // the "from <tracker>" caption follows the night, not the crash
  assert.equal(night.asleepHours, 7.5);
});

test('a short sleep that crosses midnight is reported as itself, not as yesterday', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T22:45:00Z', '2026-09-01T06:15:00Z', WATCH),   // the last full night
    SL('CORE', '2026-09-01T23:10:00Z', '2026-09-02T00:30:00Z', WATCH),   // 1.33h, app opened at 00:35
  ], utc)!;
  // DOCUMENTED TRADE-OFF. Holding midnight-crossing sleeps to the two-hour
  // daytime floor would report yesterday's 7.5h here — but the same rule made a
  // real 1h59m night (23:15-01:14) vanish and show the previous day's figure
  // under "last night" (council pass 7, confirmed). One predicate now governs
  // both, and this is the side of the trade we chose: at 00:35 this 1h20m IS
  // the most recent sleep the user has had, and saying so is honest. It
  // self-corrects the moment they actually go to bed.
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 1.33);
});

test('...but a real short night that crosses midnight is never dropped', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-08-31T22:45:00Z', '2026-09-01T06:15:00Z', WATCH),
    SL('CORE', '2026-09-01T23:15:00Z', '2026-09-02T01:14:00Z', WATCH),   // 1h59m — under the old 2h floor
  ], utc)!;
  assert.equal(night.date, '2026-09-02');
  assert.equal(night.asleepHours, 1.98);    // was 7.5 (the PREVIOUS day) in the eighth revision
});

test('pass 6 P2: the 21:00 cliff is gone — a doze reports the same either side of it', () => {
  const at = (t: string) => summarizeLastNight([
    SL('CORE', `2026-09-01T${t}:00Z`, '2026-09-01T22:30:00Z', WATCH),
    SL('CORE', '2026-09-02T01:00:00Z', '2026-09-02T06:30:00Z', WATCH),
  ], utc)!.asleepHours;
  // Seventh revision: 20:59 -> 5.5h, 21:00 -> 7.0h. A one-minute shift moved
  // 1.5h into the headline and calcScore's sleep term from 10/30 to 30/30.
  assert.equal(at('20:59'), 5.5);
  assert.equal(at('21:00'), 5.5);
  assert.equal(at('21:01'), 5.5);
});

test('pass 6 P2: an evening doze is not folded into a sleep half a day later', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T21:00:00Z', '2026-09-01T22:15:00Z', WATCH),   // doze
    SL('CORE', '2026-09-02T10:00:00Z', '2026-09-02T14:00:00Z', WATCH),   // 4h daytime sleep, twelve hours later
  ], utc)!;
  assert.equal(night.asleepHours, 4);       // was 5.25 — the doze was unioned in across 12 hours
});

test('pass 6 P2: a pre-dawn wake does not promote every later nap', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T21:00:00Z', '2026-09-02T03:30:00Z', WHOOP),   // 6.5h, ended 03:30
    SL('CORE', '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z', WHOOP),   // nap 5.5h later
  ], utc)!;
  assert.equal(night.asleepHours, 6.5);     // the nap is not part of the night...
  assert.equal(night.napHours, 1);          // ...it is reported beside it
});

test('pass 6 P3: an unrelated sleep cannot change how the rest of the day is classified', () => {
  const withCrash = summarizeLastNight([
    SL('CORE', '2026-09-01T19:00:00Z', '2026-09-01T22:00:00Z', WHOOP),   // 3h evening crash
    SL('CORE', '2026-09-02T01:00:00Z', '2026-09-02T03:00:00Z', WHOOP),   // 2h night, woke at 03:00
    SL('CORE', '2026-09-02T06:30:00Z', '2026-09-02T08:30:00Z', WHOOP),   // resumed 06:30
  ], utc)!;
  const withoutCrash = summarizeLastNight([
    SL('CORE', '2026-09-02T01:00:00Z', '2026-09-02T03:00:00Z', WHOOP),
    SL('CORE', '2026-09-02T06:30:00Z', '2026-09-02T08:30:00Z', WHOOP),
  ], utc)!;
  // Seventh revision: the crash set the day's fragment cutoff, demoting the
  // resume — 5h with it, 4h without. The two must agree on the night.
  assert.equal(withCrash.asleepHours, withoutCrash.asleepHours);
  assert.equal(withCrash.asleepHours, 4);
  assert.equal(withCrash.napHours, 3);
});

test('pass 6 P3: an early-hours doze does not promote a mid-morning nap', () => {
  const night = summarizeLastNight([
    SL('CORE', '2026-09-01T22:00:00Z', '2026-09-02T01:00:00Z', WHOOP),   // 3h doze ending 01:00
    SL('CORE', '2026-09-02T04:00:00Z', '2026-09-02T07:00:00Z', WHOOP),   // 3h night
    SL('CORE', '2026-09-02T09:15:00Z', '2026-09-02T10:15:00Z', WHOOP),   // 1h nap after a 07:00 wake
  ], utc)!;
  assert.equal(night.asleepHours, 6);       // was 7 — the 09:15 nap was pulled in
  assert.equal(night.napHours, 1);
});

test('sleep helpers survive junk input', () => {
  assert.equal(summarizeLastNight([], utc), null);
  assert.equal(summarizeLastNight(null, utc), null);
  assert.equal(summarizeLastNight([SL('ASLEEP', 'garbage', '2026-09-02T06:00:00Z', WATCH)], utc), null);
  assert.deepEqual(sleepTrendByDay(undefined, utc), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
