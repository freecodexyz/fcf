#!/bin/sh
set -eu

REPO="${REPO:-freecodexyz/fcf}"
REF="${REF:-main}"
SKILL_NAME="${SKILL_NAME:-rik-mint}"
SKILL_PATH="${SKILL_PATH:-skills/${SKILL_NAME}}"
REQUESTED_AGENT="${FCF_SKILL_AGENT:-${AGENT:-auto}}"
case "$REQUESTED_AGENT" in
auto|claude|codex)
	AGENT="$REQUESTED_AGENT"
	;;
*)
	AGENT="auto"
	;;
esac

download() {
	url="$1"
	out="$2"

	if command -v curl >/dev/null 2>&1; then
		curl -fsSL "$url" -o "$out"
		return
	fi

	if command -v wget >/dev/null 2>&1; then
		wget -q "$url" -O "$out"
		return
	fi

	echo "Error: curl or wget is required" >&2
	exit 1
}

resolve_skills_dir() {
	case "$AGENT" in
	claude)
		printf '%s\n' "${SKILLS_DIR:-${CLAUDE_CODE_SKILLS_DIR:-$HOME/.claude/skills}}"
		;;
	codex)
		if [ -n "${SKILLS_DIR:-}" ]; then
			printf '%s\n' "$SKILLS_DIR"
			return
		fi
		if [ -n "${CODEX_HOME:-}" ]; then
			printf '%s\n' "$CODEX_HOME/skills"
			return
		fi
		printf '%s\n' "$HOME/.codex/skills"
		;;
	auto)
		if [ -n "${SKILLS_DIR:-}" ]; then
			printf '%s\n' "$SKILLS_DIR"
			return
		fi
		if [ -n "${CLAUDE_CODE_SKILLS_DIR:-}" ]; then
			printf '%s\n' "$CLAUDE_CODE_SKILLS_DIR"
			return
		fi
		if [ -n "${CODEX_HOME:-}" ]; then
			printf '%s\n' "$CODEX_HOME/skills"
			return
		fi
		if [ -d "$HOME/.claude" ]; then
			printf '%s\n' "$HOME/.claude/skills"
			return
		fi
		if [ -d "$HOME/.codex" ]; then
			printf '%s\n' "$HOME/.codex/skills"
			return
		fi
		printf '%s\n' "$HOME/.claude/skills"
		;;
	*)
		echo "Error: AGENT must be one of: auto, claude, codex" >&2
		exit 1
		;;
	esac
}

SKILLS_DIR="$(resolve_skills_dir)"

copy_skill() {
	src="$1"
	dst="${SKILLS_DIR%/}/${SKILL_NAME}"

	mkdir -p "$SKILLS_DIR"
	rm -rf "$dst"
	cp -R "$src" "$dst"
	printf 'Installed %s skill to %s\n' "$SKILL_NAME" "$dst"
}

if [ -n "${SOURCE_DIR:-}" ]; then
	src="${SOURCE_DIR%/}/${SKILL_PATH}"
	if [ ! -d "$src" ]; then
		echo "Error: skill directory not found at $src" >&2
		exit 1
	fi
	copy_skill "$src"
	exit 0
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT INT TERM

archive="$tmpdir/repo.tar.gz"
url="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"
download "$url" "$archive"
tar -xzf "$archive" -C "$tmpdir"

root_dir=""
for entry in "$tmpdir"/*; do
	if [ -d "$entry" ]; then
		root_dir="$entry"
		break
	fi
done

if [ -z "$root_dir" ]; then
	echo "Error: could not extract repository archive" >&2
	exit 1
fi

src="${root_dir}/${SKILL_PATH}"
if [ ! -d "$src" ]; then
	echo "Error: skill directory not found in downloaded archive: $src" >&2
	exit 1
fi

copy_skill "$src"
