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
   - **Save** writes over the document's own file: the one you opened, or where you last saved it
     (in place, wherever it is: a folder, an SD card, Drive). A new drawing's first Save, **Save
     As** and **Export** open Android's save picker so you choose the folder and name (via
     `web/android-bridge.js` and `patches/save-in-place.patch`);
   - **Print** saves the PDF to `Downloads/VectorCraft/` so you can print it from a PDF app;
   - **Shift / Alt** without a keyboard (`web/touch-modifiers.js`): rest fingers on the screen
     while the pen draws. One finger is Shift (squares, circles, 45° lines, proportional scaling,
     add to a selection), two are Alt (draw from the centre, duplicate while moving), three are
     both. Fingers count only while they stay still (a moving finger pans), palms are ignored, and
     a label at the top shows which keys are on;
   - the Tools panel scrolls when you drag up or down on it with a finger or the pen, buttons
     included (`patches/toolbar-drag-scroll.patch`);
   - rotating the tablet or attaching a keyboard doesn't reload the app; Back sends it to the
     background instead of closing your drawing.

Upstream changes are kept small, as patches in `patches/` applied before each build, so every
build picks up the latest VectorCraft. If upstream changes the code a patch touches, the build
stops at **Apply patches**: update the patch then.

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
| `web/android-bridge.js` | Loaded before the wasm: hands saves, exports and print jobs to the app |
| `web/touch-modifiers.js` | Loaded before the wasm: Shift / Alt from fingers resting while the pen draws |
| `patches/*.patch` | Applied to VectorCraft's source before it's built (tablet changes not upstream) |
