#!/bin/bash
# CloudCLI does not load interactive shell functions. Match the terminal's
# default Claude provider, reading the existing private config without copying it.
set -e
provider_file="${CLOUDCLI_CLAUDE_PROVIDER_ENV:-}"
claude_binary="${CLOUDCLI_CLAUDE_BINARY:-claude}"
if [[ -z "$provider_file" ]]; then
  exec "$claude_binary" "$@"
fi
if [[ ! -r "$provider_file" ]]; then
  printf 'CloudCLI: Claude provider configuration is unavailable.\n' >&2
  exit 1
fi
unset ANTHROPIC_AUTH_TOKEN ANTHROPIC_API_KEY ANTHROPIC_BASE_URL
unset ANTHROPIC_MODEL ANTHROPIC_DEFAULT_MODEL
unset ANTHROPIC_DEFAULT_OPUS_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL
unset ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_FABLE_MODEL
unset CLAUDE_CODE_SUBAGENT_MODEL CLAUDE_CODE_AUTO_COMPACT_WINDOW
source "$provider_file"
if [[ -z "${ANTHROPIC_MODEL:-}" ]]; then
  printf 'CloudCLI: Claude provider configuration must specify ANTHROPIC_MODEL.\n' >&2
  exit 1
fi
# The SDK explicitly sends "default". Resolve that to the same model that
# the terminal function passes; leave explicit model selections untouched.
args=()
while (( $# )); do
  if [[ "$1" == '--model' && "${2:-}" == 'default' ]]; then
    args+=(--model "$ANTHROPIC_MODEL")
    shift 2
  elif [[ "$1" == '--model=default' ]]; then
    args+=("--model=$ANTHROPIC_MODEL")
    shift
  else
    args+=("$1")
    shift
  fi
done
exec "$claude_binary" "${args[@]}"
