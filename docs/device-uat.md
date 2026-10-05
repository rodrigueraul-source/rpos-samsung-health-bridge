# Samsung Health Bridge — Device UAT gate

This is the first point where Raul must intervene physically.

## Preconditions

1. Use a compatible Samsung Android phone/tablet with Samsung Health installed.
2. Install the official Samsung Health Data SDK AAR into `app/libs/`.
3. Build/install the `samsungDebug` flavor.
4. In Samsung Health Data SDK Developer Mode, enable **Data Read** for testing.
5. Launch **R-POS Samsung Health Bridge**.

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
