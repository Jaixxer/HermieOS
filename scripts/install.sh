#!/usr/bin/env bash
#
# HermieOS installer
#
# HermieOS is a shell around an EXISTING Hermes Agent. It never bundles
# its own agent — it attaches to the one you already run, whether that
# is:
#
#   1. A local install on this machine   (HTTP API on 127.0.0.1:8642)
#   2. A Docker container on this machine (published port, e.g. 8642)
#   3. A remote machine / service        (https://hermes.example.com:8642)
#
# This script asks where your Hermes lives, where the HermieOS MCP
# server should run (host process or its own container on Hermes's
# Docker network), and how to reach the database. It then writes a
# ready-to-use .env and applies the schema.
#
# Usage:
#   ./scripts/install.sh
#
# Test / automation knobs:
#   HERMIEOS_ENV_FILE=/path/to/env   write config to a custom file
#   HERMIEOS_DRY_RUN=1               configure only — no install/migrate
#   HERMIEOS_ASSUME_YES=1            non-interactive, use defaults
#   HERMIEOS_GATEWAY_URL=...         pre-answer "where is Hermes"
#   HERMIEOS_API_KEY=...             pre-answer the Hermes bearer key
#
set -u

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
ENV_FILE="${HERMIEOS_ENV_FILE:-.env}"
DRY_RUN="${HERMIEOS_DRY_RUN:-0}"
ASSUME_YES="${HERMIEOS_ASSUME_YES:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Terminal helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s%s%s\n' "$CYAN" "$*" "$RESET"; }
ok()   { printf '%s✓ %s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s! %s%s\n' "$YELLOW" "$*" "$RESET"; }
fail() { printf '%s✗ %s%s\n' "$RED" "$*" "$RESET"; }

die()  { fail "$*"; exit 1; }

# Ask a question. $1 = prompt, $2 = default. Reads into REPLY.
ask() {
  local prompt="$1" default="${2:-}"
  if [ "$ASSUME_YES" = "1" ] && [ -n "$default" ]; then
    REPLY="$default"
    info "$prompt [$default] (assumed)"
    return
  fi
  if [ -n "$default" ]; then
    read -r -p "$prompt [$default] " REPLY
    if [ -z "$REPLY" ]; then REPLY="$default"; fi
  else
    read -r -p "$prompt " REPLY
  fi
}

# ---------------------------------------------------------------------------
# Prerequisite checks
# ---------------------------------------------------------------------------
check_prereqs() {
  info "== Checking prerequisites =="

  if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
    if [ "${NODE_MAJOR:-0}" -lt 22 ]; then
      warn "Node.js ${NODE_MAJOR} detected — HermieOS requires Node 22+."
    else
      ok "Node.js ${NODE_MAJOR} found"
    fi
  else
    die "Node.js not found. Install Node 22+ first (https://nodejs.org)."
  fi

  if command -v pnpm >/dev/null 2>&1; then
    PNPM_MAJOR="$(pnpm --version 2>/dev/null | grep -oE '^[0-9]+' || echo 0)"
    if [ "${PNPM_MAJOR:-0}" -lt 10 ]; then
      warn "pnpm ${PNPM_MAJOR} detected — HermieOS requires pnpm 10+."
    else
      ok "pnpm ${PNPM_MAJOR} found"
    fi
  else
    die "pnpm not found. Install it with: npm i -g pnpm"
  fi

  if command -v docker >/dev/null 2>&1; then
    ok "docker found"
    DOCKER_AVAILABLE=1
  else
    warn "docker not found — you'll need a reachable Postgres another way."
    DOCKER_AVAILABLE=0
  fi

  if [ -f "$ROOT_DIR/package.json" ]; then
    ok "HermieOS source found at $ROOT_DIR"
  else
    die "package.json not found next to this script. Run from the HermieOS repo."
  fi
}

