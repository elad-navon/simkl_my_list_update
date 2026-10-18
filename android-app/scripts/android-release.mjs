// Builds the My Watch List Android app (Capacitor; the app loads the live website - see capacitor.config.json).
//
//   npm run android:release   the signed APK to hand out: android-app/release/my-watch-list.apk
//   npm run android:debug     a quick debug build to try things; uses no version number
//
// Release: 1. the website's tests (node --test, from the repository root); 2. checks that
// native/vendor/capacitor-auth.js matches the installed Capacitor; 3. cap sync; 4. a signed release build with the
// next version number; 5. checks the signature, package name and version inside the APK; 6. copies it to
// release/ and only then records the version number as used (a failed build never uses one up).
//
// Needs, all on this computer only (none of it in the repository):
// - Java 21 (JAVA_HOME, or a Microsoft OpenJDK 21 folder) and the Android SDK (ANDROID_HOME, or
//   %LOCALAPPDATA%\Android\Sdk) with build-tools 36.0.0;
// - the signing settings, C:\Elad\keys\watchlist-keystore.properties (storeFile, storePassword, keyAlias,
//   keyPassword) - every update must be signed with the same key; WATCHLIST_KEYSTORE_PROPERTIES points elsewhere;
// - the release counter, C:\Elad\keys\watchlist-version.json ({ "lastVersionCode": <last APK handed out> }),
//   next to the key so a fresh clone can't restart the numbering; WATCHLIST_VERSION_FILE points elsewhere;
// - the Firebase config for Google sign-in, android/app/google-services.json (see the README).
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const APP_ID = 'com.eladnavon.watchlist';
const BUILD_TOOLS = '36.0.0';
const KEYSTORE_PROPERTIES =
  process.env['WATCHLIST_KEYSTORE_PROPERTIES'] ?? 'C:\\Elad\\keys\\watchlist-keystore.properties';
const VERSION_FILE = process.env['WATCHLIST_VERSION_FILE'] ?? 'C:\\Elad\\keys\\watchlist-version.json';
const OUT = join(ROOT, 'release', 'my-watch-list.apk');
const debug = process.argv.includes('--debug');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function step(title) {
  console.log(`\n▶ ${title}`);
}

function run(cmd, args, options = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
}

// JAVA_HOME, else a Microsoft OpenJDK 21 unpacked for this user only or installed machine-wide.
function findJavaHome() {
  const fromEnv = process.env['JAVA_HOME'];
  if (fromEnv && existsSync(join(fromEnv, 'bin'))) return fromEnv;
  const local = process.env['LOCALAPPDATA'] ?? '';
  for (const base of [join(local, 'Programs', 'Microsoft'), 'C:\\Program Files\\Microsoft']) {
    const jdk =
      existsSync(base) &&
      readdirSync(base)
        .filter((d) => d.startsWith('jdk-21'))
        .sort()
        .pop();
    if (jdk) return join(base, jdk);
  }
  return null;
}

function findSdk() {
  const candidates = [
    process.env['ANDROID_HOME'],
    process.env['ANDROID_SDK_ROOT'],
    join(process.env['LOCALAPPDATA'] ?? '', 'Android', 'Sdk'),
  ];
  return candidates.find((p) => p && existsSync(join(p, 'build-tools', BUILD_TOOLS))) ?? null;
}

// --- Preconditions ------------------------------------------------------------------------------
const javaHome = findJavaHome();
if (!javaHome) fail('Java 21 not found (set JAVA_HOME, or install Microsoft OpenJDK 21).');
const sdk = findSdk();
if (!sdk) fail(`Android SDK with build-tools ${BUILD_TOOLS} not found (set ANDROID_HOME).`);
if (!existsSync(join(ANDROID, 'app', 'google-services.json'))) {
  fail('android/app/google-services.json is missing - Google sign-in needs it (see README).');
}

