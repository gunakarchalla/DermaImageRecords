# DermaImageRecords

DermaImageRecords is an **offline-first** (local-only) dermatology photo (clinical) record app built with **Expo + React Native + TypeScript**.

It stores patient records and consultation photos in a **filesystem dataset** (source of truth) and uses a **SQLite index** for fast search/sort/pagination.

## Features

### Patients

- Patient list with **search** (name/EMR) and **sorting** (last modified / created / name).
- **Cursor-based pagination** to handle large lists efficiently.
- Add a patient with optional metadata: EMR number, age, gender, phone.
- Add/update a **profile photo** via camera or gallery.
- Delete a patient (removes the patient folder + indexed rows).

### Consultations

- Per-patient consultation list (from SQLite index) with remarks preview, date, and photo count.
- Add/edit a consultation with:
   - free-text **remarks**
   - multiple photos (camera or gallery)
   - remove photos from an existing consultation
- View a consultation with the full photo grid.
- Delete a consultation (removes its folder + indexed rows).

### Storage + performance

- Photos are **resized and compressed** before saving to reduce storage and improve load speed.
- On Android, images saved via SAF/content URIs are converted to **render-safe cache file URIs** for reliable display.
- SQLite is treated as a **rebuildable index/cache**; the filesystem dataset remains the **source of truth**.

## Tech stack

- Expo SDK 54, React Native 0.81, React 19
- Routing: `expo-router` (file-based routing)
- Styling: NativeWind (Tailwind for React Native)
- Lists: `@shopify/flash-list`
- Persistence:
   - Filesystem via `expo-file-system`
   - Index via `expo-sqlite`
- Images:
   - Pick/capture via `expo-image-picker`
   - Display via `expo-image`
   - Resize/compress via `expo-image-manipulator`

## Installation & running

### Prerequisites

- Node.js (LTS recommended)
- `npm`
- For Android development builds: Android Studio + SDK + an emulator or device
- For iOS development builds: macOS + Xcode

### Install

```bash
npm install
```

### Run (Metro dev server)

```bash
npm start
```

This runs `expo start`. From the Expo CLI output you can launch on Android/iOS/web.

### Run on Android (development build / dev client)

```bash
npm run android
```

This runs `expo run:android` and builds a development client (native project under `android/`).

### Run on iOS (development build / dev client)

```bash
npm run ios
```

### Run on web

```bash
npm run web
```

### Lint

```bash
npm run lint
```

## How data is stored

### Source of truth: filesystem dataset

The app writes all patient and consultation data under a dataset root folder.

- On Android, the dataset root is chosen via **Storage Access Framework (SAF)** directory picker.
   - The chosen root URI is persisted in the app sandbox config file: `DermaImageRecords.storage-root.json`.
   - The app ensures a `DermaImageRecords/` folder exists inside the picked location.
- On iOS, the dataset root is inside the app sandbox.

The on-disk layout (conceptually) looks like:

```text
<DatasetRoot>/
   DermaImageRecords/
      patients/
         <patientId>/
            patient.json
            profile.jpg
            consultations/
               <consultationId>/
                  consultation.json
                  <photoId>.jpg
                  <photoId>.jpg
```

Notes:

- Patient and consultation documents are stored as JSON (`patient.json`, `consultation.json`).
- Photos are persisted as JPEG after resize/compression.

### Rebuildable index: SQLite

The app maintains a local SQLite database (`derma-index.db`) used only as a fast index.

- The database contains:
   - `patients` rows used for list/search/sort
   - `consultations` rows used for per-patient consultation lists
   - `meta` keys to detect when an index rebuild is needed (e.g., dataset root changed)
- The index is designed to be **rebuildable** by scanning the dataset folders.
- Queries use cursor-based pagination to provide stable ordering.

## Architecture & key modules

### Routing (expo-router)

Screens live under `app/` and map to routes automatically:

- `app/index.tsx`: patient list (search, sort, pagination)
- `app/patient/add.tsx`: add patient
- `app/patient/[patientId]/index.tsx`: patient details + consultation list
- `app/patient/[patientId]/consultation/add.tsx`: add/edit consultation
- `app/patient/[patientId]/consultation/[consultationId].tsx`: view consultation

### Storage layer

- `services/storage/roots.ts`: resolves dataset roots and patient/consultation directories
- `services/storage/storage.ts`: CRUD for patients and consultations; keeps the SQLite index in sync
- `services/storage/drivers/*`:
   - Android SAF driver (prompts for folder; stores chosen URI)
   - iOS sandbox driver

### Indexing layer

- `services/db/dermaDb.ts`: SQLite schema + queries; cursor pagination
- `services/indexing/patientIndexService.ts`: ensures/rebuilds the patients index; prunes stale rows
- `services/indexing/consultationIndexService.ts`: ensures/rebuilds per-patient consultation index

### Images

- `services/imageUri.ts`: converts SAF/content URIs into cache `file://` URIs for rendering
- Storage writes images after resize/compression via `expo-image-manipulator`

## Contributing

### Development workflow

1. Create a feature branch.
2. Keep diffs focused and consistent with the repo’s patterns:
    - TypeScript everywhere
    - NativeWind classes for styling
    - `expo-router` file-based routing (add screens by adding files under `app/`)
    - Filesystem is the source of truth; SQLite is rebuildable index/cache
3. Run quality checks:

```bash
npm run lint
```

### Where to make changes

- UI/screens: `app/`
- Reusable UI: `components/`
- Storage + indexing: `services/`
- Shared types: `types/models.ts`
- Constants: `constants/`

### Pull request checklist

- Lint passes (`npm run lint`).
- No new hard-coded design tokens (reuse existing patterns/classes).
- Storage/index remains consistent (delete/update flows keep SQLite in sync).
- New screens have appropriate accessibility labels for interactive elements.

## Troubleshooting

- **Android can’t show some images**: this is typically `content://` rendering; the app copies these into cache for display.
- **Missing records in UI**: the app prunes stale SQLite rows if corresponding folders are missing on disk.
- **Storage location selection on Android**: if the previously selected folder was removed or permission was revoked, you’ll be prompted again.