# ---------------------------------------------------------------------------
# Where does Hermes live?
# ---------------------------------------------------------------------------
ask_hermes_location() {
  info ""
  info "== Where is your Hermes Agent? =="
  say  "HermieOS attaches to the Hermes Agent you already run."
  say  ""
  say  "  1) Same machine — systemwide/local install (CLI + HTTP API)"
  say  "  2) Docker container on this machine"
  say  "  3) Another machine / remote server"
  say  ""

  local choice=""
  if [ -n "${HERMIEOS_GATEWAY_URL:-}" ]; then
    choice="3"
    info "Gateway URL provided via env: ${HERMIEOS_GATEWAY_URL}"
  else
    ask "Where is Hermes installed? (1/2/3)" "1"
    choice="$REPLY"
  fi

  case "$choice" in
    1)
      local port
      ask "Hermes API port" "8642"
      port="$REPLY"
      GATEWAY_URL="http://127.0.0.1:${port}"
      HERMES_LOCATION="local"
      MCP_MODE_DEFAULT="host"
      say "  → systemwide Hermes at ${GATEWAY_URL}."
      ;;
    2)
      local port container
      ask "Published Hermes API port (as seen from this machine)" "8642"
      port="$REPLY"
      ask "Hermes container name (for host.docker.internal wiring, or blank)" ""
      container="$REPLY"
      GATEWAY_URL="http://localhost:${port}"
      HERMES_LOCATION="docker"
      MCP_MODE_DEFAULT="host"
      HERMES_CONTAINER_NAME="${container:-}"
      say "  → Hermes in Docker, reachable at ${GATEWAY_URL}."
      ;;
    3)
      local url
      if [ -z "${HERMIEOS_GATEWAY_URL:-}" ]; then
        ask "Hermes gateway URL (e.g. https://hermes.example.com:8642)" ""
        url="$REPLY"
        [ -z "$url" ] && die "Gateway URL is required."
      else
        url="$HERMIEOS_GATEWAY_URL"
      fi
      GATEWAY_URL="$url"
      HERMES_LOCATION="remote"
      MCP_MODE_DEFAULT="docker"
      say "  → remote Hermes at ${GATEWAY_URL}."
      ;;
    *)
      die "Pick 1, 2 or 3."
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Hermes data root (where config.yaml / skills live)
# ---------------------------------------------------------------------------
ask_hermes_home() {
  # Systemwide Hermes keeps its data in ~/.hermes; the Docker image
  # uses /opt/hermes (HERMES_HOME inside the container).
  local default_home
  if [ "$HERMES_LOCATION" = "local" ]; then
    default_home="${HOME}/.hermes"
  else
    default_home="${HERMES_HOME:-/opt/hermes}"
  fi

  if [ -n "${HERMIEOS_HERMES_HOME:-}" ]; then
    HERMES_HOME="$HERMIEOS_HERMES_HOME"
    info "Hermes data root provided via env: ${HERMES_HOME}"
    return
  fi

  ask "Hermes data root (config.yaml + skills live here)" "$default_home"
  HERMES_HOME="$REPLY"
  [ -z "$HERMES_HOME" ] && HERMES_HOME="$default_home"
}

# ---------------------------------------------------------------------------
# Hermes API key (the bearer token all Hermes endpoints share)
# ---------------------------------------------------------------------------
ask_api_key() {
  info ""
  info "== Hermes API key =="
  say  "Hermes gates its HTTP API with one bearer key (API_SERVER_KEY)."
  say  "HermieOS sends this on every dispatch."
  if [ -n "${HERMIEOS_API_KEY:-}" ]; then
    HERMES_API_KEY="$HERMIEOS_API_KEY"
    info "API key provided via env (${#HERMES_API_KEY} chars)."
  else
    ask "Hermes API key (API_SERVER_KEY)" ""
    HERMES_API_KEY="$REPLY"
    [ -z "$HERMES_API_KEY" ] && warn "Empty API key — set HERMES_API_KEY in .env before going live."
  fi
}

