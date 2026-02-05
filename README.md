# skills-primer

Prime your Claude Code sessions with preloaded skills.

## Installation

```bash
bun install
bun link
```

## Usage

```bash
sp                    # Standard mode
spx                   # Dangerous mode (skips permission prompts)
skills-primer         # Full command
```

This will:
1. Scan for skills in `~/.claude/skills/` (global) and `./.claude/skills/` (local)
2. Present an interactive selector with autocomplete filtering
3. Launch Claude with selected skills injected via `--append-system-prompt`

Recently used skills appear at the top with a ⏱ icon.

## Commands

| Command | Description |
|---------|-------------|
| `sp` | Standard mode - prompts for permissions |
| `spx` | Dangerous mode - auto-passes `--dangerously-skip-permissions` |

## Options

```
-h, --help        Show help message
-l, --list        List available skills and exit
--clear-recent    Clear the recent skills cache
```

## Passing Options to Claude

Use `--` to separate skills-primer options from Claude options:

```bash
sp -- --model opus           # Use Opus model
sp -- -p "help me with x"    # Non-interactive prompt mode
sp -- -c                     # Continue previous conversation
spx -- --model opus          # Dangerous mode + Opus
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

Skills can include a `references/` subdirectory with additional context files.

## Skill Locations

| Location | Scope |
|----------|-------|
| `~/.claude/skills/` | Global (all projects) |
| `./.claude/skills/` | Local (current project) |

## How It Works

Selected skills and their references are read and passed to Claude via `--append-system-prompt` with context explaining that these skills were deliberately preloaded for the upcoming task. Claude is instructed to follow the patterns and practices defined in these skills.

## Cache

Recent selections are cached at `~/.cache/skills-primer/recent.json` to surface frequently used skills first. Clear with `sp --clear-recent`.
