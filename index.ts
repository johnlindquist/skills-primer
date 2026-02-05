#!/usr/bin/env bun

import prompts from "prompts";
import matter from "gray-matter";
import { homedir } from "os";
import { join, resolve, dirname, basename } from "path";
import { readFileSync, existsSync, readdirSync, statSync, realpathSync, writeFileSync, mkdirSync } from "fs";
import { spawn } from "child_process";

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
const CACHE_DIR = join(homedir(), ".cache", "skills-loader");
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
    const claude = spawn("claude", process.argv.slice(2), {
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
  const claudeArgs = ["--append-system-prompt", systemPrompt, ...process.argv.slice(2)];

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
