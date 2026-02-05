#!/usr/bin/env bun

import prompts from "prompts";
import matter from "gray-matter";
import { homedir } from "os";
import { join, resolve, dirname, basename } from "path";
import { readFileSync, existsSync, readdirSync, statSync, realpathSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { spawn } from "child_process";

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedArgs {
  help: boolean;
  clearRecent: boolean;
  list: boolean;
  dangerousMode: boolean;
  claudeArgs: string[];
}

// Check for dangerous mode via environment variable (set by spx.ts entry point)
const DANGEROUS_MODE = process.env.SKILLS_PRIMER_DANGEROUS === "1";

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // Skip node/bun and script path

  const result: ParsedArgs = {
    help: false,
    clearRecent: false,
    list: false,
    dangerousMode: DANGEROUS_MODE,
    claudeArgs: [],
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Everything after -- goes to claude
    if (arg === "--") {
      result.claudeArgs.push(...args.slice(i + 1));
      break;
    }

    // skills-loader specific flags
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      i++;
    } else if (arg === "--clear-recent") {
      result.clearRecent = true;
      i++;
    } else if (arg === "--list" || arg === "-l") {
      result.list = true;
      i++;
    } else {
      // Pass unrecognized args to claude
      result.claudeArgs.push(arg);
      i++;
    }
  }

  return result;
}

function showHelp(dangerousMode: boolean): void {
  const cmd = dangerousMode ? "spx" : "sp";
  const dangerousNote = dangerousMode
    ? "\n⚠️  DANGEROUS MODE: --dangerously-skip-permissions is auto-enabled\n"
    : "";

  console.log(`
skills-primer (${cmd}) - Prime your Claude sessions with preloaded skills
${dangerousNote}
USAGE:
  sp [options] [-- claude-options]       Standard mode
  spx [options] [-- claude-options]      Dangerous mode (skips permissions)

OPTIONS:
  -h, --help        Show this help message
  -l, --list        List available skills and exit
  --clear-recent    Clear the recent skills cache

CLAUDE OPTIONS:
  All other options are passed directly to Claude. Use -- to explicitly
  separate skills-primer options from Claude options.

EXAMPLES:
  sp                          Interactive skill selection
  sp --list                   List all available skills
  sp -- --model opus          Use Opus model
  sp -- -p "prompt"           Run with a prompt (non-interactive)
  spx                         Skip all permission prompts

SKILL LOCATIONS:
  Global: ~/.claude/skills/
  Local:  ./.claude/skills/
`);
}

interface Skill {
  name: string;
  description: string;
  path: string;
  source: "global" | "local";
}

interface SkillContent {
  skill: Skill;
  mainContent: string;
  references: Array<{ name: string; content: string }>;
}

interface RecentCache {
  // Map of skill key (source:name) to last used timestamp
  recent: Record<string, number>;
}

const GLOBAL_SKILLS_DIR = join(homedir(), ".claude", "skills");
const LOCAL_SKILLS_DIR = join(process.cwd(), ".claude", "skills");
const CACHE_DIR = join(homedir(), ".cache", "skills-primer");
const CACHE_FILE = join(CACHE_DIR, "recent.json");
const MAX_RECENT = 10; // Keep track of last 10 used skills

function getSkillKey(skill: Skill): string {
  return `${skill.source}:${skill.name}`;
}

