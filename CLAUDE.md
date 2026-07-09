# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # expo start (Metro dev server; launch Android/iOS/web from CLI)
npm run android      # expo run:android — builds & installs the dev client (native android/ project)
npm run ios          # expo run:ios (requires macOS + Xcode)
npm run web          # expo start --web
npm run lint         # expo lint (eslint-config-expo, flat config)
```

There is **no test runner configured** (no `test` script, no test framework installed). "Verifying" a change means `npm run lint` plus running the app on a device/emulator. Camera, SAF storage, and SQLite behavior can only be exercised on a real device or emulator, not on web.

`expo-camera` and SAF directory picking require a **dev client** (`npm run android`), not Expo Go.

## The one architectural idea that explains everything

**The filesystem is the source of truth; SQLite is a disposable, rebuildable index.** Internalize this before changing any storage or indexing code — nearly every non-obvious decision follows from it:

- On-disk JSON files (`patient.json`, `consultation.json`) and JPEGs are the real data. The SQLite DB (`derma-index.db`) exists **only** to make list/search/sort/pagination fast. It can be deleted and fully reconstructed by scanning the dataset folders.
- Therefore **every mutation is a dual write**: write the filesystem first, then update the index (see `savePatient`/`saveConsultation`/`deletePatient` in [services/storage/storage.ts](services/storage/storage.ts)). The index write must be kept in sync even when the folder is already gone (external deletion) — `deletePatient` still calls `patientIndexService.deletePatientAsync` when the directory is missing.
- Therefore **reads reconcile against disk**: query functions fetch from SQLite, check whether each returned id still has a folder on disk (`getExistingPatientDir` / `getExistingConsultationDir`), prune stale rows, and retry once. See `queryPatientsPageAsync` in [services/indexing/patientIndexService.ts](services/indexing/patientIndexService.ts).
- Therefore the index is **cache-invalidated via `meta` keys**. If the persisted dataset root URI changes (user picked a different SAF folder), or the `lastReindexAt` meta key is missing, the service does a full rebuild. See `ensurePatientsIndexAsync` and `INDEX_META` in [constants/indexing.ts](constants/indexing.ts).

## Layered services (`services/`)

Data flows through three layers. UI screens should call the **storage** and **indexing** layers, never `dermaDb` directly.

- **`services/storage/`** — filesystem CRUD, the source of truth.
  - `storage.ts` — `savePatient` / `saveConsultation` / `getPatient` / `deletePatient` etc. Each mutation writes JSON to disk **and** updates the index. Photos are re-encoded through `imageEncoding.ts` before writing.
  - `imageEncoding.ts` — applies the user's image preference (format / quality / max longest-edge) chosen in the settings screen. **The stored extension is therefore not always `.jpg`** — nothing may assume it, and photos already on disk keep whatever format was configured when they were saved. Only the profile photo has a fixed stem (`STORAGE.profilePhotoBaseName`, not a filename). Native image refs must be `release()`d or batch saves stack full-resolution bitmaps.
  - `roots.ts` — resolves and caches (module-level singletons) the dataset root and `patients/` directory. **Read/list/delete helpers (`getExisting*`) must never create folders**; only the `getOrCreate*` variants create.
  - `drivers/` — platform storage strategy behind `getStorageDriver()`: `androidSafDriver` (prompts via SAF directory picker, persists the chosen `content://` URI to `DermaImageRecords.storage-root.json` in the app sandbox) vs `iosSandboxDriver`.
  - `fsUtils.ts` — defensive filesystem helpers. Everything is wrapped in try/catch because **SAF document providers throw** on list/create/delete when permissions are revoked.
