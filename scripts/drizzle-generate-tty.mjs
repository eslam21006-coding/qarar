#!/usr/bin/env node
// Wrapper around drizzle-kit generate that fakes a TTY so the
// interactive prompts (promptColumnsConflicts) work in non-TTY
// environments (PowerShell, CI, piped shells).
//
// We preload a tiny hook from `scripts/.tty-hook.cjs` that
// overrides `process.stdin.isTTY`, `process.stdout.isTTY`, and
// `process.stderr.isTTY` to `true`. Once those return true,
// drizzle-kit's `render10` will happily invoke the inquirer
// prompt. The prompt writes its question to stdout and reads the
// answer from stdin.
//
// We don't feed answers automatically; the operator must drive
// the prompt. For unattended runs (CI), pass `--auto-answer <text>`
// — the answer is forwarded to the prompt via stdin after a
// short delay so the prompt has time to render.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "..", "node_modules", "drizzle-kit", "bin.cjs");
const hook = resolve(here, ".tty-hook.cjs");

const args = process.argv.slice(2);
const env = { ...process.env };

// Optional auto-answer support for unattended CI runs.
const autoIdx = args.indexOf("--auto-answer");
if (autoIdx >= 0 && args[autoIdx + 1]) {
  env.DRIZZLE_GENERATE_AUTO = args[autoIdx + 1];
  args.splice(autoIdx, 2);
}

const child = spawn(
  process.execPath,
  ["--require", hook, cli, ...args],
  { stdio: ["pipe", "inherit", "inherit"], env }
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("[drizzle-generate-tty] spawn failed:", err.message);
  process.exit(1);
});

// If an auto-answer is requested, write it to stdin after a short
// delay (so the prompt has time to render).
if (env.DRIZZLE_GENERATE_AUTO) {
  setTimeout(() => {
    try {
      child.stdin.write(env.DRIZZLE_GENERATE_AUTO + "\n");
    } catch (e) {
      // stdin may already be closed; ignore.
    }
  }, 1500);
}