/**
 * Referral codes: parsing what a friend actually sends you.
 *
 * The loop was broken in the middle for the whole of 1.0. ReferralScreen
 * shared `https://fuelog.app/?ref=CODE` while App.tsx only looked for
 * `invite/CODE`, so a tapped link was never read — and there was nowhere to
 * type a code, which is how most people pass one on ("my code is ZACK1234"
 * over text). Attribution was therefore impossible by any route.
 *
 * One parser now handles every shape a code can arrive in, and both the
 * deep-link handler and the manual entry field go through it.
 *
 * Nothing here decides whether a code is REDEEMABLE — that is the
 * redeem_referral RPC's job, server-side, because the client cannot be
 * trusted to rule out self-referral or a second referrer. This module only
 * answers "what code did they mean".
 */

/**
 * Codes are generated as an uppercase first name plus four digits
 * (ReferralScreen.generateCode): ZACK1234, FUELOG5678. The bounds are
 * deliberately loose — the DB is the authority on whether a code exists, and
 * this only rejects input too short or too long to be worth a round trip.
 */
const CODE_RE = /^[A-Z0-9]{4,24}$/;

export function isValidCodeShape(code: string): boolean {
  return CODE_RE.test(code);
}

/**
 * A hand-typed code, tidied. Uppercases and drops anything that is not a
 * letter or digit, so "zack 1234", "ZACK-1234" and "zack1234" all land on
 * ZACK1234. Returns null when what is left cannot be a code.
 */
export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return isValidCodeShape(cleaned) ? cleaned : null;
}

/**
 * A code out of any link we have ever shared or might receive:
 *
 *   https://fuelog.app/?ref=ZACK1234        <- what the app shares today
 *   https://fuelog.app/invite/ZACK1234      <- what App.tsx used to expect
 *   fuelog://invite/ZACK1234                <- the custom scheme
 *   https://fuelog.app/?utm_source=x&ref=ZACK1234
 *   https://fuelog.app/#ref=ZACK1234
 *
 * Both forms are accepted permanently. Links already in the wild — texts,
 * screenshots, group chats — outlive whichever shape we prefer this month,
 * and a referral that silently fails is worse than no referral programme.
 */
export function extractReferralCode(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = String(url);

  // `ref=` in a query string or hash fragment.
  const ref = s.match(/[?&#]ref=([A-Za-z0-9]+)/);
  if (ref) {
    const code = normalizeCode(ref[1]);
    if (code) return code;
  }

  // `/invite/CODE`, with an optional trailing slash, query or fragment.
  const invite = s.match(/invite\/([A-Za-z0-9]+)/i);
  if (invite) {
    const code = normalizeCode(invite[1]);
    if (code) return code;
  }

  return null;
}

/**
 * The single entry point for both the deep link and the manual field: takes
 * whatever the athlete has in hand — a full link, or a code they were told —
 * and returns the code or null.
 *
 * Handles the case that matters in practice: someone pastes the whole shared
 * message into the code box. Stripping punctuation off that would produce
 * garbage, so a link is parsed as a link first.
 */
export function parseReferralInput(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/[?&#]ref=|invite\//i.test(s) || /:\/\//.test(s)) {
    return extractReferralCode(s);
  }
  return normalizeCode(s);
}
