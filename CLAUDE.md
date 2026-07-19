# DermaImageRecords

Android-first Expo app (SDK 54, expo-router 6, NativeWind 4) for dermatologists: patient
photo records organized by patient → consultation, synced between the user's devices
through their **own Google Drive**. No app servers exist; Supabase is the sign-in gate
only (kept for future subscription tracking).

## Architecture invariants — do not break these

1. **The filesystem is the source of truth.** The dataset lives in a user-picked SAF
   folder (Android) / sandbox (iOS): `patients/<EMR>/patient.json`, `profile-<rand8>.<ext>`,
   `consultations/<CID>/consultation.json`, photos, and `thumbs/` beside originals, plus
   `clinic.json` at the root. SQLite `derma-index.db` is a **disposable, rebuildable
   index** (drop-and-rebuild on schema bump); `derma-sync.db` is **durable** sync state
   (sync_state/tombstones/sync_log/sync_meta) and must never be dropped by index code.
2. **Persisted JSON holds relative file names, never absolute URIs.** URIs are resolved
   at read time (`services/storage/records.ts`); the index stores resolved URIs as a
   device-local cache. This is what makes export/import/sync dumb file mirroring.
3. **Identity is the hidden `uid`** (expo-crypto UUID) on patients/consultations/photos.
   EMR and CID are human-friendly labels that double as folder names; sync may renumber
   them on collision. EMR/CID validation: shared cross-platform blocklist
   (`services/storage/folderNames.ts`) — case preserved, uniqueness case-insensitive,
   NFC-normalized, `~` reserved for temp dirs (indexers skip `~` names).
4. **Photos are immutable-by-name**: `<EMR>-<CID>-<NN>.<ext>`, numbers never reused
   (`nextPhotoNumber`), crop/edit mints the next number. The render cache
   (`services/imageUri.ts`) and sync both depend on this. Generated CIDs are sequential
   (`001`…); merges chronologically renumber ONLY numeric CIDs (pure logic in
   `services/sync/collisions.ts`).
5. **Sync** (`services/sync/`) mirrors the dataset to a visible Drive folder under the
   `drive.file` scope, tracked by file IDs (renames in Drive UI are harmless). Deletions
   propagate only via tombstones; anything missing without one is tampering and heals.
   Remote deletes are `trashed:true`, never hard deletes. All conflict rules are pure,
   deterministic, and symmetric so devices converge without coordination. The legacy
   native uploader cannot read SAF `content://` URIs — photo uploads must stage to a
   cache `file://` temp first.
6. **NativeWind css-interop constraint**: never toggle a className on a mounted
   component for selected/active/shadow states — it crashes with a bogus navigation
   context error. Dynamic state colors go in inline `style`; static `text-*` classes may
   stay (font scaling). See `components/ui/SegmentedControl.tsx`.
7. **Screens refresh via `datasetRevision`** (bumped by every storage mutation) through
   `useDatasetFocusRefresh` — never reload-on-every-focus. SyncProvider also debounces
   sync triggers off the same revision.

## Layout

- `app/` — expo-router: `(auth)`, `(drawer)` (Home tabs Patients+Gallery, backup-sync,
  settings, account, info), `patient/*` pushed screens. Reserved route words: EMR `add`;
  CID `add`, `camera`.
- `components/ui/` — shared primitives; `features/` — photos (crop), camera, gallery,
  export, pdf, clinic; `services/` — storage, indexing, db, sync, backup (zip), clinic,
  lock, preferences, auth.

## Gates (run before handing over)

`npx tsc --noEmit` · `npx expo lint` · `npx jest` · `npx expo-doctor`

Pure logic (diff, collisions, IDs, crop geometry, export filter) is unit-tested; jest
can't load modules that touch `Paths.document` at module scope — mock
`services/storage/roots` (see existing tests).

## Release

Local `npm run build:apk` needs `DERMA_UPLOAD_*` keystore props in
`~/.gradle/gradle.properties` (falls back to debug-signed with a loud warning); EAS
builds use managed credentials with `versionCode` auto-increment. Release ships arm-only
ABIs.
