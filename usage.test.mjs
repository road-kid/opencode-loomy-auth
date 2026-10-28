// The points card: the summary off the V2 records call — the two data floors
// it has shipped in, the numbers it has quoted — with used a percentage 0-100
// and the amounts in display alone (F1). The grant's dailyBalance is its
// remaining, not its size, so the percentage needs a quota: the pair an
// older answer carried, the dailyQuota on the answer, or the size the
// check-in noted — issue #1's real captures are the fixtures. Not signed in
// answers {error} alone; a dead sign-in keeps its marker and everything else
// is a kept sign-in's bad answer.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { LoomyAuthPlugin, _internal } from "./index.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

// the quota cache pointed at a throwaway, so a run of these tests never
// touches a note that belongs to a real install
process.env.LOOMY_QUOTA_CACHE_FILE = join(tmpdir(), `loomy-quota-usage-${randomUUID()}.json`)

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

test("the summary settles on either data floor, numbers quoted or not", () => {
  const two = { data: { data: { balance: 100.5, dailyBalance: 50 } } }
  const one = { data: { balance: 100.5, dailyBalance: 50 } }
  assert.deepEqual(_internal.usageOf(two), _internal.usageOf(one))
  assert.equal(_internal.usageOf(one).balance, "150.5 积分")
})

test("used is the grant's consumed share; the amounts live in display (F1)", () => {
  const card = _internal.usageOf({ data: { balance: 100, dailyBalance: "5000", dailyRemainingPoints: "1500", dailyLimitPoints: 5000 } })
  assert.equal(card.balance, "5100 积分")
  const [grant, permanent] = card.windows
  assert.equal(grant.name, "每日赠送")
  assert.equal(grant.used, 70) // (5000-1500)/5000, a percentage
  assert.equal(grant.span, 86400) // a day: the grant comes back with the calendar
  assert.equal(grant.display, "1500 / 5000 积分")
  assert.deepEqual(permanent, { name: "永久积分", used: 0, display: "100 积分", unit: "credits", aside: true }) // a status row, always zero
})

test("a grant without a size shows its remaining alone, zero used (issue #1: no pair comes back)", () => {
  const card = _internal.usageOf({ data: { balance: 0, dailyBalance: 40 } })
  const [grant] = card.windows
  assert.equal(grant.used, 0)
  assert.equal(grant.display, "剩余 40 积分")
  assert.equal(card.balance, "40 积分")
})

test("dailyBalance is the grant's remaining: with a size, the share reads off it (issue #1's capture)", () => {
  const capture = { code: "000000", data: { balance: 0, dailyBalance: 3011 } } // quota 5000, consumed 1989 — the first-login answer beside it says
  const [bare] = _internal.usageOf(capture).windows
  assert.equal(bare.used, 0) // no size, no invented share
  assert.equal(bare.display, "剩余 3011 积分")
  const [sized] = _internal.usageOf(capture, 5000).windows
  assert.equal(sized.used, 40) // (5000-3011)/5000, a percentage
  assert.equal(sized.display, "3011 / 5000 积分")
})

test("the size the check-in noted carries across restarts, by the cache file", async () => {
  await writeFile(process.env.LOOMY_QUOTA_CACHE_FILE, JSON.stringify({ "139****9000": 5000 }), "utf8")
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 3011 } }))
  const card = await hooks.auth.usage(async () => ({ access: "tok", accountId: "139****9000" }))
  const [grant] = card.windows
  assert.equal(grant.used, 40)
  assert.equal(grant.display, "3011 / 5000 积分")
})

test("missing numbers read as zero, and the sum rounds to cents", () => {
  assert.equal(_internal.usageOf({ data: { balance: 0.1, dailyBalance: 0.2 } }).balance, "0.3 积分")
  assert.equal(_internal.usageOf({}).balance, "0 积分")
})

