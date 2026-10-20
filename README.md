# VectorCraft for Android

An Android build of [VectorCraft](https://github.com/storytold/vectorcraft), ArtCraft's open-source,
Rust-native vector illustration app, made for a Galaxy Tab S6 Lite (S Pen) but should run on any
Android 10+ tablet.

This is an unofficial wrapper. VectorCraft and the ArtCraft names and logos belong to their owners;
VectorCraft's code is MIT OR Apache-2.0.

## How it works

VectorCraft already ships a web build (`apps/vectorcraft-web`): the same Rust app compiled to
WebAssembly, tuned for tablets (pen pressure and hover, palm rejection, two-finger pan and zoom).
This repo:

1. builds that web app from upstream with [Trunk](https://trunkrs.dev) on GitHub Actions,
2. bundles it into a small Kotlin app (`android/`) that shows it full screen in a WebView, served
   from inside the APK (works offline),
3. adds the parts a WebView doesn't do on its own:
   - **File > Open / Place** opens the Android file picker;
   - **Save / Export** write to `Downloads/VectorCraft/` (via `web/android-bridge.js`);
   - **Print** saves the PDF to `Downloads/VectorCraft/` so you can print it from a PDF app;
   - **Shift / Alt / Ctrl** keys on screen (`web/touch-modifiers.js`), for constraining shapes
     without a keyboard: tap a key for the next stroke only, double-tap to lock it on (tap again
     to unlock), or hold it with a finger while you draw. Shift makes squares, circles, 45° lines
     and proportional scaling; Alt draws from the centre or duplicates while moving. Drag the bar
     by its handle to move it; tap the handle to fold it away;
   - rotating the tablet or attaching a keyboard doesn't reload the app; Back sends it to the
     background instead of closing your drawing.

No upstream code is changed, so every build picks up the latest VectorCraft.

## Getting the APK

1. Push this repo to GitHub. The **Build VectorCraft APK** workflow runs on every push to `main`;
   you can also run it from the **Actions** tab (**Run workflow**), choosing the VectorCraft repo,
   branch or commit.
2. When it finishes (the first build takes a while; later ones use a cache), open the repo's
   **Releases** page on the tablet and tap the `.apk`. The APK is also attached to the workflow run
   as an artifact (a zip).
3. Allow your browser to install unknown apps when Android asks.

## Signing (so updates install over each other)

Without a signing key, each build is signed with a different throwaway key, and Android refuses to
install a new build over the old one ("App not installed"). You'd have to uninstall first, which
also deletes VectorCraft's Data Recovery and preferences.

To fix that, create a key once (needs a JDK; `keytool` comes with it):

```bash
keytool -genkeypair -v -keystore vectorcraft-release.jks -alias vectorcraft -keyalg RSA -keysize 4096 -validity 36500
```

Then in the GitHub repo, **Settings > Secrets and variables > Actions**, add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the keystore file, base64-encoded (`base64 -w0 vectorcraft-release.jks`, or in PowerShell `[Convert]::ToBase64String([IO.File]::ReadAllBytes("vectorcraft-release.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `vectorcraft` |
| `ANDROID_KEY_PASSWORD` | the key password (the same as the keystore password unless you set a different one) |

Keep the `.jks` file and passwords somewhere safe and out of git: if you lose them, the next
build can't update the installed app.

## Changing VectorCraft itself

To change the Rust code, fork `storytold/vectorcraft`, make your changes there, then run the
workflow with **vectorcraft_repo** set to your fork (`your-name/vectorcraft`) and **vectorcraft_ref**
set to your branch.

## Troubleshooting

- **Blank or black canvas:** run the workflow with **force_webgl** ticked. That skips WebGPU and
  uses WebGL2, which older tablet GPUs like the S6 Lite's Mali-G72 handle best.
- **Slow on big drawings:** VectorCraft draws the artwork on the CPU; the S6 Lite is a mid-range
  tablet from 2020, so very complex documents will be sluggish.
- **Logs:** `adb logcat -s VectorCraft` shows the web app's console messages.

## Layout

| Path | What |
| --- | --- |
| `.github/workflows/build-apk.yml` | Builds the web app, bundles it, builds and publishes the APK |
| `android/` | The Android app (Kotlin, one activity: `MainActivity.kt`) |
| `web/android-bridge.js` | Loaded before the wasm: redirects downloads and print jobs to the app |
| `web/touch-modifiers.js` | Loaded before the wasm: the on-screen Shift / Alt / Ctrl keys |
