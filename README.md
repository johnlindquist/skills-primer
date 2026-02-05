# skills-primer

Prime your Claude Code sessions with preloaded skills.

## Installation

```bash
# With bun (recommended)
bun install -g skills-primer

# With npm
npm install -g skills-primer
```

> **Note:** Requires [Bun](https://bun.sh) runtime and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)

## Quick Start

```bash
# Launch interactive skill selector
sp

# List available skills
sp --list

# Skip permission prompts (dangerous mode)
spx
```

## Usage

```bash
sp                    # Standard mode
spx                   # Dangerous mode (skips permission prompts)
skills-primer         # Full command name
```

### What happens when you run `sp`:

1. Scans `~/.claude/skills/` (global) and `./.claude/skills/` (local)
2. Shows interactive selector with **autocomplete filtering** (type to search)
3. Recently used skills appear first with ⏱ icon
4. Launches Claude with selected skills injected via `--append-system-prompt`

## Examples

```bash
# Basic usage - select skills interactively
sp

# Use with Opus model
sp -- --model opus

# Non-interactive prompt with skills
sp -- -p "refactor this function"

# Continue previous conversation with skills
sp -- -c

# Dangerous mode (no permission prompts) + Opus
spx -- --model opus

# List all available skills
sp --list

# Clear recently used skills cache
sp --clear-recent
```

## Commands

| Command | Description |
|---------|-------------|
| `sp` | Standard mode - prompts for permissions |
| `spx` | Dangerous mode - auto-passes `--dangerously-skip-permissions` |
| `skills-primer` | Full command (same as `sp`) |

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
sp -- --model sonnet         # Use Sonnet model
sp -- -p "prompt"            # Non-interactive prompt mode
sp -- -c                     # Continue previous conversation
sp -- --help                 # Show Claude's help
```

## Creating Skills

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```
~/.claude/skills/
└── my-skill/
    ├── SKILL.md           # Required: main skill file
    └── references/        # Optional: additional context
        ├── patterns.md
        └── examples.md
```

### SKILL.md Format

```markdown
---
name: my-skill
description: Brief description shown in the selector
---

# My Skill

Instructions, patterns, and best practices for Claude to follow.

## Guidelines

- Guideline 1
- Guideline 2

## Examples

...
```

## Skill Locations

| Location | Scope | Use Case |
|----------|-------|----------|
| `~/.claude/skills/` | Global | Skills available in all projects |
| `./.claude/skills/` | Local | Project-specific skills |

Local skills take precedence if names conflict.

## How It Works

1. **Skill Discovery**: Scans both global and local skill directories
2. **Selection**: Interactive multi-select with fuzzy search
3. **Injection**: Selected skills are concatenated and passed to Claude via `--append-system-prompt`
4. **Context**: Claude receives instructions that these skills were deliberately preloaded and should be followed

## Cache

Recent selections are cached at `~/.cache/skills-primer/recent.json` to surface frequently used skills first.

```bash
# Clear the cache
sp --clear-recent
```

## License

MIT
