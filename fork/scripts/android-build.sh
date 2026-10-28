#!/usr/bin/env bash
# Local Android build of the fork as "Sadder" (Linux; needs the Android SDK, JDK 21, Bun and Yarn).
# Produces a debug-signed APK (sideload) and an AAB signed with the Sadder upload key.
# Never uploads anything. Publishing is manual and INTERNAL TESTING ONLY; never publish publicly.
#
# Overrides (environment):
#   ANDROID_HOME         default /GGGG/projects/.tools/android-sdk
#   JAVA_HOME            default /usr/lib/jvm/java-21-openjdk-amd64
#   SADDER_KEY_DIR       default /GGGG/projects/CONCIERGE/HAPPIER/.release-private/sadder
#   HAPPIER_FORK_BUILDS_DIR  default <repo>/dist/fork-builds
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk-amd64}"
export ANDROID_HOME="${ANDROID_HOME:-/GGGG/projects/.tools/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$HOME/.local/bin:$JAVA_HOME/bin:$PATH"
export APP_ENV=publicdev
export EXPO_APP_NAME=Sadder
export EXPO_ANDROID_PACKAGE=com.getbentgames.sadder
# Never send source maps or releases to a third-party Sentry project from a local fork build.
export SENTRY_DISABLE_AUTO_UPLOAD=true
export CI=1
umask 000

KEYDIR="${SADDER_KEY_DIR:-/GGGG/projects/CONCIERGE/HAPPIER/.release-private/sadder}"
BUILDS="${HAPPIER_FORK_BUILDS_DIR:-$REPO_ROOT/dist/fork-builds}"
OUTDIR="$BUILDS/android-sadder-$(cat "$REPO_ROOT/fork/VERSION")-$(date -u +%Y%m%d-%H%M%S)"

cd "$REPO_ROOT/apps/ui"
if [ ! -d android ]; then
  yarn -s expo prebuild --platform android --no-install
fi
cd android
# No-push placeholder: the tracked google-services.json belongs to upstream's Firebase project.
cp "$REPO_ROOT/fork/android/google-services.stub.json" app/google-services.json
# Release lint (lintVital*) runs out of memory on the Expo modules, so it is skipped here.
./gradlew --no-daemon \
  -Dorg.gradle.jvmargs="-Xmx6g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8" \
  -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease \
  assembleRelease bundleRelease

mkdir -p "$OUTDIR"
cp app/build/outputs/apk/release/*.apk "$OUTDIR/Sadder-debugsigned.apk"
cp app/build/outputs/bundle/release/app-release.aab "$OUTDIR/Sadder-upload-signed.aab"
jarsigner -keystore "$KEYDIR/sadder-upload.p12" -storetype PKCS12 \
  -storepass:file "$KEYDIR/sadder-upload.password" -keypass:file "$KEYDIR/sadder-upload.password" \
  -sigalg SHA256withRSA -digestalg SHA-256 "$OUTDIR/Sadder-upload-signed.aab" sadder-upload
jarsigner -verify "$OUTDIR/Sadder-upload-signed.aab" | head -1
chmod 0777 "$OUTDIR"/*
sha256sum "$OUTDIR"/*
echo "OUTDIR=$OUTDIR"
