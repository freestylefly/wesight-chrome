// Writes the build number shown on the diagnostics page into .env.local,
// which Plasmo inlines as process.env.PLASMO_PUBLIC_*. Safe outside a git checkout.
import { execSync } from "node:child_process"
import { writeFileSync } from "node:fs"

let commit = "unknown"
try {
  commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()
  if (dirty) commit += "-dirty"
} catch { /* Not a git checkout (e.g. a source zip). */ }

writeFileSync(".env.local", `PLASMO_PUBLIC_BUILD_COMMIT=${commit}\nPLASMO_PUBLIC_BUILD_TIME=${new Date().toISOString()}\n`)
