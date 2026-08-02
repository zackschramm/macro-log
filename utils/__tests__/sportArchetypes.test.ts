/**
 * Archetype taxonomy + capability record tests.  Run with:  npm test
 *
 * Two jobs, in order of importance:
 *
 *   1. COVERAGE. Every sport key the app knows about has exactly one
 *      archetype. A sport with a macro multiplier, a coaching profile and an
 *      icon but no archetype would silently fall through to general fitness and
 *      be coached on the wrong model — the same class of bug that had
 *      triathletes coached on bench press before the multiplier/profile parity
 *      test was added.
 *
 *   2. PARITY. The capability records and the sport tables cannot drift apart.
 *      This is the test that fails when someone adds a sport to
 *      `SPORT_MULTIPLIERS` and forgets the rest, or adds a capability field and
 *      fills it in for four archetypes out of six.
 *
 * Import from the pure modules only — anything that reaches Supabase drags in
 * React Native and esbuild cannot parse its Flow types.
 */
import assert from 'node:assert/strict';
import {
  ARCHETYPES, ARCHETYPE_CAPABILITIES, ARCHETYPE_LABEL,
  SPORT_ARCHETYPES, SPORT_CAPABILITY_OVERRIDES,
  DEFERRED_ARCHETYPES, MIN_AGE_FOR_WEIGHT_MANAGEMENT,
  EVENT_ROW,
  archetypeOf, capabilitiesFor, sportsInArchetype, dailyModelArchetypeFor,
  eaProminenceFor, eaClampFor, weightManagementSurfaceFor, eventRowFor,
  isArchetypeDeferred, suppressesWeightLossCelebration,
  isEnduranceSport, isStrengthSport,
  type Archetype, type ArchetypeCapabilities,
} from '../../constants/sportArchetypes';
import { SPORT_MULTIPLIERS } from '../../constants/data';
import { SPORT_PROFILES } from '../../constants/sportProfiles';
import { SPORT_ICONS } from '../../constants/icons';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e: any) { failed++; console.log(`✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

console.log('\nArchetype coverage');

test('every sport with a macro multiplier has an archetype', () => {
  const missing = Object.keys(SPORT_MULTIPLIERS).filter(k => !(k in SPORT_ARCHETYPES));
  assert.deepEqual(missing, [], `no archetype for: ${missing.join(', ')}`);
});

test('every sport with a coaching profile has an archetype', () => {
  const missing = Object.keys(SPORT_PROFILES).filter(k => !(k in SPORT_ARCHETYPES));
  assert.deepEqual(missing, [], `no archetype for: ${missing.join(', ')}`);
});

test('every sport with an icon has an archetype', () => {
  const missing = Object.keys(SPORT_ICONS).filter(k => !(k in SPORT_ARCHETYPES));
  assert.deepEqual(missing, [], `no archetype for: ${missing.join(', ')}`);
});

test('no archetype is assigned to a sport the app does not have', () => {
  const phantom = Object.keys(SPORT_ARCHETYPES)
    .filter(k => !(k in SPORT_MULTIPLIERS) || !(k in SPORT_PROFILES));
  assert.deepEqual(phantom, [], `archetype for unknown sport: ${phantom.join(', ')}`);
});

test('all 26 sports are assigned, and no sport is in two archetypes', () => {
  const keys = Object.keys(SPORT_ARCHETYPES);
  assert.equal(keys.length, 26, `expected 26 sports, found ${keys.length}`);
  // Object keys are unique by construction, so the real check is that the
  // per-archetype partition adds back up to the whole.
  const partitioned = ARCHETYPES.reduce((n, a) => n + sportsInArchetype(a).length, 0);
  assert.equal(partitioned, keys.length, 'archetype partition does not cover every sport');
});

test('the archetype split matches the approved taxonomy', () => {
  // Locked deliberately. Moving a sport between archetypes changes which
  // nutrition model it gets, which is a product decision and not a refactor.
  const expected: Record<Archetype, number> = {
    endurance: 10, strength: 2, intermittent: 8, physique: 3, weightClass: 1, lowLoad: 2,
  };
  for (const a of ARCHETYPES) {
    assert.equal(sportsInArchetype(a).length, expected[a],
      `${a} should hold ${expected[a]} sports, holds ${sportsInArchetype(a).length}`);
  }
});

test('every archetype has at least one sport', () => {
  for (const a of ARCHETYPES) {
    assert.ok(sportsInArchetype(a).length > 0, `${a} has no sports`);
  }
});

console.log('\nCapability parity');

test('every archetype has a capability record and a label', () => {
  for (const a of ARCHETYPES) {
    assert.ok(ARCHETYPE_CAPABILITIES[a], `no capability record for ${a}`);
    assert.ok(ARCHETYPE_LABEL[a], `no label for ${a}`);
  }
});

test('no capability record exists for an archetype not in ARCHETYPES', () => {
  const extra = Object.keys(ARCHETYPE_CAPABILITIES)
    .filter(k => ARCHETYPES.indexOf(k as Archetype) === -1);
  assert.deepEqual(extra, [], `orphan capability record: ${extra.join(', ')}`);
});

test('every capability field is filled in for every archetype', () => {
  // The bug this locks out: adding a field to ArchetypeCapabilities and filling
  // it in for four of six, leaving two archetypes with `undefined` capabilities
  // that read as false at every call site.
  const fields = Object.keys(ARCHETYPE_CAPABILITIES.endurance) as (keyof ArchetypeCapabilities)[];
  for (const a of ARCHETYPES) {
    for (const f of fields) {
      assert.notEqual(ARCHETYPE_CAPABILITIES[a][f], undefined,
        `${a}.${f} is undefined`);
    }
  }
});

test('capability overrides name real sports and real capability fields', () => {
  const fields = new Set(Object.keys(ARCHETYPE_CAPABILITIES.endurance));
  for (const [sport, override] of Object.entries(SPORT_CAPABILITY_OVERRIDES)) {
    assert.ok(sport in SPORT_ARCHETYPES, `override for unknown sport: ${sport}`);
    for (const f of Object.keys(override)) {
      assert.ok(fields.has(f), `override ${sport}.${f} is not a capability field`);
    }
  }
});

test('no override restates its archetype default', () => {
  // A no-op override is drift waiting to happen: the archetype default changes,
  // the stale override silently pins the old value for one sport.
  for (const [sport, override] of Object.entries(SPORT_CAPABILITY_OVERRIDES)) {
    const base = ARCHETYPE_CAPABILITIES[archetypeOf(sport)] as any;
    for (const [f, v] of Object.entries(override)) {
      assert.notEqual(v, base[f], `${sport}.${f} override equals the archetype default`);
    }
  }
});

test('an in-event carbohydrate RATE and the carbRatePerHour flag agree', () => {
  for (const sport of Object.keys(SPORT_ARCHETYPES)) {
    const c = capabilitiesFor(sport);
    assert.equal(c.carbRatePerHour, c.inEventFueling === 'rate',
      `${sport}: carbRatePerHour ${c.carbRatePerHour} vs inEventFueling ${c.inEventFueling}`);
  }
});

test('gut training is only offered where there is a rate to train', () => {
  for (const sport of Object.keys(SPORT_ARCHETYPES)) {
    const c = capabilitiesFor(sport);
    if (c.showsGutTraining) {
      assert.ok(c.carbRatePerHour || c.inEventFueling === 'windows',
        `${sport} shows gut training with nothing to train`);
    }
  }
});

test('no event model means no in-event fuelling', () => {
  for (const sport of Object.keys(SPORT_ARCHETYPES)) {
    const c = capabilitiesFor(sport);
    if (c.eventModel === 'none') {
      assert.equal(c.inEventFueling, 'none', `${sport} fuels during an event it does not have`);
    }
  }
});

test('every event model has a row definition', () => {
  for (const sport of Object.keys(SPORT_ARCHETYPES)) {
    const model = capabilitiesFor(sport).eventModel;
    assert.ok(model in EVENT_ROW, `no EVENT_ROW entry for ${model}`);
  }
  assert.equal(EVENT_ROW.none, null, 'the `none` event model must hide the row');
});

console.log('\nAllocation order');

test('endurance is the ONLY archetype that protects carbohydrate first', () => {
  // The endurance module flipped allocation to carbohydrate-first because
  // carbohydrate is the performance-limiting macro in THAT population. It is a
  // claim about endurance, not a general improvement. This test is what stops
  // the flip being "generalised" into strength, where protein-first is right.
  const carbFirst = ARCHETYPES.filter(a => ARCHETYPE_CAPABILITIES[a].allocationOrder === 'carbFirst');
  assert.deepEqual(carbFirst, ['endurance']);
});

test('strength has no in-event carbohydrate rate', () => {
  // A meet is nine maximal attempts with twenty-minute waits, not an
  // absorption-rate problem. This `false` is what keeps "trained carb
  // tolerance (g/h)" off a powerlifter's profile screen.
  const c = ARCHETYPE_CAPABILITIES.strength;
  assert.equal(c.carbRatePerHour, false);
  assert.equal(c.inEventFueling, 'none');
  assert.equal(c.showsGutTraining, false);
  assert.equal(c.showsSweatRate, false);
});

test('strength uses blocks, not base/build/peak/taper', () => {
  assert.equal(ARCHETYPE_CAPABILITIES.strength.phaseModel, 'block');
  assert.equal(ARCHETYPE_CAPABILITIES.endurance.phaseModel, 'seasonal');
});

console.log('\nThe energy-availability axis');

test('EA prominence is a separate axis from archetype', () => {
  // The populations that need the guard most do not map onto one archetype.
  for (const s of ['bodybuilding', 'gymnastics', 'climbing', 'wrestling',
                   'running', 'cycling', 'tri_ironman']) {
    assert.equal(eaProminenceFor(s), 'headline', `${s} should headline the EA card`);
  }
  // ...and it is genuinely a separate axis: two endurance sports differ.
  assert.equal(archetypeOf('running'), archetypeOf('swimming'));
  assert.notEqual(eaProminenceFor('running'), eaProminenceFor('swimming'));
});

test('low-load sports keep the EA card quiet rather than absent', () => {
  // Quiet, not removed. The guard is never switched off for anyone.
  for (const s of ['yoga', 'golf']) {
    assert.equal(eaProminenceFor(s), 'quiet');
  }
});

test('the EA clamp is hard for physique and soft elsewhere', () => {
  for (const s of ['bodybuilding', 'gymnastics', 'climbing']) {
    assert.equal(eaClampFor(s), 'hard', `${s} must not be able to switch the floor off`);
  }
  for (const s of ['running', 'powerlifting', 'none', 'soccer', 'golf']) {
    assert.equal(eaClampFor(s), 'soft', `${s} should have an acknowledgeable clamp`);
  }
});

test('every sport resolves to a real prominence and clamp, including junk input', () => {
  for (const s of [...Object.keys(SPORT_ARCHETYPES), 'underwater_basket_weaving', '', null]) {
    assert.ok(['headline', 'standard', 'quiet'].indexOf(eaProminenceFor(s as any)) !== -1);
    assert.ok(['hard', 'soft'].indexOf(eaClampFor(s as any)) !== -1);
  }
});

console.log('\nThe deferred weight-class seam');

test('weight-class is assigned in the taxonomy', () => {
  assert.equal(archetypeOf('wrestling'), 'weightClass');
  assert.equal(ARCHETYPE_CAPABILITIES.weightClass.weightManagement, 'makeWeight');
});

test('...but no make-weight surface is reachable', () => {
  // The taxonomy describes the design; this describes what exists. Gate UI on
  // weightManagementSurfaceFor, never on capabilities.weightManagement.
  assert.ok(isArchetypeDeferred('weightClass'));
  assert.equal(weightManagementSurfaceFor('wrestling'), 'none');
  assert.equal(eventRowFor('wrestling'), null, 'a wrestler must see no weigh-in planner');
});

test('no other archetype is deferred', () => {
  assert.deepEqual([...DEFERRED_ARCHETYPES], ['weightClass']);
  for (const a of ARCHETYPES) {
    if (a === 'weightClass') continue;
    assert.ok(!isArchetypeDeferred(a), `${a} should not be deferred`);
  }
});

test('a wrestler falls back to the intermittent daily model', () => {
  // Training-day requirements are archetype C's. Only the descent and the
  // weigh-in are distinctive, and neither of those ships.
  assert.equal(dailyModelArchetypeFor('wrestling'), 'intermittent');
  for (const s of Object.keys(SPORT_ARCHETYPES)) {
    if (s === 'wrestling') continue;
    assert.equal(dailyModelArchetypeFor(s), archetypeOf(s), `${s} should not be remapped`);
  }
});

test('no sport reaches a weight-management surface that is not built', () => {
  for (const s of Object.keys(SPORT_ARCHETYPES)) {
    const surface = weightManagementSurfaceFor(s);
    assert.notEqual(surface, 'makeWeight', `${s} reaches make-weight tooling that does not exist`);
  }
});

test('the 18+ gate exists before any surface that would need it', () => {
  assert.equal(MIN_AGE_FOR_WEIGHT_MANAGEMENT, 18);
});

console.log('\nWeight-loss celebration suppression');

test('the scale going down is never celebrated for the at-risk population', () => {
  for (const s of ['bodybuilding', 'gymnastics', 'climbing', 'wrestling',
                   'running', 'cycling', 'tri_ironman']) {
    assert.ok(suppressesWeightLossCelebration(s), `${s} must not get weight-loss milestones`);
  }
});

test('...and is left alone for everyone else', () => {
  for (const s of ['none', 'powerlifting', 'soccer', 'golf', 'yoga', 'swimming']) {
    assert.ok(!suppressesWeightLossCelebration(s), `${s} should be unaffected`);
  }
});

console.log('\nBack-compat with the retired ENDURANCE_SPORTS set');

test('isEnduranceSport answers exactly what the hardcoded set answered', () => {
  // The set that used to live in constants/data.ts, verbatim. If the taxonomy
  // ever disagrees with it, that is a behaviour change and not a refactor.
  const RETIRED_SET = [
    'triathlon', 'tri_sprint', 'tri_olympic', 'tri_70_3', 'tri_ironman',
    'running', 'cycling', 'swimming', 'rowing', 'hiking',
  ];
  for (const k of Object.keys(SPORT_ARCHETYPES)) {
    assert.equal(isEnduranceSport(k), RETIRED_SET.indexOf(k) !== -1,
      `${k} changed endurance classification`);
  }
  assert.equal(isEnduranceSport(null), false);
  assert.equal(isEnduranceSport(undefined), false);
  assert.equal(isEnduranceSport('underwater_basket_weaving'), false);
});

test('isStrengthSport covers powerlifting and general fitness', () => {
  assert.ok(isStrengthSport('powerlifting'));
  assert.ok(isStrengthSport('none'));
  assert.ok(!isStrengthSport('bodybuilding'), 'bodybuilding is physique, not strength');
  assert.ok(!isStrengthSport(null));
});

test('an unknown sport degrades to general fitness rather than crashing', () => {
  assert.equal(archetypeOf('underwater_basket_weaving'), 'strength');
  assert.equal(archetypeOf(null), 'strength');
  assert.ok(capabilitiesFor(undefined));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
