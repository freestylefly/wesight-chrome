import { hmacSha256, secureEqual, sha256 } from "~lib/crypto"

describe("bridge crypto", () => {
  test("creates stable sha256 and hmac values", async () => {
    expect(await sha256("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    expect(await hmacSha256("secret", "payload")).toHaveLength(64)
  })
  test("compares signatures without early exit", () => {
    expect(secureEqual("abcd", "abcd")).toBe(true)
    expect(secureEqual("abcd", "abce")).toBe(false)
  })
})
