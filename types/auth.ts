export interface WeSightUser {
  userId: string
  nickname: string
  avatarUrl: string | null
  isAdmin?: boolean
}

export interface WeSightAuthState {
  user: WeSightUser | null
  source: "cloud" | "obsidian" | null
  loginPending: boolean
  error?: string
}

export function isWeSightUser(value: unknown): value is WeSightUser {
  if (!value || typeof value !== "object") return false
  const user = value as Partial<WeSightUser>
  return typeof user.userId === "string" && Boolean(user.userId)
    && typeof user.nickname === "string"
    && (user.avatarUrl === null || typeof user.avatarUrl === "string")
}
