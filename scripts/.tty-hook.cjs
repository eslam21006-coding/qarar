// Preload hook: force process.stdin/stdout/stderr to report isTTY=true
// so drizzle-kit's inquirer prompts work in non-TTY environments
// (PowerShell, CI, piped shells).
try {
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stdout, "isTTY", {
    value: true,
    configurable: true,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    value: true,
    configurable: true,
  });
} catch (e) {
  // best effort — the prompts will fail loudly if this can't run
}