# ---------------------------------------------------------------------------
# Where should the HermieOS MCP server run?
# ---------------------------------------------------------------------------
ask_mcp_mode() {
  info ""
  info "== HermieOS MCP server =="
  say  "Hermes talks to HermieOS through an MCP server. It can run:"
  say  "  host   — as a process on this machine (Hermes in Docker reaches"
  say  "           it via host.docker.internal:3002)"
  say  "  docker — in its own container on the same Docker network as"
  say  "           Hermes (resolved by container name, e.g. hermieos-mcp:3002)"
  say  ""
  ask "Where should the MCP server run? (host/docker)" "$MCP_MODE_DEFAULT"
  MCP_MODE="$REPLY"

  case "$MCP_MODE" in
    host)
      MCP_PUBLIC_URL="http://127.0.0.1:3002/mcp"
      if [ -n "${HERMES_MCP_URL:-}" ]; then
        : # explicit override
      elif [ "$HERMES_LOCATION" = "local" ]; then
        # Systemwide Hermes on this machine reaches the MCP server
        # directly on loopback — no Docker gateway alias needed.
        HERMES_MCP_URL="http://127.0.0.1:3002/mcp"
      else
        # Hermes in a container reaches the host through Docker's
        # host-gateway alias.
        HERMES_MCP_URL="http://host.docker.internal:3002/mcp"
      fi
      ;;
    docker)
      ask "MCP container name (on Hermes's Docker network)" "hermieos-mcp"
      HERMES_MCP_CONTAINER_NAME="$REPLY"
      MCP_PUBLIC_URL="http://${HERMES_MCP_CONTAINER_NAME}:3002/mcp"
      HERMES_MCP_URL="${HERMES_MCP_URL:-http://${HERMES_MCP_CONTAINER_NAME}:3002/mcp}"
      ;;
    *)
      die "Pick host or docker."
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
ask_database() {
  info ""
  info "== Database =="
  say  "HermieOS needs PostgreSQL 17+."
  say  "  1) Docker (docker compose postgres — mapped to localhost:15432)"
  say  "  2) Existing local/remote Postgres"
  say  ""
  ask "Which Postgres? (1/2)" "1"
  local db_choice="$REPLY"
  case "$db_choice" in
    1)
      if [ "$DOCKER_AVAILABLE" = "0" ]; then
        die "docker not found — pick an existing Postgres instead."
      fi
      DB_CHOICE="docker"
      DATABASE_URL="postgres://hermieos:hermieos@localhost:15432/hermieos"
      say "  → ${DATABASE_URL}"
      ;;
    2)
      DB_CHOICE="existing"
      local pg_host pg_port pg_user pg_pass pg_db
      ask "Postgres host" "127.0.0.1"
      pg_host="$REPLY"
      ask "Postgres port" "5432"
      pg_port="$REPLY"
      ask "Postgres user" "hermieos"
      pg_user="$REPLY"
      ask "Postgres password" ""
      pg_pass="$REPLY"
      ask "Database name" "hermieos"
      pg_db="$REPLY"
      DATABASE_URL="postgres://${pg_user}:${pg_pass}@${pg_host}:${pg_port}/${pg_db}"
      ;;
    *)
      die "Pick 1 or 2."
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Hermes profile (for the MCP wiring + scheduler identity)
# ---------------------------------------------------------------------------
ask_profile() {
  info ""
  info "== Hermes profile =="
  say  "The HermieOS MCP token and scheduler attach to ONE Hermes user."
  if [ -n "${HERMIEOS_USER_EMAIL:-}" ]; then
    HERMES_USER_EMAIL="$HERMIEOS_USER_EMAIL"
    info "User email provided via env: ${HERMES_USER_EMAIL}"
  else
    ask "Your HermieOS account email (used by profile-gen)" ""
    HERMES_USER_EMAIL="$REPLY"
  fi
  ask "Hermes profile name" "default"
  HERMES_PROFILE_NAME="$REPLY"
}

