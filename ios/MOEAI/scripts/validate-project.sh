#!/bin/bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP_PROJECT=$(mktemp)
trap 'rm -f "$TMP_PROJECT"' EXIT

echo "Validating Swift syntax..."
find "$ROOT/Sources" -name '*.swift' -print0 | sort -z | xargs -0 swiftc -parse
find "$ROOT/Tests" -name '*.swift' -print0 | sort -z | xargs -0 swiftc -parse

echo "Validating plist files..."
plutil -lint "$ROOT/Config/Info.plist"
plutil -lint "$ROOT/Config/Debug.entitlements"
plutil -lint "$ROOT/Config/Release.entitlements"
plutil -lint "$ROOT/Resources/PrivacyInfo.xcprivacy"

tail -n +2 "$ROOT/MOEAI.xcodeproj/project.pbxproj" > "$TMP_PROJECT"
plutil -lint "$TMP_PROJECT"

echo "Validating JSON, XML, icon metadata, and project references..."
python3 - "$ROOT" <<'PY'
import json
import re
import struct
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(sys.argv[1])

for path in root.rglob("Contents.json"):
    json.loads(path.read_text(encoding="utf-8"))

for path in [
    root / "Resources/LaunchScreen.storyboard",
    root / "MOEAI.xcodeproj/project.xcworkspace/contents.xcworkspacedata",
    root / "MOEAI.xcodeproj/xcshareddata/xcschemes/MOEAI.xcscheme",
]:
    ET.parse(path)

icon = root / "Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
data = icon.read_bytes()
if data[:8] != b"\x89PNG\r\n\x1a\n":
    raise SystemExit("AppIcon-1024.png is not a PNG file")
width, height, bit_depth, color_type = struct.unpack(">IIBB", data[16:26])
if (width, height) != (1024, 1024):
    raise SystemExit(f"App icon must be 1024x1024, got {width}x{height}")
if color_type in (4, 6):
    raise SystemExit("App icon must not contain an alpha channel")

sources = sorted((root / "Sources").rglob("*.swift"))
project_text = (root / "MOEAI.xcodeproj/project.pbxproj").read_text(encoding="utf-8")
missing = [path.name for path in sources if path.name not in project_text]
if missing:
    raise SystemExit(f"Swift files missing from Xcode project: {missing}")

all_swift = "\n".join(path.read_text(encoding="utf-8") for path in sources)
for forbidden in ("import WebKit", "import SafariServices"):
    if forbidden in all_swift:
        raise SystemExit(f"Forbidden browser dependency found: {forbidden}")

required_singletons = [
    "APIClient",
    "SessionStore",
    "AppModel",
    "KeychainStore",
    "NotificationManager",
    "RootView",
    "MainTabView",
]
for name in required_singletons:
    count = len(re.findall(rf"\b(?:actor|class|struct|enum)\s+{re.escape(name)}\b", all_swift))
    if count != 1:
        raise SystemExit(f"Expected exactly one declaration of {name}, found {count}")

print(f"Validated {len(sources)} app Swift files and {len(list((root / 'Tests').rglob('*.swift')))} test files")
PY

echo "iOS project validation completed successfully."
