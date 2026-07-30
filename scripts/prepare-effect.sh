#!/usr/bin/env sh

set -eu

repo_dir=".repos/effect"
repo_url="https://github.com/Effect-TS/effect"
effect_commit="cccd029ae0124a33254b4094f1bc9c06cd43324e"

mode="prepare"
case "${1:-}" in
  "")
    ;;
  --check)
    mode="check"
    ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

verify_checkout() {
  actual_commit="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"
  if [ "$actual_commit" != "$effect_commit" ]; then
    echo "Effect checkout is $actual_commit, expected $effect_commit" >&2
    exit 1
  fi
  echo "Effect checkout verified at $effect_commit"
}

if [ "$mode" = "check" ]; then
  if [ ! -d "$repo_dir" ]; then
    echo "Effect checkout is missing at $repo_dir; run bun run prepare" >&2
    exit 1
  fi
  verify_checkout
  exit 0
fi

if [ -e "$repo_dir" ]; then
  if ! git -C "$repo_dir" rev-parse --git-dir >/dev/null 2>&1; then
    echo "$repo_dir exists but is not a Git checkout" >&2
    exit 1
  fi
else
  mkdir -p ".repos"
  git clone "$repo_url" "$repo_dir"
fi

current_commit="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"
if [ "$current_commit" != "$effect_commit" ]; then
  git -C "$repo_dir" fetch --depth=1 origin "$effect_commit"
  git -C "$repo_dir" checkout --detach "$effect_commit"
fi

verify_checkout
