// The daily first-login claim: the answer's alreadyProcessed tells the day's
// renewal from a repeat — a repeat is done, not claimed again — and the day's
// first is claimed, its credit promised only when the answer carries the
// whole arithmetic (dailyQuota − dailyConsumed; the dailyBalance it carries
// is the remaining, not the gain — issue #1's real captures are the
// fixtures). The claim notes the quota for the card's percentage, in the run
// and in the cache file. A dead sign-in keeps its marker while any other
// failure is just a failed claim.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LoomyAuthPlugin, _internal } from "./index.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

// the quota cache pointed at a throwaway, so a run of these tests never
// touches a note that belongs to a real install
process.env.LOOMY_QUOTA_CACHE_FILE = join(tmpdir(), `loomy-quota-checkin-${randomUUID()}.json`)

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

test("a success with no arithmetic is claimed, no credit promised", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000" }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "claimed", message: "每日赠送积分已刷新" })
  assert.ok(!("credit" in out), "the answer carries no granted-this-time arithmetic, so none is promised")
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
  // the newcomer board fully claimed: the claim round reads it and asks nothing further
  const allDone = Object.fromEntries(_internal.ONBOARDING_TASKS.map((t) => [t.key, true]))
  f.route("GET /api/v1/onboarding/tasks", () => json({ code: "000000", data: { tasks: allDone } }))
  const auth = async () => ({ access: "tok" })
  const first = await hooks.auth.checkin(auth)
  const second = await hooks.auth.checkin(auth)
  assert.equal(first.outcome, "claimed")
  assert.equal(second.outcome, "claimed") // no client-side "already done today"
  // both rounds went out: the daily grant twice, the tasks board twice
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 2)
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/onboarding/tasks").length, 2)
  for (const r of f.seen.filter((r) => r.path === "/api/v1/points/first-login")) {
    assert.equal(r.method, "POST")
    assert.equal(r.text, "{}") // first-login's own body is one
    assert.equal(r.headers.token, "tok")
    assert.equal(r.headers.authorization, "Bearer tok")
  }
})

test("the check-in also claims the newcomer tasks, highest value first, one at a time", async () => {
  f.route("POST /api/v1/points/first-login", () =>
    json({ code: "000000", data: { alreadyProcessed: false, dailyBalance: 5000, dailyQuota: 5000, dailyConsumed: 0 } })
  )
  // first_message is done; the other seven stand, 9500 points in all
  const done = { first_message: true }
  f.route("GET /api/v1/onboarding/tasks", () => json({ code: "000000", data: { tasks: done, earned: 500, total: 10000 } }))
  f.route("POST /api/v1/onboarding/tasks/complete", () => json({ code: "000000", data: { alreadyCompleted: false, balance: 10000 } }))
  const out = await hooks.auth.checkin(async () => ({ access: "tok-order" }))
  assert.equal(out.outcome, "claimed")
  assert.match(out.message, /，新手任务 \+9500（7 项）$/)
  // the claim order is the value order, and each claim is its own call
  const claims = f.seen.filter((r) => r.path === "/api/v1/onboarding/tasks/complete")
  assert.equal(claims.length, 7)
  assert.deepEqual(
    claims.map((r) => r.json.key),
    ["share_soul", "generate_ppt", "install_skill", "create_soul", "pick_skill", "set_schedule", "configure_remote"]
  )
  for (const r of claims) {
    assert.equal(r.headers.token, "tok-order")
    assert.equal(r.headers.authorization, "Bearer tok-order")
  }
})

test("a refusal among the one-time claims never touches the daily claim", async () => {
  f.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { dailyBalance: 5000 } }))
  f.route("GET /api/v1/onboarding/tasks", () => json({ code: "000000", data: { tasks: {} } })) // all eight stand
  f.route("POST /api/v1/onboarding/tasks/complete", () => json({ code: "100009", desc: "风控" }, 200)) // every claim fails
  const out = await hooks.auth.checkin(async () => ({ access: "tok-isol" }))
  assert.deepEqual(out, { outcome: "claimed", message: "每日赠送积分已刷新（当前 5000）" })
  // a dead board (HTTP-level refusal) is the same silence
  f.route("GET /api/v1/onboarding/tasks", () => json({}, 500))
  const again = await hooks.auth.checkin(async () => ({ access: "tok-isol" }))
  assert.deepEqual(again, { outcome: "claimed", message: "每日赠送积分已刷新（当前 5000）" })
})

test("a repeat's alreadyCompleted answers no points", () => {
  const board = { tasks: { pick_skill: true }, nonsense: true } // unknown keys read as nothing
  assert.deepEqual(
    _internal.onboardingStateOf({ code: "000000", data: board }).map((t) => t.key),
    _internal.ONBOARDING_TASKS.filter((t) => t.key !== "pick_skill").map((t) => t.key)
  )
})

test("a repeat answers done — alreadyProcessed tells it apart (issue #1's capture)", async () => {
  f.route("POST /api/v1/points/first-login", () =>
    json({
      code: "000000",
      data: { alreadyProcessed: true, currentBalance: 3011, permanentBalance: 0, dailyBalance: 3011, dailyQuota: 5000, dailyConsumed: 1989, dailyCycleDate: "2026-10-27" },
    })
  )
  const out = await hooks.auth.checkin(async () => ({ access: "tok", accountId: "138****8000" }))
  assert.deepEqual(out, { outcome: "done", message: "今日已刷新（剩余 3011 / 5000）" })
})

test("the day's first answers claimed, the credit the answer's own arithmetic", async () => {
  f.route("POST /api/v1/points/first-login", () =>
    json({
      code: "000000",
      data: { alreadyProcessed: false, currentBalance: 5000, permanentBalance: 0, dailyBalance: 5000, dailyQuota: 5000, dailyConsumed: 0, dailyCycleDate: "2026-10-28" },
    })
  )
  const out = await hooks.auth.checkin(async () => ({ access: "tok" }))
  assert.deepEqual(out, { outcome: "claimed", credit: 5000, message: "每日赠送积分已刷新（+5000，当前 5000）" })
})

test("the quota the claim notes serves the card — the file for the next run, the map for this one", async () => {
  f.route("POST /api/v1/points/first-login", () =>
    json({ code: "000000", data: { alreadyProcessed: false, dailyBalance: 5000, dailyQuota: 5000, dailyConsumed: 0 } })
  )
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 2013 } }))
  const auth = async () => ({ access: "tok", accountId: "137****7000" })
  await hooks.auth.checkin(auth)
  // the next run reads the file: one size, keyed by the account
  assert.equal(JSON.parse(await readFile(process.env.LOOMY_QUOTA_CACHE_FILE, "utf8"))["137****7000"], 5000)
  // this run reads the note the same call left in memory: (5000-2013)/5000
  const card = await hooks.auth.usage(auth)
  const [grant] = card.windows
  assert.equal(grant.used, 60)
  assert.equal(grant.display, "剩余 2013 / 限额 5000")
})

test("not signed in answers failed, asking nothing", async () => {
  assert.deepEqual(await hooks.auth.checkin(async () => ({})), { outcome: "failed", message: "not signed in" })
  assert.equal(f.seen.length, 0)
})
