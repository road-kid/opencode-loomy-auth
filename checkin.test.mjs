// The daily first-login claim: every success is claimed (the server renews
// the grant once a day and answers a repeat the same way, so "already today"
// is not a state it can tell apart), the answer carries no granted-this-time
// field so no credit is ever promised (F2) — the daily balance, when the
// answer carries it at all, goes into the wording — and a dead sign-in keeps
// its marker while any other failure is just a failed claim.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { LoomyAuthPlugin, _internal } from "./index.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

let f
let restore
let hooks
beforeEach(async () => {
  f = await fakeLoomy()
  restore = pointAt(f.origin)
  hooks = await LoomyAuthPlugin({ client: {} })
})
afterEach(async () => {
  restore()
  await f.close()
})

test("a success is claimed, with no credit promised (F2)", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000" }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "claimed", message: "每日赠送积分已刷新" })
  assert.ok(!("credit" in out), "the answer carries no granted-this-time field, so none is promised")
})

test("the daily balance, when the answer carries it, goes into the wording (F2)", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { dailyBalance: 5000 } }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "claimed", message: "每日赠送积分已刷新（当前 5000）" })
  assert.ok(!("credit" in out))
  // the deeper floor it has also been seen in, the balance quoted
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { data: { dailyBalance: "4500" } } }))
  assert.deepEqual(_internal.checkinOf({ code: "000000", data: { data: { dailyBalance: "4500" } } }), { outcome: "claimed", message: "每日赠送积分已刷新（当前 4500）" })
})

test("a failed business code answers failed with the upstream wording", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "100005", desc: "今日已达上限" }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "failed", message: "每日积分刷新失败：今日已达上限" })
})

test("a dead sign-in code answers failed and ends the sign-in", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "020002" }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "failed", message: "登录态已失效，请重新登录", signIn: "expired" })
})

test("two calls in a row both claim: the idempotent reading", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { dailyBalance: 5000 } }))
  const auth = async () => ({ access: "tok" })
  const first = await hooks.auth.checkin(auth)
  const second = await hooks.auth.checkin(auth)
  assert.equal(first.outcome, "claimed")
  assert.equal(second.outcome, "claimed") // no client-side "already done today"
  assert.equal(f.seen.length, 2) // both went out
  for (const r of f.seen) {
    assert.equal(r.method, "POST")
    assert.equal(r.path, "/api/v1/points/first-login")
    assert.equal(r.text, "{}") // first-login's own body is one
    assert.equal(r.headers.token, "tok")
    assert.equal(r.headers.authorization, "Bearer tok")
  }
})

test("not signed in answers failed, asking nothing", async () => {
  assert.deepEqual(await hooks.auth.checkin(async () => ({})), { outcome: "failed", message: "not signed in" })
  assert.equal(f.seen.length, 0)
})
