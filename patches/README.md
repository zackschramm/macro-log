# Patches

Applied automatically by `patch-package` on `postinstall`, including on EAS Build.
Do not hand-edit files under `node_modules/` — regenerate the patch instead:

```
npx patch-package react-native-health
```

`react-native-health` is pinned to an exact version in `package.json` because a
patch is keyed to the version it was generated against.

---

## `react-native-health+1.19.0.patch`

**Symptom:** HealthKit data from some sources — Whoop in particular — silently
never arrived. No crash, no exception, no Sentry event, no error in the
callback. Just an empty array, indistinguishable from "the user has no data."

**Cause:** `fetchSamplesOfType` (and the anchored-workout query) build each
sample into an Objective-C dictionary *literal*:

```objc
NSDictionary *elem = @{
    ...
    @"device": device,        // nil → NSInvalidArgumentException
    @"metadata": [sample metadata],
};
```

Inserting `nil` into a dictionary literal raises. `device` comes from
`[[sample sourceRevision] productType]`, which HealthKit leaves nil whenever it
doesn't know the writing hardware — routinely true for samples written by a
third-party app rather than by an Apple device. `[sample metadata]` is nil for
workouts carrying no metadata.

The raise is caught **per sample**:

```objc
} @catch (NSException *exception) {
    NSLog(@"RNHealth: An error occured while trying to add sample from: %@", ...);
}
```

and only `NSLog`ged. So the affected sample is dropped from the results array
and nothing else happens. If every sample from a source has a nil field, that
source vanishes completely and the query still reports success.

**Fix:** default both fields instead of passing nil — `?: @"unknown"` for
`device` (5 sites), `?: [NSNull null]` for `metadata` (1 site, matching the
guard the same file already uses at the non-anchored workout site).

**Upstream:** not reported yet. Worth filing against
`agencyenterprise/react-native-health`.

---

## Related, fixed in our own code rather than here

`hkUnitFromOptions` recognises `calorie` but **not** `kilocalorie`, even though
the library's own `index.d.ts` exports `kilocalorie = 'kilocalorie'`. An
unrecognised unit string silently falls back to the caller's default — for
`getSamples`, a *count* unit — and then `doubleValueForUnit:` raises
"incompatible units" on every energy sample. Same `@catch` and NSLog, same
total silent data loss.

We work around this in `utils/healthBuckets.ts` (`SAMPLE_UNITS`): request
`calorie` and scale by 1/1000 ourselves. No patch needed, so none is applied.