# ---------------------------------------------------------------------------
# Hermes dashboard — hosts the TUI gateway (steer / interrupt / approvals)
# ---------------------------------------------------------------------------
ask_dashboard() {
  info ""
  info "== Hermes dashboard (TUI gateway) =="
  say  "HermieOS uses the dashboard's /api/ws WebSocket for real mid-run"
  say  "steering, interrupts, and dangerous-command approvals."

  case "$HERMES_LOCATION" in
    local)
      HERMES_DASHBOARD_URL="${HERMES_DASHBOARD_URL:-http://127.0.0.1:9119}"
      HERMES_DASHBOARD_PUBLIC_URL="${HERMES_DASHBOARD_PUBLIC_URL:-$HERMES_DASHBOARD_URL}"
      ;;
    docker)
      HERMES_DASHBOARD_URL="${HERMES_DASHBOARD_URL:-http://hermes:9119}"
      # The desktop/web client dials the published port, not the compose
      # hostname.
      HERMES_DASHBOARD_PUBLIC_URL="${HERMES_DASHBOARD_PUBLIC_URL:-http://localhost:9119}"
      ;;
    remote)
      if [ -z "${HERMES_DASHBOARD_URL:-}" ]; then
        ask "Dashboard URL on the remote box (e.g. https://hermes.example.com:9119)" ""
        HERMES_DASHBOARD_URL="$REPLY"
      fi
      if [ -z "${HERMES_DASHBOARD_PUBLIC_URL:-}" ]; then
        ask "Dashboard URL as seen from THIS machine (e.g. https://hermes.example.com:9119)" "$HERMES_DASHBOARD_URL"
        HERMES_DASHBOARD_PUBLIC_URL="$REPLY"
      fi
      ;;
  esac
  HERMES_DASHBOARD_USERNAME="${HERMES_DASHBOARD_USERNAME:-hermieos}"
  if [ -z "${HERMES_DASHBOARD_PASSWORD:-}" ]; then
    if command -v openssl >/dev/null 2>&1; then
      HERMES_DASHBOARD_PASSWORD="$(openssl rand -hex 16)"
    else
      HERMES_DASHBOARD_PASSWORD="hermieos-$(date +%s)-$$"
    fi
    info "Generated dashboard password: ${HERMES_DASHBOARD_PASSWORD}"
  fi
}

