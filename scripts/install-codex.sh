#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CODEX_HOME_DIR="${CODEX_HOME:-"$HOME/.codex"}"
CONFIG_PATH="$CODEX_HOME_DIR/config.toml"
SERVER_NAME="seedance-movie"
NODE_VERSION="v24.16.0"
ARK_MODEL="doubao-seedance-2-0-260128"
ARK_BASE_URL="https://ark.cn-beijing.volces.com/api/v3"
ARK_MAX_CONCURRENCY="3"
FFMPEG_PATH_VALUE="ffmpeg"
SKIP_BUILD=0
UPDATE_SOURCE=0

usage() {
  cat <<'EOF'
Usage: scripts/install-codex.sh [options]

Options:
  --project-root PATH          Project root. Defaults to this repository.
  --config-path PATH           Codex config path. Defaults to $CODEX_HOME/config.toml or ~/.codex/config.toml.
  --server-name NAME           MCP server name. Defaults to seedance-movie.
  --node-version VERSION       Node.js version. Defaults to v24.16.0.
  --ark-model MODEL            Default Ark model.
  --ark-base-url URL           Ark API base URL.
  --ark-max-concurrency N      Default generation concurrency.
  --ffmpeg-path PATH           ffmpeg command/path.
  --skip-build                 Do not run npm install/build.
  --update-source              Run git pull --ff-only before installing when this is a git checkout.
  -h, --help                   Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-root) PROJECT_ROOT="$(cd "$2" && pwd -P)"; shift 2 ;;
    --config-path) CONFIG_PATH="$2"; shift 2 ;;
    --server-name) SERVER_NAME="$2"; shift 2 ;;
    --node-version) NODE_VERSION="$2"; shift 2 ;;
    --ark-model) ARK_MODEL="$2"; shift 2 ;;
    --ark-base-url) ARK_BASE_URL="$2"; shift 2 ;;
    --ark-max-concurrency) ARK_MAX_CONCURRENCY="$2"; shift 2 ;;
    --ffmpeg-path) FFMPEG_PATH_VALUE="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --update-source) UPDATE_SOURCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

log() {
  printf '[seedance-movie] %s\n' "$1"
}

runtime_arch() {
  case "$(uname -m)" in
    x86_64|amd64) printf 'x64' ;;
    aarch64|arm64) printf 'arm64' ;;
    *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
  esac
}

download() {
  local url="$1"
  local output="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fL "$url" -o "$output"
  elif command -v wget >/dev/null 2>&1; then
    wget -O "$output" "$url"
  else
    echo "curl or wget is required to download Node.js" >&2
    exit 1
  fi
}

ensure_node() {
  local arch
  arch="$(runtime_arch)"
  local runtime_platform="linux-$arch"
  local runtime_dir="$PROJECT_ROOT/.mcp-runtime"
  local node_dir="$runtime_dir/node-$NODE_VERSION-$runtime_platform"
  NODE_EXE="$node_dir/bin/node"
  NPM_EXE="$node_dir/bin/npm"
  NODE_BIN_DIR="$node_dir/bin"

  if [[ -x "$NODE_EXE" && -x "$NPM_EXE" ]]; then
    return
  fi

  log "Installing Node.js $NODE_VERSION for $runtime_platform"
  mkdir -p "$runtime_dir"

  local archive_name="node-$NODE_VERSION-$runtime_platform.tar.xz"
  local archive_path="$runtime_dir/$archive_name"
  local dist_url="https://nodejs.org/dist/$NODE_VERSION/$archive_name"
  local sha_url="https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
  rm -rf "$node_dir" "$archive_path"

  download "$dist_url" "$archive_path"
  local expected_hash
  expected_hash="$(download_to_stdout "$sha_url" | awk -v file="$archive_name" '$2 == file { print $1; exit }')"
  if [[ -z "$expected_hash" ]]; then
    echo "Cannot find checksum for $archive_name" >&2
    exit 1
  fi
  local actual_hash
  actual_hash="$(sha256sum "$archive_path" | awk '{ print $1 }')"
  if [[ "$actual_hash" != "$expected_hash" ]]; then
    echo "SHA256 mismatch for $archive_name" >&2
    exit 1
  fi

  tar -xJf "$archive_path" -C "$runtime_dir"
  if [[ ! -x "$NODE_EXE" || ! -x "$NPM_EXE" ]]; then
    echo "Node.js install did not create expected files in $node_dir" >&2
    exit 1
  fi
}

