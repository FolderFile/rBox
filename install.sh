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
  Darwin) os=darwin ;;
  *) echo "error: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)
    if [ "$os" = darwin ]; then
      echo "error: no release for Intel macs; use Rosetta or build from source" >&2
      exit 1
    fi
    target=x86_64-unknown-linux-musl ;;
  aarch64|arm64)
    case "$os" in
      darwin) target=aarch64-apple-darwin ;;
      linux) target=aarch64-unknown-linux-gnu ;;
    esac ;;
  *) echo "error: unsupported architecture $(uname -m)" >&2; exit 1 ;;
esac

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
asset_id=$(printf '%s' "$meta" | awk -v a="rbox-$target.tar.gz" '
  /"id":/ { id = $0; gsub(/[^0-9]/, "", id) }
  $0 ~ "\"" a "\"" { print id; found = 1; exit }
  END { if (!found) exit 1 }') || {
  echo "error: no rbox-$target.tar.gz asset found" >&2
  exit 1
}
echo "downloading rbox ${tag:-unknown} ($target)"

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