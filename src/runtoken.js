// Run tokens.
//
// The page cannot be trusted to say how long a run took — it is the thing
// doing the lying. So the clock belongs to the server at both ends: it stamps
// a token when a run starts and reads its own clock again when the score comes
// back. The client never handles a timestamp, and its own clock never matters.
//
// The token is signed rather than stored, so issuing one is free and needs no
// database. What is stored is the spending of it: the nonce lands on the score
// row under a unique index, so a token buys exactly one entry.

const encoder = new TextEncoder()

const base64url = bytes =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

const fromBase64url = value => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

const keyFor = secret =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"])

export async function issueRunToken(secret, now = Date.now()) {
  const nonce = crypto.randomUUID()
  const body = base64url(encoder.encode(JSON.stringify({ n: nonce, t: now })))
  const signature = await crypto.subtle.sign("HMAC", await keyFor(secret), encoder.encode(body))
  return { token: `${body}.${base64url(signature)}`, nonce, issuedAt: now }
}

// Returns null for anything that is not a token this server signed. Callers
// treat null as "no run", never as "assume it is fine".
export async function readRunToken(secret, token) {
  if (typeof token !== "string" || token.length > 512) return null
  const [body, signature] = token.split(".")
  if (!body || !signature) return null
  let valid
  try {
    valid = await crypto.subtle.verify("HMAC", await keyFor(secret), fromBase64url(signature), encoder.encode(body))
  } catch {
    return null
  }
  if (!valid) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)))
    if (typeof payload.n !== "string" || !Number.isFinite(payload.t)) return null
    return { nonce: payload.n, issuedAt: payload.t }
  } catch {
    return null
  }
}
