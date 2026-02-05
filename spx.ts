#!/usr/bin/env bun

// Dangerous mode entry point - skips Claude permission prompts
process.env.SKILLS_PRIMER_DANGEROUS = "1";

await import("./index.ts");
