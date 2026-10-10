#!/usr/bin/env bash
# The Wingman, an add-on for Godspeed Mission Control: the installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash
#
# With options for the setup, put them after "bash -s --", for example:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-wingman/main/install.sh | bash -s -- --godspeed ~/my-mission-control
#
# Run it as the account your mission control belongs to. On a server it can also run as root: the
# worker then runs as the account that owns the mission control folder.
#
# What it does:
#   1. Finds Node.js 22 or newer: on the PATH, the Node that Hermes brings (~/.hermes/tools/node-*),
#      nvm's, Homebrew's, /usr/local/bin or /usr/bin. It installs nothing of its own.
#   2. Downloads the newest release of the Wingman from GitHub (main, when there is no release yet)
#      into a temporary folder. GODSPEED_WINGMAN_REF=<tag or branch> picks another one.
#   3. Runs the Wingman's setup with your options. The setup copies the program to
#      ~/.godspeed/addons/godspeed-wingman (as root on Linux: /usr/local/lib/godspeed-wingman), adds
#      the godspeed-wingman command to ~/.godspeed/bin (as root: /usr/local/bin), makes the private
#      folder ~/.godspeed/wingman (as root: /var/lib/godspeed/wingman), writes your files in
#      <mission control>/routines/wingman (never over files you already have), copies the recipes
#      to <mission control>/skills, connects Hermes and Claude Code when it finds them, and starts
#      the worker: a LaunchAgent on macOS, a systemd user service on a Linux desktop, a systemd
#      service on a server.
#   4. Deletes the temporary folder.
#
# What it asks: nothing itself. The setup then asks its questions: on a computer with a screen in
# your browser (the Wingman's desk), on a server in this terminal.
#
# What only you do: answer the setup questions (your taste is yours; nobody fills it in for you),
# log into your dating site once in the Wingman's own browser, and answer the first practice round.
#
# Safe to run again: it is also the update. Your preferences, watch list, settings and everything
# the Wingman kept stay as they are. To take it out: godspeed-wingman uninstall
#
# Everything sits inside main(), so bash has read the whole file before anything runs, even under
# "curl | bash".

main() {
  set -euo pipefail
  local repo="MichaelZelbel/godspeed-wingman"

  say() { printf '%s\n' "$*"; }
  major() { "$1" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p' | head -n 1; }

  # 1. Node.js 22 or newer.
  local node="" c m
  for c in "$(command -v node 2>/dev/null || true)" \
           $(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -r) \
           $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r) \
           /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    m="$(major "$c")"
    if [ -n "$m" ] && [ "$m" -ge 22 ]; then node="$c"; break; fi
  done
  if [ -z "$node" ]; then
    say "The Wingman needs Node.js 22 or newer, and none was found on this computer."
    say "Install Godspeed Mission Control first (its Hermes brings its own Node), or Node.js LTS from"
    say "https://nodejs.org (on macOS also: brew install node), then run this line again."
    exit 1
  fi

  # 2. The newest release, or main.
  local ref="${GODSPEED_WINGMAN_REF:-}"
  if [ -z "$ref" ]; then
    # The answer is JSON on one line (or several); take the value of "tag_name" either way.
    ref="$(curl -fsSL -H 'User-Agent: godspeed-wingman-installer' "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
      | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    [ -n "$ref" ] || ref="main"
  fi

  # A global, so the cleanup at the end still knows it after main() returned.
  WINGMAN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/godspeed-wingman-XXXXXX")"
  trap 'rm -rf "${WINGMAN_TMP:-}"' EXIT
  local tmp="$WINGMAN_TMP"
  if ! curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" | tar -xz -C "$tmp"; then
    say "Could not download the Wingman ($ref) from GitHub. Check the internet connection and run this line again."
    exit 1
  fi
  local pkg
  pkg="$(ls -d "$tmp"/godspeed-wingman-* 2>/dev/null | head -n 1)"
  if [ -z "$pkg" ] || [ ! -f "$pkg/bin/godspeed-wingman.mjs" ]; then
    say "The download did not hold the Wingman. Run this line again in a few minutes."
    exit 1
  fi
  say "The Wingman ($ref), with Node $("$node" --version) at $node"

  # 3. The setup. Under "curl | bash" the keyboard is not standard input (the script is), so the
  # setup questions read from the terminal itself when there is one.
  local code=0
  if [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
    "$node" "$pkg/bin/godspeed-wingman.mjs" setup "$@" < /dev/tty || code=$?
  else
    "$node" "$pkg/bin/godspeed-wingman.mjs" setup "$@" < /dev/null || code=$?
  fi
  if [ "$code" -ne 0 ]; then
    say "The setup stopped (exit $code). What it printed above says why; run this line again once that is fixed."
    exit "$code"
  fi
}

main "$@"
