#!/usr/bin/env bash
# Run the Trace Marketplace demo on your own computer (macOS or Linux; on
# Windows, run it inside WSL). One line:
#
#   curl -fsSL https://raw.githubusercontent.com/worktrial-p-mehta-byte/trace-marketplace/main/scripts/try-it.sh | bash
#
# It downloads the code to ~/trace-marketplace, fills a local database with
# a synthetic demo market, starts the site and opens it in your browser.
# Nothing needs installing first except curl: if your Node.js is missing or
# too old, a private copy is downloaded into ~/.cache/trace-marketplace (no
# sudo, nothing installed system-wide). Run it again any time to update and
# reset the demo. Stop the site with Ctrl+C.
#
# Settings (optional environment variables):
#   TM_DIR=~/somewhere   where to put the project (default ~/trace-marketplace)
#   TM_PORT=3000         first port to try (the next free one is used)
#   TM_REF=main          branch or tag to download
#   TM_NO_START=1        set everything up but don't start the site
#   TM_NO_OPEN=1         don't open a browser
#   TM_LOCAL_NODE=1      always use the private Node.js copy
#   TM_NODE_MIRROR=url   where to download Node.js from (default nodejs.org)
#   TM_NO_GIT=1          download the code as a tarball even if git is there
set -euo pipefail

REPO="worktrial-p-mehta-byte/trace-marketplace"
REF="${TM_REF:-main}"
NODE_VERSION="22.22.0" # any 22.12+ works; this is the one downloaded if needed
NODE_MIRROR="${TM_NODE_MIRROR:-https://nodejs.org/dist}"
PORT="${TM_PORT:-3000}"

if [ -t 1 ]; then
  B=$'\033[1m' DIM=$'\033[2m' G=$'\033[32m' R=$'\033[31m' X=$'\033[0m'
else
  B="" DIM="" G="" R="" X=""
fi
STEP=0
TOTAL=5
step() { STEP=$((STEP + 1)); printf '\n%s[%d/%d] %s%s\n' "$B" "$STEP" "$TOTAL" "$1" "$X"; }
note() { printf '      %s\n' "$1"; }
fail() {
  printf '\n%sSetup stopped: %s%s\n' "$R" "$1" "$X" >&2
  [ $# -gt 1 ] && printf '%s\n' "$2" >&2
  exit 1
}
# Run a long command quietly; show its output only if it fails.
quietly() {
  local log
  log="$(mktemp)"
  if ! "$@" >"$log" 2>&1; then
    tail -n 30 "$log" >&2
    rm -f "$log"
    fail "\"$*\" failed (output above)." "Run the script again; if it fails the same way, send this output to the presenter."
  fi
  rm -f "$log"
}

# The project folder: this checkout when the script is run from one,
# otherwise TM_DIR.
HERE=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
# This project's folder: its package.json names it.
is_ours() { grep -q '"name": "trace-marketplace"' "$1/package.json" 2>/dev/null; }
is_empty() { [ -d "$1" ] && [ -z "$(ls -A "$1")" ]; }
if [ -n "$HERE" ] && is_ours "$HERE"; then
  DIR="$HERE"
  IN_CHECKOUT=1
else
  DIR="${TM_DIR:-$HOME/trace-marketplace}"
  IN_CHECKOUT=0
fi

printf '%sTrace Marketplace: local demo setup%s\n' "$B" "$X"
printf '%sAbout 3–5 minutes the first time. Everything stays in %s%s\n' "$DIM" "$DIR" "$X"

# ---------------------------------------------------------------------------
step "Checking your computer"
case "$(uname -s)" in
  Darwin) OS=darwin ;;
  Linux) OS=linux ;;
  *) fail "this script runs on macOS and Linux." "On Windows, open WSL (Ubuntu) and paste the same line there." ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) fail "unsupported processor: $(uname -m)." ;;
esac
command -v curl >/dev/null || fail "curl is needed." "Install curl, then paste the line again."
command -v tar >/dev/null || fail "tar is needed." "Install tar, then paste the line again."

node_ok() {
  command -v node >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null
}
# A usable git: on a Mac without developer tools, "git" is a stub that
# opens an installer dialog, so don't call it there.
have_git() {
  [ "${TM_NO_GIT:-0}" != 1 ] || return 1
  command -v git >/dev/null || return 1
  [ "$OS" != darwin ] || xcode-select -p >/dev/null 2>&1
}
# Private Node.js and pnpm copies live in a cache, not the project folder,
# which may not exist yet (and must be empty for the download).
TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/trace-marketplace"
# A system Node.js without npm (some distributions package them apart)
# can't fetch pnpm, so it counts as missing unless the right pnpm is there.
pnpm_or_npm() { command -v npm >/dev/null || command -v pnpm >/dev/null; }
if [ "${TM_LOCAL_NODE:-0}" = 1 ] || ! node_ok || ! pnpm_or_npm; then
  NODE_HOME="$TOOLS/node-v$NODE_VERSION-$OS-$ARCH"
  if [ ! -x "$NODE_HOME/bin/node" ]; then
    note "Node.js 22.12+ not found; downloading a private copy (about 30 MB)…"
    mkdir -p "$TOOLS"
    curl -fsSL "$NODE_MIRROR/v$NODE_VERSION/node-v$NODE_VERSION-$OS-$ARCH.tar.gz" |
      tar -xz -C "$TOOLS" || fail "couldn't download Node.js." "Check your internet connection, or install Node.js 22 from https://nodejs.org and try again."
  fi
  export PATH="$NODE_HOME/bin:$PATH"