test("the card off the fake, the older answer's pair on it — the pair still wins (compat)", async () => {
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 120, dailyBalance: 80, dailyRemainingPoints: 20, dailyLimitPoints: 80 } }))
  const card = await hooks.auth.usage(async () => ({ access: "tok", accountId: "138****8000" }))
  assert.deepEqual(card, {
    plan: "Loomy",
    balance: "200 积分",
    windows: [
      { name: "每日赠送", used: 75, span: 86400, display: "20 / 80 积分", amount: 60, limit: 80, unit: "credits", resetsAt: "2026-10-28T16:00:00.000Z" },
      { name: "永久积分", used: 0, display: "120 积分", unit: "credits", aside: true },
    ],
    user: "138****8000",
    signIn: "kept",
  })
  const r = f.seen[0]
  assert.equal(r.method, "GET")
  assert.equal(r.url, "/api/v2/points/records?pageNo=1&pageSize=1&direction=debit&granularity=chat")
  assert.equal(r.headers.token, "tok") // the session's two headers, and no signature
  assert.equal(r.headers.authorization, "Bearer tok")
  assert.ok(!r.headers["content-md5"])
})

test("the card carries the still-claimable newcomer purse as an aside row", async () => {
  const auth = async () => ({ access: "tok-aside", accountId: "135****5000" })
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 3011 } }))
  // share_soul alone stands, 2000 points; the other seven are done
  const done = Object.fromEntries(_internal.ONBOARDING_TASKS.filter((t) => t.key !== "share_soul").map((t) => [t.key, true]))
  f.route("GET /api/v1/onboarding/tasks", () => json({ code: "000000", data: { tasks: { ...done, share_soul: false } } }))
  const card = await hooks.auth.usage(auth)
  assert.deepEqual(card.windows.at(-1), { name: "新手任务", used: 0, display: "可领 2000 积分（1 项）", aside: true })
  // the read is cached for the run: a second render asks the records alone
  await hooks.auth.usage(auth)
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/onboarding/tasks").length, 1)
  // a board that refuses answers no row at all — and no retry either
  f.route("GET /api/v1/onboarding/tasks", () => json({}, 500))
  const bare = await hooks.auth.usage(async () => ({ access: "tok-bare", accountId: "135****5001" }))
  assert.equal(bare.windows.length, 2)
  await hooks.auth.usage(async () => ({ access: "tok-bare", accountId: "135****5001" }))
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/onboarding/tasks").length, 2) // one refusal, cached
})

test("the words follow the host's settings.json lang — en beside zh", async () => {
  // a host folder of the user's own: lang en, the shape magpie writes
  const dir = join(tmpdir(), "loomy-lang-" + randomUUID())
  const { mkdirSync, writeFileSync, rmSync } = await import("node:fs")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ lang: "en" }))
  const was = _internal.noteHostDirectory(dir)
  try {
    const w = _internal.usageOf({ data: { balance: 0, dailyBalance: 3011 } }, 5000, "2026-10-28")
    const [grant, permanent] = w.windows
    assert.equal(w.balance, "3011 credits")
    assert.equal(grant.name, "Daily grant")
    assert.equal(grant.display, "3011 / 5000 credits")
    assert.equal(grant.unit, "credits")
    assert.equal(permanent.name, "Permanent points")
    assert.equal(_internal.describeLoginError("020002", ""), "Sign-in expired, sign in again")
    assert.equal(_internal.describeLoginError("100001", "busy"), "Sign-in failed: busy")
    assert.equal(_internal.checkinOf({ code: "000000", data: { alreadyProcessed: true, dailyBalance: 3011, dailyQuota: 5000 } }).message, "Already refreshed today (3011 / 5000 credits)")
  } finally {
    _internal.noteHostDirectory("")
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(_internal.describeLoginError("020002", ""), "登录态已失效，请重新登录")
  // and with no host folder the plugin's own words stand
  const zh = _internal.usageOf({ data: { balance: 0, dailyBalance: 3011 } }, 5000, "2026-10-28")
  assert.equal(zh.windows[0].name, "每日赠送")
  assert.equal(zh.balance, "3011 积分")
})

