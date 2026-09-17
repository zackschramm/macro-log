/**
 * Referral code parsing.  Run with:  npm test
 *
 * THE BUG THIS EXISTS FOR: 1.0 shared `https://fuelog.app/?ref=CODE` and
 * App.tsx parsed only `invite/CODE`. Neither route could attribute a referral,
 * and there was no field to type a code into. The app's only viral loop was
 * dead end to end for the whole release.
 */
import assert from 'node:assert/strict';
import {
  parseReferralInput, extractReferralCode, normalizeCode, isValidCodeShape,
} from '../referral';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e: any) { failed++; console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}

console.log('\nThe two link shapes that must both work');

test('THE BUG: the link the app actually shares is parsed', () => {
  assert.equal(extractReferralCode('https://fuelog.app/?ref=ZACK1234'), 'ZACK1234');
});

test('the older /invite/ link still works — it is in the wild', () => {
  assert.equal(extractReferralCode('https://fuelog.app/invite/ZACK1234'), 'ZACK1234');
  assert.equal(extractReferralCode('fuelog://invite/ZACK1234'), 'ZACK1234');
});

test('ref= survives other query params and a hash', () => {
  assert.equal(extractReferralCode('https://fuelog.app/?utm_source=ig&ref=ZACK1234'), 'ZACK1234');
  assert.equal(extractReferralCode('https://fuelog.app/?ref=ZACK1234&utm_medium=x'), 'ZACK1234');
  assert.equal(extractReferralCode('https://fuelog.app/#ref=ZACK1234'), 'ZACK1234');
});

test('lowercase links are uppercased', () => {
  assert.equal(extractReferralCode('https://fuelog.app/?ref=zack1234'), 'ZACK1234');
  assert.equal(extractReferralCode('fuelog://invite/zack1234'), 'ZACK1234');
});

test('a link with no code returns null, not a guess', () => {
  assert.equal(extractReferralCode('https://fuelog.app/'), null);
  assert.equal(extractReferralCode('https://fuelog.app/?utm_source=ig'), null);
  assert.equal(extractReferralCode('fuelog://wearable-callback?code=abc&state=x'), null);
  assert.equal(extractReferralCode(null), null);
  assert.equal(extractReferralCode(''), null);
});

test('the wearable OAuth callback is never mistaken for a referral', () => {
  // Both arrive through the same deep-link handler and both carry `code=`.
  const oauth = 'fuelog://wearable-callback?code=SOMEAUTHCODE&state=abc123';
  assert.equal(extractReferralCode(oauth), null);
  assert.equal(parseReferralInput(oauth), null);
});

console.log('\nHand-typed codes — how people actually pass these on');

test('a bare code works', () => {
  assert.equal(parseReferralInput('ZACK1234'), 'ZACK1234');
  assert.equal(parseReferralInput('zack1234'), 'ZACK1234');
});

test('spaces, dashes and stray punctuation are forgiven', () => {
  assert.equal(parseReferralInput('  ZACK1234  '), 'ZACK1234');
  assert.equal(parseReferralInput('zack 1234'), 'ZACK1234');
  assert.equal(parseReferralInput('ZACK-1234'), 'ZACK1234');
  assert.equal(parseReferralInput('"ZACK1234"'), 'ZACK1234');
});

test('pasting the WHOLE shared message finds the code', () => {
  const shared =
    'Join me on Fuelog — race fueling and nutrition built for endurance athletes.\n\n' +
    'Use my code ZACK1234 when you sign up:\nhttps://fuelog.app/?ref=ZACK1234';
  assert.equal(parseReferralInput(shared), 'ZACK1234');
});

test('a pasted link is parsed as a link, never stripped into garbage', () => {
  // Stripping punctuation from this would yield HTTPSFUELOGAPPREFZACK1234.
  assert.equal(parseReferralInput('https://fuelog.app/?ref=ZACK1234'), 'ZACK1234');
  assert.equal(parseReferralInput('fuelog://invite/ZACK1234'), 'ZACK1234');
});

test('junk returns null rather than a bogus code', () => {
  assert.equal(parseReferralInput(''), null);
  assert.equal(parseReferralInput('   '), null);
  assert.equal(parseReferralInput('ab'), null, 'too short');
  assert.equal(parseReferralInput('!!!'), null);
  assert.equal(parseReferralInput(null), null);
  assert.equal(parseReferralInput('A'.repeat(25)), null, 'too long');
});

console.log('\nShape validation');

test('accepts the generated format and reasonable variants', () => {
  for (const c of ['ZACK1234', 'FUELOG5678', 'ABCD', 'A1B2C3D4E5']) {
    assert.ok(isValidCodeShape(c), c);
  }
});

test('rejects anything that cannot be a code', () => {
  for (const c of ['abc1', 'ZACK 1234', 'ZACK-1234', 'ZAC', '', 'A'.repeat(25)]) {
    assert.ok(!isValidCodeShape(c), c);
  }
});

test('normalizeCode never invents length', () => {
  assert.equal(normalizeCode('a-b'), null, '2 usable chars is not a code');
  assert.equal(normalizeCode('a-b-c-d'), 'ABCD');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
