# skills-loader

A CLI tool to preload Claude skills into your Claude Code sessions.

## Installation

```bash
bun install
bun link
```

## Usage

```bash
skills-loader
```

This will:
1. Scan for skills in `~/.claude/skills/` (global) and `./.claude/skills/` (local)
2. Present an interactive selector to choose which skills to preload
3. Launch Claude with the selected skills injected via `--append-system-prompt`

You can also pass additional Claude CLI arguments:

```bash
skills-loader --model opus
skills-loader -p "help me with this task"
```

## Skill Format

Skills are directories containing a `SKILL.md` file with frontmatter:

```markdown
---
name: my-skill
description: What this skill does
---

# Skill Content

Instructions, patterns, and knowledge for Claude to follow.
```

Skills can also have a `references/` subdirectory with additional files that will be included.

## How It Works

The tool reads all selected skills and their references, then passes them to Claude via `--append-system-prompt` with context explaining that these skills were deliberately preloaded by the user for the upcoming task.