fi
note "${G}✓${X} Node.js $(node --version)"

# ---------------------------------------------------------------------------
step "Getting the code"
if [ "$IN_CHECKOUT" = 1 ]; then
  note "Using this checkout: $DIR"
elif [ -e "$DIR" ] && ! is_ours "$DIR" && ! is_empty "$DIR"; then
  # Anything already there must be this project: never update, overwrite or
  # pull into someone else's folder or repository.
  fail "$DIR already exists and isn't this project." "Move it away, or choose another folder: TM_DIR=~/tm-demo, before bash."
elif [ -d "$DIR/.git" ] && have_git; then
  # Update only by fast-forward: local changes or commits are never touched.
  branch="$(git -C "$DIR" symbolic-ref --short -q HEAD || true)"
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    note "You have local changes in $DIR; keeping them and not updating."
  elif [ "$branch" != "$REF" ]; then
    note "$DIR is on ${branch:-a detached commit}, not $REF; not updating."
  elif git -C "$DIR" fetch -q origin "$REF" >/dev/null 2>&1 &&
    git -C "$DIR" merge -q --ff-only FETCH_HEAD >/dev/null 2>&1; then
    note "${G}✓${X} Updated $DIR"
  else
    note "Couldn't update $DIR by fast-forward (offline, or it has its own commits); using it as it is."
  fi
elif { [ ! -e "$DIR" ] || is_empty "$DIR"; } && have_git; then
  quietly git clone -q --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$DIR"
  note "${G}✓${X} Downloaded to $DIR"
else
  # No git (a fresh Mac without developer tools): the same code as a tarball,
  # unpacked next to the target and moved into place only once complete, so
  # an interrupted download never leaves a half-filled folder behind.
  mkdir -p "$(dirname "$DIR")"
  STAGE="$(mktemp -d "$(dirname "$DIR")/.trace-marketplace-download.XXXXXX")"
  if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$STAGE" --strip-components 1; then
    rm -rf "$STAGE"
    fail "couldn't download the code." "Check your internet connection and try again."
  fi
  if [ -d "$DIR" ]; then
    # This project already (a tarball install) or an empty folder: refresh it.
    cp -R "$STAGE"/. "$DIR"/ && rm -rf "$STAGE"
  else
    mv "$STAGE" "$DIR"
  fi
  note "${G}✓${X} Downloaded to $DIR"
fi
cd "$DIR"

# pnpm: the version the project pins, used straight from a private copy if
# yours is missing or different (no global install, no corepack prompts).
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if ! command -v pnpm >/dev/null || [ "$(pnpm --version 2>/dev/null)" != "$PNPM_VERSION" ]; then
  PNPM_DIR="$TOOLS/pnpm-$PNPM_VERSION"
  if [ ! -x "$PNPM_DIR/node_modules/.bin/pnpm" ]; then
    note "Getting pnpm ${PNPM_VERSION}…"
    quietly npm install --silent --no-audit --no-fund --prefix "$PNPM_DIR" "pnpm@$PNPM_VERSION"
  fi
  # On PATH, because the project's own scripts call pnpm too.
  export PATH="$PNPM_DIR/node_modules/.bin:$PATH"
fi
PNPM=(pnpm)
note "${G}✓${X} pnpm $PNPM_VERSION"

# ---------------------------------------------------------------------------
step "Installing dependencies (1–2 minutes)"
quietly "${PNPM[@]}" install --frozen-lockfile
note "${G}✓${X} Installed"

# ---------------------------------------------------------------------------
step "Creating the demo market"
quietly "${PNPM[@]}" demo:reset
quietly "${PNPM[@]}" demo:sessions
note "${G}✓${X} 200 synthetic traces, an open campaign, and seller sessions in demo/seller-sessions/"

# ---------------------------------------------------------------------------
step "Building the site (about a minute)"
quietly "${PNPM[@]}" build
note "${G}✓${X} Built"

port_free() {
  node -e 'const s=require("net").createServer();s.once("error",()=>process.exit(1));s.listen(+process.argv[1],()=>s.close(()=>process.exit(0)))' "$1"
}
for _ in 1 2 3 4 5 6 7 8 9 10; do
  port_free "$PORT" && break
  PORT=$((PORT + 1))
done
port_free "$PORT" || fail "no free port between ${TM_PORT:-3000} and $PORT." "Close other local servers, or set TM_PORT=4000 before bash."
URL="http://localhost:$PORT"

cat <<EOF

${G}${B}Ready.${X} The demo runs at ${B}$URL${X}

  Sign in as a buyer    buyer@example.com   password: demo-password
  Sign in as a seller   seller@example.com  password: demo-password
  …or create your own account.

  Sessions to share     $DIR/demo/seller-sessions
  Script to follow      $DIR/docs/DEMO.md

  Stop with Ctrl+C. Run the same line again to update and start over with a fresh demo.
EOF

if [ "${TM_NO_START:-0}" = 1 ]; then
  exit 0
fi

# Open the browser once the site answers.
if [ "${TM_NO_OPEN:-0}" != 1 ]; then
  (
    for _ in $(seq 1 60); do
      if curl -fs "$URL/api/health" >/dev/null 2>&1; then
        if command -v open >/dev/null; then
          open "$URL"
        elif command -v xdg-open >/dev/null; then
          xdg-open "$URL" >/dev/null 2>&1
        fi
        break
      fi
      sleep 1
    done
  ) &
fi
exec "${PNPM[@]}" --filter @tm/web exec next start --port "$PORT"
