import { recordDiagnostic, type DiagnosticLevel } from "~lib/diagnostics"

/** Legacy entry point kept for existing callers; entries land in the diagnostics store. */
export async function writeLog(level: DiagnosticLevel, scope: string, message: string): Promise<void> {
  await recordDiagnostic(level, level === "error" ? "error" : "log", scope, message)
}