let versionCode = 1;
if (!debug) {
  if (!existsSync(KEYSTORE_PROPERTIES)) {
    fail(`${KEYSTORE_PROPERTIES} is missing - the release key must be set up first (see README).`);
  }
  if (!existsSync(VERSION_FILE)) {
    fail(
      `${VERSION_FILE} is missing. Create it with the last version code handed out, e.g. { "lastVersionCode": 0 } before the first release.`,
    );
  }
  const { lastVersionCode } = JSON.parse(readFileSync(VERSION_FILE, 'utf8'));
  if (!Number.isInteger(lastVersionCode) || lastVersionCode < 0) {
    fail(`${VERSION_FILE}: lastVersionCode must be a whole number.`);
  }
  versionCode = lastVersionCode + 1;
  if (versionCode > 2_100_000_000) fail('versionCode out of range.');
}
const versionName = `1.0.${versionCode}`;

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdk,
  PATH: `${join(javaHome, 'bin')};${process.env['PATH']}`,
};
const localProps = join(ANDROID, 'local.properties');
if (!existsSync(localProps)) {
  writeFileSync(localProps, `sdk.dir=${sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}\n`);
}

// --- Build --------------------------------------------------------------------------------------
if (!debug) {
  step("Tests: the website's");
  run('node', ['--test', 'tests/*.test.js'], { cwd: join(ROOT, '..') });
  step('The bundled plugin API is up to date');
  const vendor = join(ROOT, '..', 'native', 'vendor', 'capacitor-auth.js');
  // Compared without line endings: Git on Windows checks the file out with CRLF, esbuild writes LF.
  const text = () => readFileSync(vendor, 'utf8').replace(/\r\n/g, '\n');
  const before = text();
  run('npm', ['run', 'build:native']);
  if (text() !== before) {
    fail('native/vendor/capacitor-auth.js was out of date and has been rebuilt - commit it, then build again.');
  }
}

const gradlew = join(ANDROID, 'gradlew.bat');
// --dev-server=<url>: a test build that loads the site from there (a local server + adb reverse) instead of
// the live one, to try unpublished changes on the phone. capacitor.config.json is put back right after.
const devServer = process.argv.find((a) => a.startsWith('--dev-server='))?.slice('--dev-server='.length);
const configFile = join(ROOT, 'capacitor.config.json');
const config = readFileSync(configFile, 'utf8');
if (devServer) {
  const dev = JSON.parse(config);
  dev.server = { ...dev.server, url: devServer, cleartext: true };
  writeFileSync(configFile, JSON.stringify(dev, null, 2) + '\n');
}
try {
  step(`Copy the shell page and settings into the Android project${devServer ? ` (site: ${devServer})` : ''}`);
  run('npx', ['cap', 'sync', 'android']);
} finally {
  if (devServer) writeFileSync(configFile, config);
}

if (debug) {
  step('Debug build (same id: replaces an installed release build)');
  run(gradlew, ['assembleDebug', '--no-daemon'], { cwd: ANDROID, env });
  console.log(`\n✔ ${join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')}`);
  process.exit(0);
}

step(`Signed release build ${versionName} (versionCode ${versionCode})`);
run(
  gradlew,
  [
    'assembleRelease',
    `-PkeystoreProperties=${KEYSTORE_PROPERTIES}`,
    `-PappVersionCode=${versionCode}`,
    `-PappVersionName=${versionName}`,
    '--no-daemon',
  ],
  { cwd: ANDROID, env },
);
const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(apk))
  fail(`No signed APK at ${apk} (an unsigned build is app-release-unsigned.apk).`);

// --- Checks -------------------------------------------------------------------------------------
step('Signature');
const tools = join(sdk, 'build-tools', BUILD_TOOLS);
run(join(tools, 'apksigner.bat'), ['verify', '--verbose', '--print-certs', apk], { env });

step('Package and version');
const badging = execFileSync(join(tools, 'aapt2.exe'), ['dump', 'badging', apk], {
  encoding: 'utf8',
});
const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
if (!pkg) fail('Could not read the APK package line.');
if (pkg[1] !== APP_ID || Number(pkg[2]) !== versionCode || pkg[3] !== versionName) {
  fail(`APK says ${pkg[1]} ${pkg[2]} ${pkg[3]}, expected ${APP_ID} ${versionCode} ${versionName}.`);
}
console.log(`${pkg[1]}  versionCode ${pkg[2]}  versionName ${pkg[3]}`);

// --- Done ---------------------------------------------------------------------------------------
mkdirSync(dirname(OUT), { recursive: true });
copyFileSync(apk, OUT);
writeFileSync(
  VERSION_FILE,
  JSON.stringify(
    { lastVersionCode: versionCode, versionName, builtAt: new Date().toISOString() },
    null,
    2,
  ) + '\n',
);
console.log(`\n✔ ${OUT}\n  ${versionName} (versionCode ${versionCode})`);
