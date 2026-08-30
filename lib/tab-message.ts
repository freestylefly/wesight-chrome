export interface TabMessageRetryOptions {
  attempts?: number
  delayMs?: number
}

function isReceiverStartupError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /receiving end does not exist|could not establish connection|message port closed/i.test(message)
}

export async function sendTabMessageWithRetry<T>(
  send: () => Promise<T>,
  options: TabMessageRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4)
  const delayMs = Math.max(0, options.delayMs ?? 150)
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await send()
    } catch (error) {
      lastError = error
      if (attempt >= attempts || !isReceiverStartupError(error)) throw error
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}
