#!/bin/sh
# rbox installer: downloads the latest release binary from GitHub.
#   curl -fsSL https://raw.githubusercontent.com/FolderFile/rBox/main/install.sh | sh
# RBOX_VERSION=<tag>    install a specific release instead of the latest
# RBOX_INSTALL_DIR=<d>  install into <d> instead of /usr/local/bin
# GITHUB_TOKEN=<t>      needed only while the repo is private
set -eu

REPO="FolderFile/rBox"

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "error: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

# clean asset names; every platform's archive contains just the rbox binary
asset_name="rbox-$os-$arch.tar.gz"

auth=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
  auth="Authorization: Bearer $GITHUB_TOKEN"
fi

api="https://api.github.com/repos/$REPO/releases"
asset="$api/assets"

if [ -n "${RBOX_VERSION:-}" ]; then
  rel="$api/tags/$RBOX_VERSION"
else
  rel="$api/latest"
fi

# the assets endpoint works for private repos too (browser_download_url
# does not), so go through the API unconditionally
meta=$(curl -fsSL ${auth:+-H "$auth"} "$rel")
tag=$(printf '%s' "$meta" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
asset_id=$(printf '%s' "$meta" | awk -v a="$asset_name" '
  /"id":/ { id = $0; gsub(/[^0-9]/, "", id) }
  $0 ~ "\"" a "\"" { print id; found = 1; exit }
  END { if (!found) exit 1 }') || {
  echo "error: no $asset_name asset found" >&2
  exit 1
}
echo "downloading rbox ${tag:-unknown} ($asset_name)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

curl -fsSL ${auth:+-H "$auth"} -H "Accept: application/octet-stream" \
  "$asset/$asset_id" -o "$tmp/rbox.tar.gz"
tar -xzf "$tmp/rbox.tar.gz" -C "$tmp"

if [ -n "${RBOX_INSTALL_DIR:-}" ]; then
  dest="$RBOX_INSTALL_DIR"
  mkdir -p "$dest"
else
  dest=/usr/local/bin
  if [ ! -w "$dest" ] && ! mkdir -p "$dest" 2>/dev/null; then
    if command -v sudo >/dev/null 2>&1; then
      sudo tar -xzf "$tmp/rbox.tar.gz" -C "$dest" rbox
      sudo chmod 755 "$dest/rbox"
      echo "installed $dest/rbox"
      exit 0
    fi
    dest="$HOME/.local/bin"
    mkdir -p "$dest"
  fi
fi

mv "$tmp/rbox" "$dest/rbox"
chmod 755 "$dest/rbox"
echo "installed $dest/rbox"

case ":$PATH:" in
  *":$dest:"*) ;;
  *) echo "note: $dest is not in your PATH" ;;
esac