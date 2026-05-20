#!/usr/bin/env bash
#
# Remove host-provided Wayland libraries from the Tauri AppImage and repack it.
#
# The Tauri AppImage bundler ships libwayland from the (older Ubuntu) CI build
# image. On a host whose Wayland/mesa stack differs, the bundled copy crashes
# WebKitWebProcess during EGL/Wayland init, so the window stays blank and the
# process aborts (issue #151). The confirmed workaround reporters used was
# LD_PRELOAD of the host libwayland-client; removing the bundled copies forces
# the loader to use the host versions, which is the standard AppImage
# excludelist behavior, without each user needing LD_PRELOAD.
#
# Only the libwayland family is removed. That is the library reporters preloaded
# to fix the crash. The mesa/EGL/DRM libraries are left in place; if reports
# persist they are the next candidates to add here.
#
# Usage: strip-appimage-libs.sh [bundle_dir]
#   bundle_dir defaults to app/src-tauri/target/release/bundle/appimage
# Architecture is read from uname -m (the Linux release jobs build natively on
# x86_64 and aarch64 runners, so this matches the produced AppImage).

set -euo pipefail

BUNDLE_DIR="${1:-app/src-tauri/target/release/bundle/appimage}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "Bundle dir $BUNDLE_DIR not found; nothing to strip."
  exit 0
fi

cd "$BUNDLE_DIR"

APPIMAGE="$(ls -1 ./*.AppImage 2>/dev/null | head -n1 || true)"
if [ -z "$APPIMAGE" ]; then
  echo "No AppImage found in $BUNDLE_DIR; nothing to strip."
  exit 0
fi
echo "Stripping bundled Wayland libs from $APPIMAGE"

# --appimage-extract unpacks without needing FUSE.
./"$APPIMAGE" --appimage-extract >/dev/null
rm -f "$APPIMAGE"

removed=0
for pat in 'libwayland-client.so*' 'libwayland-egl.so*' 'libwayland-cursor.so*' 'libwayland-server.so*'; do
  while IFS= read -r lib; do
    echo "  removing $lib"
    rm -f "$lib"
    removed=$((removed + 1))
  done < <(find squashfs-root -type f -name "$pat")
done
echo "Removed $removed bundled Wayland libraries."

case "$(uname -m)" in
  x86_64) AT_ARCH=x86_64 ;;
  aarch64 | arm64) AT_ARCH=aarch64 ;;
  *) AT_ARCH="$(uname -m)" ;;
esac

wget -q "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${AT_ARCH}.AppImage" -O appimagetool
chmod +x appimagetool

ARCH="$AT_ARCH" APPIMAGE_EXTRACT_AND_RUN=1 ./appimagetool squashfs-root "$APPIMAGE"

rm -rf squashfs-root appimagetool
echo "Repacked $APPIMAGE without bundled Wayland libraries."