# ---------------------------------------------------------------------------
# .env writing (preserves existing keys, upserts the ones we manage)
# ---------------------------------------------------------------------------
write_env() {
  info ""
  info "== Writing $ENV_FILE =="

  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ROOT_DIR/.env.example" ]; then
      cp "$ROOT_DIR/.env.example" "$ENV_FILE"
      ok "created from .env.example"
    else
      : > "$ENV_FILE"
      warn "no .env.example found — starting from an empty file"
    fi
  else
    ok "existing file will be preserved (managed keys updated)"
  fi

  upsert() {
    local key="$1" value="$2"
    # escape for sed replacement (value may contain / : etc.)
    local escaped
    escaped="$(printf '%s' "$value" | sed 's/[&/\]/\\&/g')"
    if grep -qE "^${key}=" "$ENV_FILE"; then
      sed -i.bak -E "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    else
      printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
    fi
  }

  upsert "HERMES_GATEWAY_URL" "$GATEWAY_URL"
  upsert "HERMES_LOCATION" "$HERMES_LOCATION"
  upsert "HERMES_API_KEY" "$HERMES_API_KEY"
  upsert "DATABASE_URL" "$DATABASE_URL"
  upsert "HERMIEOS_MCP_MODE" "$MCP_MODE"
  upsert "MCP_PUBLIC_URL" "$MCP_PUBLIC_URL"
  upsert "HERMES_MCP_URL" "$HERMES_MCP_URL"
  if [ -n "${HERMES_MCP_CONTAINER_NAME:-}" ]; then
    upsert "HERMES_MCP_CONTAINER_NAME" "$HERMES_MCP_CONTAINER_NAME"
  fi
  if [ -n "${HERMES_CONTAINER_NAME:-}" ]; then
    upsert "HERMES_CONTAINER_NAME" "$HERMES_CONTAINER_NAME"
  fi
  upsert "HERMES_HOME" "$HERMES_HOME"
  upsert "HERMES_USER_EMAIL" "$HERMES_USER_EMAIL"
  upsert "HERMES_PROFILE_NAME" "$HERMES_PROFILE_NAME"
  upsert "HERMES_DASHBOARD_URL" "$HERMES_DASHBOARD_URL"
  upsert "HERMES_DASHBOARD_PUBLIC_URL" "$HERMES_DASHBOARD_PUBLIC_URL"
  upsert "HERMES_DASHBOARD_USERNAME" "$HERMES_DASHBOARD_USERNAME"
  upsert "HERMES_DASHBOARD_PASSWORD" "$HERMES_DASHBOARD_PASSWORD"

  ok "$ENV_FILE updated"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  info ""
  info "== Configuration summary =="
  say  ""
  printf '  %-28s %s\n' "Hermes gateway:" "$GATEWAY_URL"
  printf '  %-28s %s\n' "Hermes API key:" "${HERMES_API_KEY:+****${HERMES_API_KEY: -4}}"
  printf '  %-28s %s\n' "Database:" "$DATABASE_URL"
  printf '  %-28s %s\n' "MCP mode:" "$MCP_MODE"
  printf '  %-28s %s\n' "MCP public URL:" "$MCP_PUBLIC_URL"
  printf '  %-28s %s\n' "Hermes→MCP URL:" "$HERMES_MCP_URL"
  printf '  %-28s %s\n' "Hermes user email:" "$HERMES_USER_EMAIL"
  printf '  %-28s %s\n' "Hermes profile:" "$HERMES_PROFILE_NAME"
  say  ""
}

# ---------------------------------------------------------------------------
# Install steps: deps -> postgres -> schema -> MCP wiring -> skills
# ---------------------------------------------------------------------------
install() {
  # The .env we just wrote IS the runtime config — export it so every
  # step below (migrate, register, skills-deploy) sees the same values.
  set -a
  [ -f "$ENV_FILE" ] && . "$ENV_FILE"
  set +a

  info ""
  info "== Installing dependencies =="
  ( cd "$ROOT_DIR" && pnpm install ) || die "pnpm install failed."

  # If the docker-compose Postgres was chosen, make sure it's up first.
  if [ "$DB_CHOICE" = "docker" ]; then
    info ""
    info "== Bringing up Postgres (docker compose) =="
    ( cd "$ROOT_DIR" && docker compose up -d postgres ) || die "docker compose up postgres failed."
  fi

  info ""
  info "== Applying database schema =="
  ( cd "$ROOT_DIR" && pnpm db:migrate ) || die "db:migrate failed. Check DATABASE_URL."
}