download_to_stdout() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsL "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url"
  else
    echo "curl or wget is required to download Node.js" >&2
    exit 1
  fi
}

update_source_if_requested() {
  if [[ "$UPDATE_SOURCE" != "1" ]]; then
    return
  fi
  if [[ ! -d "$PROJECT_ROOT/.git" ]]; then
    log "Skipping source update because this folder is not a git repository"
    return
  fi

  log "Updating source with git pull --ff-only"
  git -C "$PROJECT_ROOT" pull --ff-only
}

ensure_build() {
  if [[ "$SKIP_BUILD" == "1" ]]; then
    return
  fi

  log "Installing dependencies"
  PATH="$NODE_BIN_DIR:$PATH" "$NPM_EXE" install --prefix "$PROJECT_ROOT"
  log "Building TypeScript output"
  PATH="$NODE_BIN_DIR:$PATH" "$NPM_EXE" run build --prefix "$PROJECT_ROOT"
}

remove_toml_table() {
  local table_name="$1"
  local input="$2"
  local output="$3"
  awk -v table="[$table_name]" '
    {
      trimmed=$0
      gsub(/^[ \t]+|[ \t]+$/, "", trimmed)
      if (trimmed == table) {
        skip=1
        next
      }
      if (skip && trimmed ~ /^\[.*\]$/) {
        skip=0
      }
      if (!skip) {
        print $0
      }
    }
  ' "$input" > "$output"
}

write_codex_config() {
  mkdir -p "$(dirname "$CONFIG_PATH")"
  local tmp1 tmp2
  tmp1="$(mktemp)"
  tmp2="$(mktemp)"

  if [[ -f "$CONFIG_PATH" ]]; then
    local backup="$CONFIG_PATH.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$CONFIG_PATH" "$backup"
    log "Backed up existing Codex config to $backup"
    cp "$CONFIG_PATH" "$tmp1"
  else
    : > "$tmp1"
  fi

  remove_toml_table "mcp_servers.$SERVER_NAME" "$tmp1" "$tmp2"
  remove_toml_table "mcp_servers.$SERVER_NAME.env" "$tmp2" "$tmp1"

  cat "$tmp1" > "$CONFIG_PATH"
  cat >> "$CONFIG_PATH" <<EOF

[mcp_servers.$SERVER_NAME]
type = "stdio"
command = '$NODE_EXE'
args = ['$PROJECT_ROOT/scripts/start-mcp.mjs']
startup_timeout_sec = 120

[mcp_servers.$SERVER_NAME.env]
ARK_MODEL = "$ARK_MODEL"
ARK_BASE_URL = "$ARK_BASE_URL"
ARK_MAX_CONCURRENCY = "$ARK_MAX_CONCURRENCY"
FFMPEG_PATH = "$FFMPEG_PATH_VALUE"
# Set ARK_API_KEY as an environment variable or add it here locally.
# Optional: SEEDANCE_STORY_SKILL_PATH = "/path/to/story-skill.md"
EOF

  rm -f "$tmp1" "$tmp2"
  log "Installed MCP server '$SERVER_NAME' into $CONFIG_PATH"
}

update_source_if_requested
ensure_node
ensure_build
write_codex_config
log "Checking launcher"
"$NODE_EXE" "$PROJECT_ROOT/scripts/start-mcp.mjs" --check
log "Done. Restart Codex CLI to load the new MCP server."
