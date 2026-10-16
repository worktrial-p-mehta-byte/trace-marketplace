#!/usr/bin/env bash
# Run the Trace Marketplace demo on your own computer (macOS or Linux; on
# Windows, run it inside WSL). One line:
#
#   curl -fsSL https://raw.githubusercontent.com/worktrial-p-mehta-byte/trace-marketplace/main/scripts/try-it.sh | bash
#
# It downloads the code to ~/trace-marketplace, fills a local database with
# a synthetic demo market, starts the site and opens it in your browser.
# Nothing needs installing first except curl: if your Node.js is missing or
# too old, a private copy is downloaded into the project folder (no sudo,
# nothing changed elsewhere). Run it again any time to update and reset the
# demo. Stop the site with Ctrl+C.
#
# Settings (optional environment variables):
#   TM_DIR=~/somewhere   where to put the project (default ~/trace-marketplace)
#   TM_PORT=3000         first port to try (the next free one is used)
#   TM_REF=main          branch or tag to download
#   TM_NO_START=1        set everything up but don't start the site
#   TM_NO_OPEN=1         don't open a browser
#   TM_LOCAL_NODE=1      always use the private Node.js copy
set -euo pipefail

REPO="worktrial-p-mehta-byte/trace-marketplace"
REF="${TM_REF:-main}"
NODE_VERSION="22.22.0" # any 22.12+ works; this is the one downloaded if needed
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
if [ -n "$HERE" ] && grep -q '"name": "trace-marketplace"' "$HERE/package.json" 2>/dev/null; then
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
  command -v git >/dev/null || return 1
  [ "$OS" != darwin ] || xcode-select -p >/dev/null 2>&1
}
TOOLS="$DIR/.tools"
if [ "${TM_LOCAL_NODE:-0}" = 1 ] || ! node_ok; then
  NODE_HOME="$TOOLS/node-v$NODE_VERSION-$OS-$ARCH"
  if [ ! -x "$NODE_HOME/bin/node" ]; then
    note "Node.js 22.12+ not found; downloading a private copy (about 30 MB)…"
    mkdir -p "$TOOLS"
    curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-$OS-$ARCH.tar.gz" |
      tar -xz -C "$TOOLS" || fail "couldn't download Node.js." "Check your internet connection, or install Node.js 22 from https://nodejs.org and try again."
  fi
  export PATH="$NODE_HOME/bin:$PATH"
fi
note "${G}✓${X} Node.js $(node --version)"

# ---------------------------------------------------------------------------
step "Getting the code"
if [ "$IN_CHECKOUT" = 1 ]; then
  note "Using this checkout: $DIR"
elif [ -d "$DIR/.git" ] && have_git; then
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no)" ]; then
    note "You have local changes in $DIR; keeping them and not updating."
  else
    quietly git -C "$DIR" fetch --depth 1 origin "$REF"
    quietly git -C "$DIR" checkout -q -B "$REF" FETCH_HEAD
    note "${G}✓${X} Updated $DIR"
  fi
elif [ -e "$DIR" ] && [ ! -f "$DIR/package.json" ]; then
  fail "$DIR already exists and isn't this project." "Move it away, or choose another folder: TM_DIR=~/tm-demo, before bash."
elif [ ! -e "$DIR" ] && have_git; then
  quietly git clone -q --depth 1 --branch "$REF" "https://github.com/$REPO.git" "$DIR"
  note "${G}✓${X} Downloaded to $DIR"
else
  # No git (a fresh Mac without developer tools): the same code as a tarball.
  mkdir -p "$DIR"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" | tar -xz -C "$DIR" --strip-components 1 ||
    fail "couldn't download the code." "Check your internet connection and try again."
  note "${G}✓${X} Downloaded to $DIR"
fi
cd "$DIR"

# pnpm: the version the project pins, used straight from a private copy if
# yours is missing or different (no global install, no corepack prompts).
PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if command -v pnpm >/dev/null && [ "$(pnpm --version 2>/dev/null)" = "$PNPM_VERSION" ]; then
  PNPM=(pnpm)
else
  if [ ! -x "$TOOLS/pnpm/node_modules/.bin/pnpm" ] ||
    [ "$("$TOOLS/pnpm/node_modules/.bin/pnpm" --version)" != "$PNPM_VERSION" ]; then
    note "Getting pnpm $PNPM_VERSION…"
    quietly npm install --silent --no-audit --no-fund --prefix "$TOOLS/pnpm" "pnpm@$PNPM_VERSION"
  fi
  PNPM=("$TOOLS/pnpm/node_modules/.bin/pnpm")
fi
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
