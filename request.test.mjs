// The chat forwarding through the loader's fetch: the session in both headers
// the model gateway reads and the Accept of a stream, the body whole; a 401
// or a bare 403 the sign-in's end (a phone-code session has no refresh to
// try); a quota refusal — a 429 worded as one, or the 403 a gateway has been
// caught answering over spent points — rewritten as the 429 another account
// takes over from; and a 200 passed through untouched.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { LoomyAuthPlugin } from "./index.mjs"
import { fakeLoomy, json, pointAt, text } from "./fake.mjs"

let f
let restore
let opts
const auth = { type: "oauth", access: "sess-token-1" }
const body = '{"model":"GLM-5.3-Flash","messages":[{"role":"user","content":"hi"}],"stream":true}'

beforeEach(async () => {
  f = await fakeLoomy()
  restore = pointAt(f.origin)
  opts = await (await LoomyAuthPlugin({ client: {} })).auth.loader(async () => auth)
})
afterEach(async () => {
  restore()
  await f.close()
})

const chat = () => opts.fetch(opts.baseURL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body })

test("a chat carries the session twice, the stream's Accept, and the body whole", async () => {
  assert.equal(opts.baseURL, f.origin + "/api/v1")
  f.route("POST /api/v1/chat/completions", () => text('data: {"id":"x"}\n\n', 200, { "content-type": "text/event-stream" }))
  const res = await chat()
  assert.equal(res.status, 200)
  assert.equal(res.headers.get("X-Magpie-Sign-In"), "kept")
  assert.equal(await res.text(), 'data: {"id":"x"}\n\n') // a 200 passes through untouched
  const r = f.seen[0]
  assert.equal(r.method, "POST")
  assert.equal(r.path, "/api/v1/chat/completions")
  assert.equal(r.text, body)
  assert.equal(r.headers.token, "sess-token-1") // the dual write, the client's authMode "token"
  assert.equal(r.headers.authorization, "Bearer sess-token-1")
  assert.equal(r.headers.accept, "text/event-stream")
})

test("a Request the SDK already built is forwarded the same way", async () => {
  f.route("POST /api/v1/chat/completions", () => json({ ok: true }))
  const res = await opts.fetch(new Request(opts.baseURL + "/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body }))
  assert.equal(res.status, 200)
  assert.equal(f.seen[0].text, body)
  assert.equal(f.seen[0].headers.token, "sess-token-1")
})

test("no session to send is the sign-in's end, with no request made", async () => {
  const bare = await (await LoomyAuthPlugin({ client: {} })).auth.loader(async () => ({}))
  await assert.rejects(bare.fetch("http://127.0.0.1:1/x", { method: "POST", body }), (e) => e.signIn === "expired")
  assert.equal(f.seen.length, 0)
})

test("a 401 and a bare 403 are the sign-in's end", async () => {
  for (const status of [401, 403]) {
    f.route("POST /api/v1/chat/completions", () => text("refused", status))
    await assert.rejects(chat(), (e) => e.signIn === "expired", "status " + status)
    assert.ok(f.seen.length > 0)
  }
})

test("a quota refusal becomes the 429 another account takes over from", async () => {
  f.route("POST /api/v1/chat/completions", () => json({ type: "error", error: { type: "permission_error", message: "积分余额不足" } }, 429))
  const res = await chat()
  assert.equal(res.status, 429)
  assert.equal(res.headers.get("X-Magpie-Sign-In"), "kept")
  assert.deepEqual(await res.json(), { type: "error", error: { type: "rate_limit_error", message: "usage limit reached: 积分余额不足" } })
})

test("a 403 worded as the quota is the same 429, not a dead session", async () => {
  f.route("POST /api/v1/chat/completions", () => json({ error: { message: "credits exhausted" } }, 403))
  const res = await chat()
  assert.equal(res.status, 429)
  assert.equal((await res.json()).error.type, "rate_limit_error")
})

test("any other refusal goes on as it came, the account kept", async () => {
  f.route("POST /api/v1/chat/completions", () => json({ error: { type: "invalid_request_error", message: "bad model" } }, 400))
  const res = await chat()
  assert.equal(res.status, 400)
  assert.equal(res.headers.get("X-Magpie-Sign-In"), "kept")
  assert.equal((await res.json()).error.message, "bad model")
})
