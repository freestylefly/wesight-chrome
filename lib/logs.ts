import { getLocal, setLocal, STORAGE_KEYS } from "~lib/storage"

export interface DiagnosticLog {
  at: string
  level: "info" | "warn" | "error"
  scope: string
  message: string
}

const MAX_LOGS = 100

function redact(message: string): string {
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/([?&#](?:token|secret|pair)=)[^&#\s]+/gi, "$1[redacted]")
    .slice(0, 500)
}

export async function writeLog(level: DiagnosticLog["level"], scope: string, message: string): Promise<void> {
  const logs = (await getLocal<DiagnosticLog[]>(STORAGE_KEYS.logs)) ?? []
  logs.push({ at: new Date().toISOString(), level, scope, message: redact(message) })
  await setLocal(STORAGE_KEYS.logs, logs.slice(-MAX_LOGS))
}
