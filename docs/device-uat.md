# Samsung Health Bridge — Device UAT gate

This is the first point where Raul must intervene physically.

## Preconditions

1. Use a physical Android 10+ phone with Samsung Health 6.30.2+ installed and initialized; emulators are unsupported.
2. For a source build, place the verified official SDK 1.1.0 AAR in `app/libs/`; the supplied APK already includes the SDK.
3. Install the `samsungDebug` APK (package `com.rpos.bridge`, not `com.rpos.bridge.mock`).
4. For this development test, open Samsung Health > Settings > About Samsung Health. Tap the version line at least ten times, open **Developer mode (Samsung Health Data SDK)**, acknowledge the test notice and enable **Developer Mode for Data Read**.
5. Launch **R-POS Samsung Health Bridge**.
6. Ensure Samsung Health has at least one Exercise record within the last 30 days.

Official prerequisites and developer test steps:
https://developer.samsung.com/health/data/overview.html
https://developer.samsung.com/health/data/guide/developer-mode.html

## UAT

1. Tap **READ EXERCISE**.
2. Grant **Exercise READ** when Samsung Health requests consent.
3. The app must return at least one real Exercise record.
4. Capture the screen showing:
   - `READ PASS`
   - record count
   - original Samsung `UID`
   - exercise type
   - start time

## PASS evidence

Device UAT passes only when:

- the app itself reads a real Samsung Health Exercise record;
- the original Samsung-assigned `uid` is visible and retained;
- no generic R-POS `record_id` is substituted for that UID;
- the same UID can later be mapped to Notion `Source Record ID`.

A DataViewer screenshot, exported file, synthetic fixture, or mock flavor does **not** close this gate.
