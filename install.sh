#!/bin/sh
# Kairo Launcher for Linux: install, update or remove it for the current user.
#
#   curl -fsSL https://raw.githubusercontent.com/Mordsome/KairoLauncher/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/Mordsome/KairoLauncher/main/install.sh | sh -s -- --uninstall
#
# What it does, and nothing else:
#  1. Reads the newest release of Mordsome/KairoLauncher (latest-linux.yml) and
#     downloads its AppImage and the AppImage's signature, only from that
#     repository's own release pages.
#  2. Checks the AppImage against Mordsome's signature (the same key the
#     launcher's own updates are checked with) and the release's SHA-512.
#     Nothing is installed or run unless both check out.
#  3. Puts it in ~/.local/share/kairo-launcher, adds Kairo Launcher to your app
#     menu and a `kairo-launcher` command. No sudo; nothing outside your home
#     folder (except one AppArmor rule on Ubuntu 24.04 and newer, only if you
#     say yes). The launcher then keeps itself up to date.

set -eu

REPO="https://github.com/Mordsome/KairoLauncher/releases"
# Mordsome's release key (Ed25519, the same as config/release-key.json in the repository).
KEY='MCowBQYDK2VwAyEAR1A0vSaI9iTlzt9gOT82GlVn0ohvaBegZneZupHlU5o='

DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
DIR="$DATA/kairo-launcher"
APP="$DIR/KairoLauncher.AppImage"
ICON="$DIR/kairo-launcher.png"
DESKTOP="$DATA/applications/kairo-launcher.desktop"
BIN="$HOME/.local/bin/kairo-launcher"
PROFILE=/etc/apparmor.d/kairo-launcher