# Wires Hermes to HermieOS WITHOUT touching its config.yaml ourselves.
# Registration goes through Hermes's own CLI (`hermes mcp add`), which
# writes its config + stores the token in its own ~/.env. Then skills
# are deployed and the tools are reloaded.
wire_hermes() {
  info ""
  info "== Wiring Hermes to HermieOS (MCP server + skills) =="
  say  "Registration uses the Hermes CLI ('hermes mcp add') — Hermes"
  say  "owns its own config, we never edit it directly."

  if [ "$ASSUME_YES" = "1" ]; then
    local do_wire="y"
  else
    ask "Wire Hermes now? (y/n)" "y"
    local do_wire="$REPLY"
  fi
  case "$do_wire" in
    y|Y|yes|YES)
      # How to invoke the Hermes CLI from here.
      local cli_cmd
      case "$HERMES_LOCATION" in
        local)  cli_cmd="hermes" ;;
        docker) cli_cmd="docker exec -i ${HERMES_CONTAINER_NAME:-hermes} hermes" ;;
        remote) cli_cmd="" ;;  # must run on the remote box
      esac

      if [ -n "$cli_cmd" ]; then
        say "  registering via: ${cli_cmd} mcp add hermieos --url ${HERMES_MCP_URL}"
        ( cd "$ROOT_DIR" && \
          HERMES_USER_EMAIL="$HERMES_USER_EMAIL" \
          HERMES_MCP_URL="$HERMES_MCP_URL" \
          HERMES_CLI_CMD="$cli_cmd" \
          pnpm hermes:mcp-register ) || warn "registration failed — fix the URL/token and re-run: pnpm hermes:mcp-register"
      else
        warn "Remote Hermes — register from the remote box:"
        say  "       pnpm hermes:mcp-register   (with HERMES_USER_EMAIL, HERMES_MCP_URL set)"
      fi

      ( cd "$ROOT_DIR" && HERMES_HOME="$HERMES_HOME" pnpm hermes:skills-deploy ) || warn "skills-deploy failed."

      # Dangerous-command approvals: default to MANUAL so the user always
      # decides (the smart judge auto-approves low-risk commands otherwise).
      if [ "$ASSUME_YES" = "1" ]; then
        local do_manual="y"
      else
        ask "Force manual approval for dangerous commands? (y/n — recommended)" "y"
        local do_manual="$REPLY"
      fi
      case "$do_manual" in
        y|Y|yes|YES)
          case "$HERMES_LOCATION" in
            local)
              if ! grep -q '^approvals:' "$HERMES_HOME/config.yaml" 2>/dev/null; then
                printf '\napprovals:\n  mode: manual\n  timeout: 300\n' >> "$HERMES_HOME/config.yaml" \
                  && ok "manual approval mode set in $HERMES_HOME/config.yaml"
              else
                ok "approvals block already present — leaving it untouched"
              fi
              ;;
            docker)
              docker exec "${HERMES_CONTAINER_NAME:-hermes}" sh -c \
                "grep -q '^approvals:' /opt/data/config.yaml || printf '\\napprovals:\\n  mode: manual\\n  timeout: 300\\n' >> /opt/data/config.yaml" \
                && ok "manual approval mode set in the hermes container config"
              ;;
            remote)
              say "  On the remote box, add to Hermes config.yaml:"
              say "    approvals:"
              say "      mode: manual"
              say "      timeout: 300"
              ;;
          esac
          ;;
        *)
          warn "Approval mode left as-is (Hermes may smart-approve dangerous commands)."
          ;;
      esac

      local reload_cmd verify_cmd
      case "$HERMES_LOCATION" in
        local)
          reload_cmd="hermes /reload-mcp"
          verify_cmd="hermes mcp test hermieos"
          ;;
        docker)
          # Inside a Hermes container /reload-mcp tries to talk to the
          # Docker daemon and fails — restarting the container is the
          # reliable way to re-read config there.
          reload_cmd="docker restart ${HERMES_CONTAINER_NAME:-hermes}"
          verify_cmd="docker exec ${HERMES_CONTAINER_NAME:-hermes} hermes mcp test hermieos"
          ;;
        remote)
          reload_cmd="(on the remote box) hermes /reload-mcp"
          verify_cmd="(on the remote box) hermes mcp test hermieos"
          ;;
      esac
      say "  reload tools with: ${reload_cmd}"
      if [ "$HERMES_LOCATION" = "local" ] && command -v hermes >/dev/null 2>&1; then
        eval "$(printf '%s' "${reload_cmd#\(on the remote box\) }")" >/dev/null 2>&1 && ok "Hermes tools reloaded" || warn "run '${reload_cmd}' to load the new tools"
      fi
      ok "Hermes wired. Verify with: ${verify_cmd}"
      ;;
    *)
      warn "Skipping wiring. Run later: pnpm hermes:mcp-register && pnpm hermes:skills-deploy"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  info ""
  info "== Configuration summary =="
  say  ""
  printf '  %-28s %s\n' "Hermes location:" "$HERMES_LOCATION"
  printf '  %-28s %s\n' "Hermes gateway:" "$GATEWAY_URL"
  printf '  %-28s %s\n' "Hermes API key:" "${HERMES_API_KEY:+****${HERMES_API_KEY: -4}}"
  printf '  %-28s %s\n' "Hermes data root:" "$HERMES_HOME"
  printf '  %-28s %s\n' "Database:" "$DATABASE_URL"
  printf '  %-28s %s\n' "MCP mode:" "$MCP_MODE"
  printf '  %-28s %s\n' "MCP public URL:" "$MCP_PUBLIC_URL"
  printf '  %-28s %s\n' "Hermes→MCP URL:" "$HERMES_MCP_URL"
  printf '  %-28s %s\n' "Hermes user email:" "$HERMES_USER_EMAIL"
  printf '  %-28s %s\n' "Hermes profile:" "$HERMES_PROFILE_NAME"
  printf '  %-28s %s\n' "Dashboard (TUI gateway):" "$HERMES_DASHBOARD_URL"
  say  ""
}