- **`services/indexing/`** — keeps SQLite in sync and answers list queries. Both services use **single-flight promise locks** (module-level `Promise` refs / a `Map` keyed by patientId) so concurrent screen focuses don't trigger duplicate rebuilds.
- **`services/db/dermaDb.ts`** — the SQLite layer: schema (`patients`, `consultations`, `meta`), WAL mode, exclusive transactions for all writes, and **cursor-based pagination** (keyset on `(sortField, id)`) for stable ordering. The `consultations` index stores only `photoCount`, not photo URIs (kept small/rebuildable).

## Two subtle mechanisms that will bite you

**1. Image URIs: persisted vs renderable are different strings.** SAF `content://` URIs are the persisted source of truth but don't render reliably in image components on Android. `toRenderableImageUriAsync` ([services/imageUri.ts](services/imageUri.ts)) copies non-`file://`/`http`/`data` URIs into a cache dir and returns a `file://` URI. **Pattern in screens:** keep the original URIs in state as the source of truth, and maintain a separate `photoPreviewUris` map of renderable URIs for display only (see [app/patient/[patientId]/consultation/add.tsx](app/patient/[patientId]/consultation/add.tsx)). Don't persist the cache URI.

**2. Camera handoff is an in-memory queue, not route params.** The camera screen ([app/patient/[patientId]/consultation/camera.tsx](app/patient/[patientId]/consultation/camera.tsx)) doesn't return data through navigation. It pushes captured URIs into a module-singleton `Map` in [services/consultationCaptureHandoff.ts](services/consultationCaptureHandoff.ts) via `enqueueConsultationCapture`, then `router.back()`. The add-consultation screen drains the queue in a `useFocusEffect` via `consumeConsultationCaptureQueue`, keyed by `patientId::consultationId` (new consultations use a `__new__` sentinel). This is deliberate — don't "simplify" it into params.

## Routing (expo-router, file-based)

Screens live under `app/`; the file tree **is** the route table. Typed routes are enabled (`experiments.typedRoutes`), so route strings are type-checked.

- `app/index.tsx` — patient list (search, sort, cursor pagination, FAB to add)
- `app/patient/add.tsx` — add patient
- `app/patient/[patientId]/index.tsx` — patient detail + consultation list
- `app/patient/[patientId]/consultation/add.tsx` — add/edit consultation
- `app/patient/[patientId]/consultation/camera.tsx` — full-screen camera capture
- `app/patient/[patientId]/consultation/[consultationId].tsx` — view consultation
- `app/_layout.tsx` — root `Stack` + `SafeAreaProvider`; imports `global.css` and `services/nativewindInterop` **for their side effects** (order matters).

## Conventions

- **Styling is NativeWind** (Tailwind classes via `className`). The palette is hardcoded slate/dark (`bg-slate-50`, header `#0f172a`) — match it; don't introduce a theme system or new tokens. `tailwind.config.js` `content` globs cover only `app/` and `components/`, so classes elsewhere won't be generated.
- **`expo-image` needs `cssInterop`** to accept `className` — that registration lives in `services/nativewindInterop.ts` and must be imported once at startup. A raw third-party component with `className` renders with no size otherwise.
- **`expo-file-system` uses the new API** (`File`, `Directory`, `Paths` classes with synchronous `.exists`/`.list()`), not the legacy `FileSystem.*` functions.
- **SAF duplicate-folder gotcha:** some document providers allow two folders with the same display name under one parent. Always go through `getOrCreateChildDirectoryAsync`, which prefers an existing child before creating — never call `createDirectory` blindly.
- **Profile photos are only re-saved when the user picks a new image** (`hasNewProfilePhoto` check in `savePatient`) — reprocessing an already-persisted SAF URI can fail on Android.
- **New Architecture + React Compiler are on** (`newArchEnabled`, `experiments.reactCompiler`). IDs are generated with `generateId()` (timestamp + random base36), not a uuid lib.
- Shared types live in [types/models.ts](types/models.ts); on-disk names and index meta-keys are centralized in [constants/storage.ts](constants/storage.ts) and [constants/indexing.ts](constants/indexing.ts) — reuse these constants rather than hardcoding strings.
```