# ---- Looks ----
if [ -t 1 ]; then B=$(printf '\033[1m'); C=$(printf '\033[36m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); N=$(printf '\033[0m'); else B= C= G= Y= R= N=; fi
step() { printf '%s==>%s %s%s%s\n' "$C" "$N" "$B" "$1" "$N"; }
ok() { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
note() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
fail() { printf '\n%sKairo Launcher was not installed:%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

# How to install a package on this distro, for messages: pkg <Arch> <Debian/Ubuntu> <Fedora> <openSUSE>.
pkg() {
  if command -v pacman >/dev/null 2>&1; then echo "sudo pacman -S $1"
  elif command -v apt-get >/dev/null 2>&1; then echo "sudo apt install $2"
  elif command -v dnf >/dev/null 2>&1; then echo "sudo dnf install $3"
  elif command -v zypper >/dev/null 2>&1; then echo "sudo zypper install $4"
  else echo "install \"$1\" with your package manager"; fi
}

# ---- Remove ----
if [ "${1:-}" = "--uninstall" ]; then
  step "Removing Kairo Launcher"
  rm -f "$APP" "$ICON" "$DESKTOP" "$BIN"
  rmdir "$DIR" 2>/dev/null || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" 2>/dev/null || true
  ok "Removed the app, its menu entry and the kairo-launcher command."
  note "Your installs, worlds and settings are kept in ~/.config/Kairo Launcher. Delete that folder to remove them too."
  [ -e "$PROFILE" ] && note "To remove the AppArmor rule as well: sudo rm $PROFILE"
  exit 0
fi

# ---- Before anything ----
[ "$(id -u)" -ne 0 ] || fail "run it as yourself, without sudo. It installs for your user only."
[ "$(uname -m)" = "x86_64" ] || fail "Kairo Launcher is only built for 64-bit PCs (x86_64) so far."
command -v curl >/dev/null 2>&1 || fail "curl is missing. Install it with: $(pkg curl curl curl curl)"
case "$(openssl version 2>/dev/null)" in
  "OpenSSL 3"* | "OpenSSL 4"*) ;;
  *) fail "OpenSSL 3 is needed to check Mordsome's signature. Install it with: $(pkg openssl openssl openssl openssl)" ;;
esac

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# Downloads only ever come from Mordsome/KairoLauncher's own release pages.
get() { curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$REPO/$1" || fail "couldn't download $1 from GitHub. Check your connection and try again."; }

# ---- 1. The newest release ----
step "Finding the newest Kairo Launcher"
get latest/download/latest-linux.yml "$TMP/latest.yml"
VERSION=$(sed -n 's/^version: *//p' "$TMP/latest.yml" | tr -d "'\"\r")
FILE=$(sed -n 's/^path: *//p' "$TMP/latest.yml" | tr -d "'\"\r")
SHA512=$(sed -n 's/^sha512: *//p' "$TMP/latest.yml" | tr -d "'\"\r")
echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail "the release information looks wrong."
[ "$FILE" = "KairoLauncher-$VERSION.AppImage" ] || fail "the release information looks wrong."
ok "Version $VERSION"

printf '%s==>%s %sDownloading%s\n' "$C" "$N" "$B" "$N"
curl -fL --progress-bar --proto '=https' --tlsv1.2 -o "$TMP/$FILE" "$REPO/download/v$VERSION/$FILE" || fail "the download didn't finish. Try again."
get "download/v$VERSION/$FILE.sig" "$TMP/$FILE.sig"

# ---- 2. Checks ----
step "Checking it"
HEX=$(sha512sum "$TMP/$FILE" | cut -d' ' -f1)
[ "$(printf '%s' "$SHA512" | base64 -d 2>/dev/null | od -An -v -tx1 | tr -d ' \n')" = "$HEX" ] || fail "the download doesn't match the release's checksum."
ok "Matches the release's SHA-512"
printf '%s\n' '-----BEGIN PUBLIC KEY-----' "$KEY" '-----END PUBLIC KEY-----' > "$TMP/key.pem"
# The signed text names the file and its hash, so a signature can't be moved to another file.
printf 'KairoLauncher update signature v1\nfile: %s\nsha512: %s\n' "$FILE" "$HEX" > "$TMP/statement"
tr -d ' \r\n' < "$TMP/$FILE.sig" | base64 -d > "$TMP/sig.bin" 2>/dev/null || fail "the signature file is damaged."
openssl pkeyutl -verify -pubin -inkey "$TMP/key.pem" -rawin -in "$TMP/statement" -sigfile "$TMP/sig.bin" >/dev/null 2>&1 \
  || fail "the download isn't signed by Mordsome. Nothing was installed."
ok "Signed by Mordsome"

# ---- 3. Install ----
step "Installing"
mkdir -p "$DIR" "$DATA/applications" "$HOME/.local/bin"
chmod 755 "$TMP/$FILE"
# The icon, from the checked AppImage itself (only extracted, not started).
(cd "$TMP" && "./$FILE" --appimage-extract '*.png' >/dev/null 2>&1) || true
for png in "$TMP"/squashfs-root/*.png; do [ -f "$png" ] && cp "$png" "$ICON" && break; done
# A fixed name, so the launcher's own updater replaces this same file.
mv -f "$TMP/$FILE" "$APP"
ok "App: $APP"

cat > "$BIN" <<EOF
#!/bin/sh
# Starts Kairo Launcher (installed by install.sh). Without FUSE 2, the AppImage unpacks itself on each start instead.
if ! { /sbin/ldconfig -p 2>/dev/null || ldconfig -p 2>/dev/null; } | grep -q 'libfuse\.so\.2'; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
exec "$APP" "\$@"
EOF
chmod 755 "$BIN"
ok "Command: kairo-launcher"

cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=Kairo Launcher
Comment=Launcher for the Kairo Minecraft clients
Exec="$BIN" %U
Icon=$ICON
Terminal=false
Categories=Game;
StartupWMClass=kairo-launcher
EOF
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" 2>/dev/null || true
ok "Added to your app menu"

# ---- Things some systems need ----
if ! { /sbin/ldconfig -p 2>/dev/null || ldconfig -p 2>/dev/null; } | grep -q 'libfuse\.so\.2'; then
  note "FUSE 2 isn't installed, so the launcher unpacks itself on every start (a few seconds slower)."
  note "To make it start faster: $(pkg fuse2 'libfuse2t64 (or libfuse2 before Ubuntu 24.04 / Debian 13)' fuse-libs libfuse2)"
fi

# Ubuntu 24.04 and newer block the sandbox Electron apps use, unless an AppArmor rule allows it.
if [ "$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)" = "1" ] && [ ! -e "$PROFILE" ]; then
  RULE="abi <abi/4.0>,
include <tunables/global>
profile kairo-launcher /{tmp/.mount_KairoL*,tmp/appimage_extracted_*}/kairo-launcher flags=(unconfined) {
  userns,
}"
  note "Your system (Ubuntu 24.04 or newer) blocks the security sandbox Kairo Launcher uses."
  note "One AppArmor rule fixes that just for Kairo Launcher. It needs your password once:"
  printf '%s\n' "$RULE" | sed 's/^/      /'
  answer=n
  if [ -r /dev/tty ]; then printf '  Add it now? [Y/n] '; read -r answer < /dev/tty || answer=n; answer=${answer:-y}; fi
  case "$answer" in
    [Yy]*) printf '%s\n' "$RULE" | sudo tee "$PROFILE" >/dev/null && sudo apparmor_parser -r "$PROFILE" && ok "AppArmor rule added" || note "That didn't work; the launcher may not start until the rule is added." ;;
    *) note "Skipped. To add it later, run this script again." ;;
  esac
fi

printf '\n%s%sKairo Launcher %s is installed.%s\n' "$G" "$B" "$VERSION" "$N"
printf '  Start it from your app menu, or run: %skairo-launcher%s\n' "$B" "$N"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) note "~/.local/bin isn't in your PATH yet; the app menu works, or log out and back in." ;; esac
printf '  It keeps itself up to date. To remove it: curl -fsSL https://raw.githubusercontent.com/Mordsome/KairoLauncher/main/install.sh | sh -s -- --uninstall\n'