# ---------------------------------------------------------------------------
# Next steps — verification commands depend on where Hermes lives
# ---------------------------------------------------------------------------
next_steps() {
  info ""
  info "== Next steps =="
  say  "  1. Start the services:"
  say  "       pnpm dev:api        # REST + SSE at http://127.0.0.1:3001"
  say  "       pnpm dev:mcp        # MCP server Hermes talks to (port 3002)"
  say  "       pnpm dev:scheduler  # background loop that dispatches runs"
  say  "       pnpm dev:web        # the HermieOS client at http://127.0.0.1:5173"
  say  ""
  say  "  2. Verify Hermes sees HermieOS:"
  case "$HERMES_LOCATION" in
    local)
      say  "       hermes mcp list           # should show 'hermieos   enabled'"
      say  "       hermes mcp test hermieos  # should report tools found"
      say  "       hermes /reload-mcp        # pick up config without restarting"
      ;;
    docker)
      local box="${HERMES_CONTAINER_NAME:-<hermes-container>}"
      say  "       docker restart ${box}"
      say  "       docker exec ${box} hermes mcp list"
      say  "       docker exec ${box} hermes mcp test hermieos"
      ;;
    remote)
      say  "       On the remote box, run:"
      say  "         hermes mcp list"
      say  "         hermes mcp test hermieos"
      say  "         hermes /reload-mcp"
      ;;
  esac
  say  ""
  say  "  3. If you skipped wiring, run it now:"
  say  "       pnpm hermes:mcp-register   # registers via 'hermes mcp add' (no config edits)"
  say  "       pnpm hermes:skills-deploy  # installs the hermieos skills"
  say  ""
  say  "  4. Rotate/copy the MCP token if needed: Settings → MCP token,"
  say  "     then re-run 'pnpm hermes:mcp-register' to update Hermes."
  ok "HermieOS is configured. Welcome aboard."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  say  ""
  say  "${BOLD}HERMIEOS — ATTACH TO YOUR HERMES AGENT${RESET}"
  say  "===================================================================="
  say  "HermieOS is a shell around the Hermes Agent you already run —"
  say  "systemwide, in Docker, or on a remote box. Your Hermes install"
  say  "is untouched; we only write our own MCP block into its config."
  say  "===================================================================="

  check_prereqs
  ask_hermes_location
  ask_hermes_home
  ask_api_key
  ask_mcp_mode
  ask_database
  ask_profile
  ask_dashboard
  write_env
  print_summary

  if [ "$DRY_RUN" = "1" ]; then
    warn "DRY RUN — skipping install, schema migration, and Hermes wiring."
    next_steps
    exit 0
  fi

  install
  wire_hermes
  next_steps
}

main "$@"