function loadRecentCache(): RecentCache {
  try {
    if (existsSync(CACHE_FILE)) {
      const data = readFileSync(CACHE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors, return empty cache
  }
  return { recent: {} };
}

function saveRecentCache(cache: RecentCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch {
    // Ignore errors
  }
}

function updateRecentCache(skills: Skill[]): void {
  const cache = loadRecentCache();
  const now = Date.now();

  // Add/update selected skills
  for (const skill of skills) {
    cache.recent[getSkillKey(skill)] = now;
  }

  // Prune to keep only MAX_RECENT most recent
  const entries = Object.entries(cache.recent);
  if (entries.length > MAX_RECENT) {
    entries.sort((a, b) => b[1] - a[1]); // Sort by timestamp desc
    cache.recent = Object.fromEntries(entries.slice(0, MAX_RECENT));
  }

  saveRecentCache(cache);
}

function sortSkillsByRecent(skills: Skill[], cache: RecentCache): Skill[] {
  return [...skills].sort((a, b) => {
    const aTime = cache.recent[getSkillKey(a)] || 0;
    const bTime = cache.recent[getSkillKey(b)] || 0;
    // Sort by most recent first, then alphabetically
    if (aTime !== bTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}

async function findSkillFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const skillPaths: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    // Handle symlinks by resolving them
    let realPath = fullPath;
    if (entry.isSymbolicLink()) {
      try {
        realPath = realpathSync(fullPath);
      } catch {
        continue;
      }
    }

    // Check if it's a directory containing SKILL.md
    const stat = statSync(realPath, { throwIfNoEntry: false });
    if (stat?.isDirectory()) {
      const skillFile = join(realPath, "SKILL.md");
      if (existsSync(skillFile)) {
        skillPaths.push(skillFile);
      }
    }
    // Check if it's a direct SKILL.md file
    else if (entry.name === "SKILL.md") {
      skillPaths.push(fullPath);
    }
  }

  return skillPaths;
}

async function parseSkill(
  skillPath: string,
  source: "global" | "local"
): Promise<Skill | null> {
  try {
    const content = readFileSync(skillPath, "utf-8");
    const { data } = matter(content);

    // Derive name from directory if not in frontmatter
    const skillDir = dirname(skillPath);
    const name = data.name || basename(skillDir);
    const description = data.description || "No description provided";

    return {
      name,
      description,
      path: skillPath,
      source,
    };
  } catch (error) {
    console.error(`Failed to parse skill at ${skillPath}:`, error);
    return null;
  }
}

function readSkillContent(skill: Skill): SkillContent {
  const mainContent = readFileSync(skill.path, "utf-8");
  const skillDir = dirname(skill.path);
  const referencesDir = join(skillDir, "references");

  const references: Array<{ name: string; content: string }> = [];

  if (existsSync(referencesDir)) {
    const refFiles = readdirSync(referencesDir);
    for (const refFile of refFiles) {
      const refPath = join(referencesDir, refFile);
      const stat = statSync(refPath, { throwIfNoEntry: false });
      if (stat?.isFile()) {
        try {
          const content = readFileSync(refPath, "utf-8");
          references.push({ name: refFile, content });
        } catch {
          // Skip files that can't be read
        }
      }
    }
  }

  return { skill, mainContent, references };
}

function buildSystemPrompt(skills: SkillContent[]): string {
  const header = `The user preloaded the following skills knowing that they would be required for the task they're about to start. These skills contain specialized knowledge, patterns, and best practices that you MUST follow when relevant to the user's request.

---
PRELOADED SKILLS
---

`;

  const skillsText = skills
    .map((s) => {
      let text = `## Skill: ${s.skill.name} (${s.skill.source})

${s.mainContent}`;

      if (s.references.length > 0) {
        text += `

### References for ${s.skill.name}

`;
        for (const ref of s.references) {
          text += `#### ${ref.name}

${ref.content}

`;
        }
      }

      return text;
    })
    .join("\n---\n\n");

  return header + skillsText;
}

async function main() {
  const args = parseArgs(process.argv);

  // Handle --help
  if (args.help) {
    showHelp(args.dangerousMode);
    process.exit(0);
  }

  // Show warning banner for dangerous mode
  if (args.dangerousMode) {
    console.log("⚠️  DANGEROUS MODE: Permission checks will be skipped\n");
  }

  // Handle --clear-recent
  if (args.clearRecent) {
    try {
      if (existsSync(CACHE_FILE)) {
        unlinkSync(CACHE_FILE);
        console.log("✓ Recent skills cache cleared");
      } else {
        console.log("No recent skills cache to clear");
      }
    } catch (error) {
      console.error("Failed to clear cache:", error);
    }
    process.exit(0);
  }

  console.log("🔍 Scanning for skills...\n");

  // Find all skills
  const globalSkillPaths = await findSkillFiles(GLOBAL_SKILLS_DIR);
  const localSkillPaths = await findSkillFiles(LOCAL_SKILLS_DIR);

  const skills: Skill[] = [];

  for (const path of globalSkillPaths) {
    const skill = await parseSkill(path, "global");
    if (skill) skills.push(skill);
  }

  for (const path of localSkillPaths) {
    const skill = await parseSkill(path, "local");
    if (skill) skills.push(skill);
  }

  if (skills.length === 0) {
    console.log("No skills found in:");
    console.log(`  - ${GLOBAL_SKILLS_DIR}`);
    console.log(`  - ${LOCAL_SKILLS_DIR}`);
    process.exit(1);
  }

  // Handle --list
  if (args.list) {
    const cache = loadRecentCache();
    const recentKeys = new Set(Object.keys(cache.recent));
    const sortedSkills = sortSkillsByRecent(skills, cache);

    console.log(`Found ${skills.length} skill(s):\n`);
    for (const skill of sortedSkills) {
      const isRecent = recentKeys.has(getSkillKey(skill));
      const prefix = isRecent ? "⏱" : " ";
      console.log(`${prefix} [${skill.source}] ${skill.name}`);
      console.log(`    ${skill.description.slice(0, 70)}${skill.description.length > 70 ? "..." : ""}`);
    }
    process.exit(0);
  }

  console.log(`Found ${skills.length} skill(s)\n`);

  // Load recent cache and sort skills
  const cache = loadRecentCache();
  const recentKeys = new Set(Object.keys(cache.recent));
  const sortedSkills = sortSkillsByRecent(skills, cache);

  // Build choices for the prompt, marking recent skills
  const choices = sortedSkills.map((skill) => {
    const isRecent = recentKeys.has(getSkillKey(skill));
    return {
      title: isRecent
        ? `⏱ [${skill.source}] ${skill.name}`
        : `  [${skill.source}] ${skill.name}`,
      description: skill.description,
      value: skill,
    };
  });

  // Let user select skills with autocomplete filtering
  const response = await prompts({
    type: "autocompleteMultiselect",
    name: "selectedSkills",
    message: "Select skills to preload (type to filter)",
    choices,
    instructions: false,
    hint: "- Space to select. Return to submit",
    suggest: async (input: string, choices: typeof skills extends (infer T)[] ? { title: string; description: string; value: T }[] : never[]) => {
      const searchTerm = input.toLowerCase();
      if (!searchTerm) return choices;
      return choices.filter(
        (choice) =>
          choice.title.toLowerCase().includes(searchTerm) ||
          choice.description.toLowerCase().includes(searchTerm)
      );
    },
  });

  const selectedSkills: Skill[] = response.selectedSkills || [];

  if (selectedSkills.length === 0) {
    console.log("\nNo skills selected. Launching Claude without preloaded skills...\n");
    const baseArgs = args.dangerousMode ? ["--dangerously-skip-permissions"] : [];
    const claude = spawn("claude", [...baseArgs, ...args.claudeArgs], {
      stdio: "inherit",
    });
    claude.on("exit", (code) => process.exit(code || 0));
    return;
  }

  // Update recent cache with selected skills
  updateRecentCache(selectedSkills);

  console.log(`\n📚 Loading ${selectedSkills.length} skill(s)...`);

  // Read all skill content
  const skillContents = selectedSkills.map(readSkillContent);

  // Build the system prompt
  const systemPrompt = buildSystemPrompt(skillContents);

  // Calculate approximate token count (rough estimate: 4 chars per token)
  const estimatedTokens = Math.ceil(systemPrompt.length / 4);
  console.log(`📊 Estimated context size: ~${estimatedTokens.toLocaleString()} tokens\n`);

  // Build claude command args
  const dangerousArgs = args.dangerousMode ? ["--dangerously-skip-permissions"] : [];
  const claudeArgs = [...dangerousArgs, "--append-system-prompt", systemPrompt, ...args.claudeArgs];

  console.log("🚀 Launching Claude with preloaded skills...\n");
  console.log("─".repeat(50));
  console.log("Loaded skills:");
  for (const s of selectedSkills) {
    console.log(`  • ${s.name} (${s.source})`);
  }
  console.log("─".repeat(50) + "\n");

  // Launch claude
  const claude = spawn("claude", claudeArgs, {
    stdio: "inherit",
  });

  claude.on("exit", (code) => {
    process.exit(code || 0);
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
