#!/bin/sh
# rbox installer: downloads the latest release binary from GitHub.
#   curl -fsSL https://raw.githubusercontent.com/FolderFile/rBox/main/install.sh | sh
# RBOX_VERSION=<tag>    install a specific release instead of the latest
# RBOX_INSTALL_DIR=<d>  install into <d> instead of /usr/local/bin
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

if [ -n "${RBOX_VERSION:-}" ]; then
  tag="$RBOX_VERSION"
else
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$tag" ] || { echo "error: cannot resolve latest release" >&2; exit 1; }
fi

url="https://github.com/$REPO/releases/download/$tag/rbox-$target.tar.gz"
echo "downloading rbox $tag ($target)"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM

curl -fsSL "$url" -o "$tmp/rbox.tar.gz"
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