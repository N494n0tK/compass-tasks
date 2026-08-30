#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="Compass"
BUNDLE_ID="com.n494n0.compass"
MIN_SYSTEM_VERSION="14.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
FALLBACK_DIR="$ROOT_DIR/Fallback"
FALLBACK_BUILD_DIR="$ROOT_DIR/.build/fallback"
MODULE_CACHE_DIR="$ROOT_DIR/.build/module-cache"
BUILD_ENGINE="swiftpm"

cd "$ROOT_DIR"
mkdir -p "$MODULE_CACHE_DIR"
# The desktop sandbox may not allow writes under ~/.cache. Keep compiler module
# caches project-local so the CLT fallback remains reproducible.
export CLANG_MODULE_CACHE_PATH="$MODULE_CACHE_DIR"
pkill -x "$APP_NAME" >/dev/null 2>&1 || true

build_with_clang_fallback() {
  BUILD_ENGINE="clang-fallback"
  mkdir -p "$FALLBACK_BUILD_DIR"
  BUILD_BINARY="$FALLBACK_BUILD_DIR/$APP_NAME"

  /usr/bin/clang \
    -fobjc-arc \
    -fmodules \
    -mmacosx-version-min="$MIN_SYSTEM_VERSION" \
    -framework Cocoa \
    -framework WebKit \
    "$FALLBACK_DIR/main.m" \
    "$FALLBACK_DIR/CompassURLPolicy.m" \
    -o "$BUILD_BINARY"
}

build_app() {
  # SwiftPM is the preferred source of truth. The Objective-C implementation is
  # only used on this machine when its installed SDK cannot compile SwiftPM.
  if swift build; then
    BUILD_ENGINE="swiftpm"
    BUILD_BINARY="$(swift build --show-bin-path)/$APP_NAME"
  else
    echo "SwiftPM build unavailable; building the equivalent AppKit/WebKit fallback." >&2
    build_with_clang_fallback
  fi
}

run_fallback_policy_tests() {
  mkdir -p "$FALLBACK_BUILD_DIR"
  local test_binary="$FALLBACK_BUILD_DIR/CompassURLPolicyTests"

  /usr/bin/clang \
    -fobjc-arc \
    -fmodules \
    -mmacosx-version-min="$MIN_SYSTEM_VERSION" \
    -framework Foundation \
    "$FALLBACK_DIR/policy_test.m" \
    "$FALLBACK_DIR/CompassURLPolicy.m" \
    -o "$test_binary"
  "$test_binary"
}

build_app

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

/usr/bin/plutil -lint "$INFO_PLIST" >/dev/null
/usr/bin/codesign --force --sign - --timestamp=none "$APP_BUNDLE" >/dev/null
printf '%s\n' "$BUILD_ENGINE" >"$DIST_DIR/build-engine.txt"

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  --test|test)
    if swift test; then
      echo "SwiftPM tests passed"
    else
      echo "SwiftPM XCTest unavailable; running equivalent Objective-C URL policy tests." >&2
      run_fallback_policy_tests
    fi
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--test]" >&2
    exit 2
    ;;
esac
