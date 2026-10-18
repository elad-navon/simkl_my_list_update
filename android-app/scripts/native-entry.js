// What the website's Android-only code gets from Capacitor: the official plugin API, bundled into
// ../native/vendor/capacitor-auth.js by scripts/build-native.mjs. Registered by name, without the
// plugin's web implementation (which would pull in the Firebase npm package): the website signs in
// through its own Firebase SDK, and this is only ever loaded inside the Android app.
// LocalNotifications: the episode alerts (../native/episode-alerts.js).
import { registerPlugin } from '@capacitor/core';

export const FirebaseAuthentication = registerPlugin('FirebaseAuthentication');
export { LocalNotifications } from '@capacitor/local-notifications';
