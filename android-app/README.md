# My Watch List - the Android app

A Capacitor shell around the live website (`capacitor.config.json`: `server.url`), so every change to the
site reaches the app without a new install. The website itself (the repository root) stays a static site
with no build step; this folder holds everything Android.

## What the app adds

- **Google sign-in through the phone.** Google doesn't sign in from a page inside an app's WebView, so in
  the app `firebase-backend.js` asks the phone's own Google sign-in for an ID token
  (`@capacitor-firebase/authentication`) and signs in to Firebase with it. The plugin's API reaches the
  site as `native/vendor/capacitor-auth.js` (built by `npm run build:native`, committed), loaded only
  inside the app.
- Text drawn at 100% whatever the phone's font size (`MainActivity`), a plain launcher icon (the yellow
  play triangle; `npm run icons`), and an error page when the site can't be reached (`android-shell/`).

The API keys reach the app with the account (the site saves them to `users/{uid}/meta/keys`), so nothing
is typed on the phone.

## Building

    npm install
    npm run android:release     # the signed APK: release/my-watch-list.apk
    npm run android:dev         # a test build loading the site from http://localhost:8099/ (adb reverse)

Needs, on this computer only, never in the repository:

- `C:\Elad\keys\watchlist-keystore.properties` and `watchlist-release.jks` (the release key - every
  update must be signed with it; back them up) and `watchlist-version.json` (the release counter);
- `android/app/google-services.json`: the Firebase config of the Android app `com.eladnavon.watchlist`
  in the project `tv-library-c29bd` (`npx firebase apps:sdkconfig ANDROID <app id> --project
  tv-library-c29bd`), which has the release key's and the debug key's SHA-1 / SHA-256 registered.