test("the reset moment is the next Beijing midnight of the cycle the note names", () => {
  // a cycle date's day opens at its Beijing midnight; the reset is the next one
  assert.equal(_internal.beijingCycleResetAt("2026-10-28", Date.parse("2026-10-28T10:00:00+08:00")), "2026-10-28T16:00:00.000Z")
  // late in the Beijing day, still the same next midnight
  assert.equal(_internal.beijingCycleResetAt("2026-10-28", Date.parse("2026-10-28T23:30:00+08:00")), "2026-10-28T16:00:00.000Z")
  // a note from an earlier day never answers a moment already past
  assert.equal(_internal.beijingCycleResetAt("2026-10-26", Date.parse("2026-10-28T10:00:00+08:00")), "2026-10-28T16:00:00.000Z")
  // no note at all: the current Beijing day's next midnight
  assert.equal(_internal.beijingCycleResetAt(undefined, Date.parse("2026-10-28T10:00:00+08:00")), "2026-10-28T16:00:00.000Z")
})

test("a card with no note asks the first-login answer itself — once", async () => {
  const auth = async () => ({ access: "tok-heal", accountId: "132****2000" })
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 2013 } }))
  // a repeat of the day's first login: alreadyProcessed, the same numbers
  f.route("POST /api/v1/points/first-login", () =>
    json({ code: "000000", data: { alreadyProcessed: true, dailyBalance: 2013, dailyQuota: 5000, dailyConsumed: 2987, dailyCycleDate: "2026-10-28" } })
  )
  const card = await hooks.auth.usage(auth)
  const [grant] = card.windows
  assert.equal(grant.used, 60) // (5000-2013)/5000, healed on the first render
  assert.equal(grant.display, "2013 / 5000 积分")
  assert.match(grant.resetsAt, /^[0-9]{4}-[0-9]{2}-[0-9]{2}T16:00:00.000Z$/) // a Beijing midnight, whatever the day
  // the ask is once for the run: a second render adds no first-login call
  await hooks.auth.usage(auth)
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 1)
  // the note it took is written down for the next run
  assert.equal(JSON.parse(readFileSync(process.env.LOOMY_QUOTA_CACHE_FILE, "utf8"))["132****2000"], 5000)
})

test("an ask that refuses answers a plain card and is not asked again", async () => {
  const auth = async () => ({ access: "tok-nofix", accountId: "132****2001" })
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 900 } }))
  f.route("POST /api/v1/points/first-login", () => json({}, 500))
  const card = await hooks.auth.usage(auth)
  const [grant] = card.windows
  assert.equal(grant.used, 0)
  assert.equal(grant.display, "剩余 900 积分")
  await hooks.auth.usage(auth)
  assert.equal(f.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 1) // one ask, then silence
})

test("the credential's own note serves the card first", async () => {
  f.route("GET /api/v2/points/records", () => json({ code: "000000", data: { balance: 0, dailyBalance: 3011 } }))
  const card = await hooks.auth.usage(async () => ({ access: "tok", accountId: "133****3000", dailyQuota: 5000 }))
  const [grant] = card.windows
  assert.equal(grant.used, 40) // (5000-3011)/5000, off the credential alone
  assert.equal(grant.display, "3011 / 5000 积分")
})

test("not signed in answers {error} alone, asking nothing", async () => {
  assert.deepEqual(await hooks.auth.usage(async () => ({})), { error: "not signed in" })
  assert.equal(f.seen.length, 0)
})

test("a failed business code keeps the sign-in; a dead one ends it", async () => {
  const auth = async () => ({ access: "tok" })
  f.route("GET /api/v2/points/records", () => json({ code: "100001", desc: "busy" }))
  assert.deepEqual(await hooks.auth.usage(auth), { error: "积分查询失败：busy", signIn: "kept" })
  f.route("GET /api/v2/points/records", () => json({ code: "020002" }))
  assert.deepEqual(await hooks.auth.usage(auth), { error: "Loomy 登录态已失效，请重新登录", signIn: "expired" })
  f.route("GET /api/v2/points/records", () => json({}, 401)) // the HTTP-level end
  assert.deepEqual(await hooks.auth.usage(auth), { error: "Loomy 登录态已失效，请重新登录", signIn: "expired" })
})
