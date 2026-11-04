// The opencode v2 adapter, against fakes the whole way: the default export's
// shape beside the V1 named one, the registrations the setup makes on a fake
// host context (the integration's name and phone-code method, the provider's
// info and rows — the official display names, the reasoning efforts as each
// vendor's own gears intersected with the gateway's declaration, the zeroed
// release date), the sign-in
// re-wrapped into the v2 credential shape, the live model list behind a
// signed-in connection and the snapshot behind none or a refused ask, an
// empty context loading to a cleanup alone, and the registrations — the
// event subscription's abort among them — given up at cleanup.
import "./nonet.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import loomy, { LoomyAuthPlugin, _internal } from "./index.mjs"
import tui from "./tui.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

// the desktop panel's bundle, read the way Node reads a .cjs — its top
// level is definitions alone (no require runs before a setup's), so the
// file loads clean here and its pure surface is the tests' to hold
const require = createRequire(import.meta.url)
const guiBundle = require("./dist/gui-experimental.cjs")

// the panel's note read goes through the same file the V1 card's does —
// pointed at a scratch file so the run reads nothing a real checkout left
// behind (the other suites keep the same house rule)
process.env.LOOMY_QUOTA_CACHE_FILE = join(tmpdir(), `loomy-quota-v2-${randomUUID()}.json`)

// a fake of the host context the setup registers against: the two transform
// domains record their callbacks and run them at once on fake editors (the
// integration editor's update and method.update recorded, the provider
// editor's get/add/models.set recorded), provider.reload counted, the event
// domain recording each subscription's options and answering a generator
// that yields what the test gave, and the connection domain — the test's to
// set, or left off entirely — answering the active connection and its
// credential. The recordings are the assertions' raw material.
const fakeCtx = (connection, events = []) => {
  const seen = {
    updates: [], // the integration editor's update ids
    renamed: [], // the items after the update fns ran
    methods: [], // the method registrations editor.method.update took
    adds: [], // the provider editor's add entries
    sets: [], // the provider editor's models.set pairs
    integrationTransforms: [], // the integration domain's callbacks
    providerTransforms: [], // the provider domain's callbacks
    reloads: 0, // provider.reload's calls
    subs: [], // the event subscriptions' option objects
    disposals: [], // the registrations' dispose runs
  }
  // the storage domain: the host keeps one flat shared keyspace (no
  // per-plugin scoping — the recon's finding), so the fake is one map and
  // the plugin's namespaced keys sit in it beside anyone's
  const storage = new Map()
  const ctx = {
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value)
      },
      remove: async (key) => {
        storage.delete(key)
      },
    },
    integration: {
      transform: async (fn) => {
        seen.integrationTransforms.push(fn)
        fn({
          update: (id, item) => {
            seen.updates.push(id)
            const record = { name: "" }
            item(record)
            seen.renamed.push(record)
          },
          method: { update: (reg) => seen.methods.push(reg) },
        })
        return { dispose: () => seen.disposals.push("integration") }
      },
      ...(connection ? { connection } : {}),
    },
    provider: {
      transform: async (fn) => {
        seen.providerTransforms.push(fn)
        fn({
          get: () => undefined,
          add: (entry) => seen.adds.push(entry),
          models: { set: (id, models) => seen.sets.push([id, models]) },
        })
        return { dispose: () => seen.disposals.push("provider") }
      },
      reload: async () => {
        seen.reloads += 1
      },
    },
    event: {
      subscribe: async (opts) => {
        seen.subs.push(opts)
        return (async function* () {
          for (const event of events) yield event
        })()
      },
    },
  }
  return { ctx, seen, storage }
}

// waitUntil polls a condition the fire-and-forget work settles into — the
// setup's own renewal, an event's — with a hard stop so a missing call
// fails the test instead of hanging it
const waitUntil = async (cond, ms = 2000) => {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) assert.ok(cond(), "the condition never came true")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test("the default export is a v2 definition and the V1 export stands beside it", () => {
  assert.equal(typeof loomy.id, "string")
  assert.ok(loomy.id.length > 0)
  assert.equal(typeof loomy.setup, "function")
  assert.equal(typeof LoomyAuthPlugin, "function") // the V1 form, untouched
})

test("the default export carries the object-entrypoint server magpie's host reads", async () => {
  // magpie's loader: a default export carrying an id is read by its server
  // function alone — the named-export scan under it never runs. The server
  // must therefore be the V1 factory itself, answering the V1 hooks on the
  // V1 input.
  assert.equal(typeof loomy.server, "function")
  const hooks = await loomy.server({ client: {} })
  assert.equal(hooks.auth.provider, "loomy")
  assert.equal(hooks.provider.id, "loomy")
  assert.equal(typeof hooks.config, "function")
  assert.equal(typeof hooks.auth.loader, "function")
  assert.equal(typeof hooks.provider.models, "function")
})

test("the setup registers the integration: the name and the phone-code method", async () => {
  const { ctx, seen } = fakeCtx()
  const cleanup = await loomy.setup(ctx)
  assert.equal(seen.updates[0], "loomy")
  assert.equal(seen.renamed[0].name, "Loomy")
  const reg = seen.methods[0]
  assert.ok(reg, "a method registration went in")
  assert.equal(reg.integrationID, "loomy")
  assert.equal(reg.method.type, "oauth")
  assert.equal(reg.method.id, "phone-code")
  assert.ok(reg.method.label, "the method carries its label")
  assert.equal(typeof reg.authorize, "function")
  const field = reg.method.form.find((f) => f.key === "phone")
  assert.ok(field, "the form asks for the phone")
  assert.equal(field.required, true)
  cleanup()
})

test("the setup registers the provider: its info and the snapshot's rows", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    const { ctx, seen } = fakeCtx()
    const cleanup = await loomy.setup(ctx)
    const entry = seen.adds[0]
    assert.ok(entry, "the provider is added, no provider being on the books")
    assert.equal(entry.info.id, "loomy")
    assert.equal(entry.info.integrationID, "loomy")
    assert.equal(entry.info.package, "@opencode/ai/providers/openai-compatible")
    assert.equal(entry.info.settings.baseURL, up.origin + "/api/v1")
    assert.equal(entry.info.activation, "auto") // the sign-in gate
    assert.ok(entry.models.length, "the rows came along")
    const deepseek = entry.models.find((m) => m.id === "DeepSeek-V4.1-Flash")
    assert.ok(deepseek, "the snapshot's DeepSeek row is among them")
    assert.equal(deepseek.modelID, "DeepSeek-V4.1-Flash")
    assert.equal(deepseek.providerID, "loomy")
    assert.equal(deepseek.name, "DeepSeek V4.1 Flash") // the official spelling
    assert.equal(typeof deepseek.capabilities.tools, "boolean")
    assert.deepEqual(deepseek.capabilities.input, ["text", "image"]) // a vision row
    assert.deepEqual(deepseek.capabilities.output, ["text"])
    assert.equal(deepseek.limit.context, 1048576)
    assert.equal(deepseek.cost[0].cache.read, 0)
    assert.equal(deepseek.cost[0].cache.write, 0)
    assert.equal(deepseek.status, "active")
    assert.equal(deepseek.enabled, true)
    // a zero release date: the desktop picker's rule hides a dated row that
    // is not its family's newest, and an empty date — no parseable date at
    // all — keeps the row visible by default
    assert.equal(deepseek.time.released, 0)
    // the snapshot rows carry no declaration of their own, so the official
    // levels answer: DeepSeek's real gears — none/low/high, medium and xhigh
    // being documented aliases of high — the body overlay the host merges
    // into the request, the gateway's own camelCase spelling
    assert.deepEqual(deepseek.variants, [
      { id: "none", body: { reasoningEffort: "none" } },
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "high", body: { reasoningEffort: "high" } },
    ])
    assert.equal(deepseek.rate, undefined) // the v2 record has no field for it
    assert.equal(deepseek.free, undefined)
    // three more rows spot-checked against the official table: Kimi — no
    // reasoning_effort at all, none's turn-it-off alone; GLM — thinking
    // cannot be turned off, no none; MiMo — xhigh an alias of high; and
    // auto — no declaration, no entry — hangs none at all
    const kimi = entry.models.find((m) => m.id === "Kimi-k2.6")
    assert.ok(kimi, "the snapshot's Kimi row is among them")
    assert.equal(kimi.name, "Kimi K2.6")
    assert.deepEqual(kimi.variants, [{ id: "none", body: { reasoningEffort: "none" } }])
    const glm = entry.models.find((m) => m.id === "GLM-5.3-Flash")
    assert.ok(glm, "the snapshot's GLM row is among them")
    assert.deepEqual(
      glm.variants.map((v) => v.id),
      ["low", "high"]
    )
    const mimo = entry.models.find((m) => m.id === "mimo-v2.5")
    assert.ok(mimo, "the snapshot's MiMo row is among them")
    assert.deepEqual(
      mimo.variants.map((v) => v.id),
      ["none", "low", "medium", "high"]
    )
    const auto = entry.models.find((m) => m.id === "auto")
    assert.ok(auto, "the auto row is among them")
    assert.equal(auto.name, "自动 · 均衡")
    assert.deepEqual(auto.variants, [])
    cleanup()
  } finally {
    await up.close()
    restore()
  }
})

test("the v2 method signs in through the same phone-code flow", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    up.route("POST /login/phone/sendMsgCode", () => json({ code: "000000", data: { msgid: "mid-1" } }))
    up.route("POST /login/phone/checkCode", () => json({ code: "000000", data: { session: "sess-1", userid: "uid-1" } }))
    const { ctx, seen } = fakeCtx()
    const cleanup = await loomy.setup(ctx)
    const attempt = await seen.methods[0].authorize({ phone: "13800138000" })
    assert.ok(up.seen.some((r) => r.path === "/login/phone/sendMsgCode"), "the code was asked for")
    assert.equal(attempt.mode, "code")
    assert.ok(attempt.instructions.includes("138****8000"), "the instructions show the masked phone")
    const credential = await attempt.callback("123456")
    assert.ok(up.seen.some((r) => r.path === "/login/phone/checkCode"), "the code was checked")
    assert.equal(credential.type, "oauth")
    assert.equal(credential.methodID, "phone-code")
    assert.equal(credential.access, "sess-1") // the session is the model gateway's token
    assert.equal(credential.refresh, "") // a phone-code session has no way to renew
    assert.ok(credential.expires > Date.now())
    assert.equal(credential.metadata.accountId, "138****8000")
    assert.equal(credential.metadata.uid, "uid-1")
    cleanup()
  } finally {
    await up.close()
    restore()
  }
})

test("a failed check becomes the throw the v2 host reads as the sign-in's end", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    up.route("POST /login/phone/sendMsgCode", () => json({ code: "000000", data: { msgid: "mid-1" } }))
    up.route("POST /login/phone/checkCode", () => json({ code: "100001", desc: "wrong code" }))
    const { ctx, seen } = fakeCtx()
    const cleanup = await loomy.setup(ctx)
    const attempt = await seen.methods[0].authorize({ phone: "13800138000" })
    await assert.rejects(attempt.callback("123456"), /wrong code/)
    cleanup()
  } finally {
    await up.close()
    restore()
  }
})

test("a signed-in connection refreshes the live rows and replays the transform", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // every thinking row declares the gateway's same five-value
    // enumeration, and the auto row declares none at all — what hangs is
    // each declaration intersected with the official levels its vendor
    // vouches for
    up.route("GET /api/v1/models", () =>
      json({
        data: [
          { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", type: "chat", context_length: 4096, max_output_tokens: 1024, reasoning_efforts: ["none", "low", "medium", "high", "xhigh"] },
          { id: "kimi-k2.6", name: "Kimi k2.6", type: "chat", reasoning_efforts: ["none", "low", "medium", "high", "xhigh"] },
          { id: "qwen-3.8-max", name: "Qwen 3.8 Max", type: "chat", reasoning_efforts: ["none", "low", "medium", "high", "xhigh"] },
          { id: "qwen3.8-flash", name: "qwen 3.8 flash", type: "chat", reasoning_efforts: ["none", "low", "medium", "high", "xhigh"] },
          { id: "auto", name: "自动 · 均衡", type: "chat" },
        ],
      })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, seen } = fakeCtx(connection)
    const cleanup = await loomy.setup(ctx)
    assert.equal(seen.reloads, 1) // the initial refresh's replay
    const adds = []
    seen.providerTransforms[0]({
      get: () => undefined,
      add: (entry) => adds.push(entry),
      models: { set: (id, models) => adds.push({ models }) },
    })
    const models = adds[0].models
    assert.deepEqual(
      models.map((m) => m.id),
      ["deepseek-v4.1-flash", "kimi-k2.6", "qwen-3.8-max", "qwen3.8-flash", "auto"] // the live rows alone: no snapshot rows, no image generators
    )
    assert.equal(models[0].limit.context, 4096)
    assert.equal(models[0].limit.output, 1024)
    // DeepSeek's own gears: medium and xhigh are documented aliases of high,
    // so the five-value declaration intersected leaves three
    assert.deepEqual(models[0].variants, [
      { id: "none", body: { reasoningEffort: "none" } },
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "high", body: { reasoningEffort: "high" } },
    ])
    // Kimi K2.6 has no reasoning_effort of its own — only none's
    // turn-it-off meaning survives the intersection
    assert.deepEqual(models[1].variants, [{ id: "none", body: { reasoningEffort: "none" } }])
    // both Qwen rows: high is the docs' own alias of xhigh, dropped from
    // the five so the menu shows the gear once, in the declaration's order
    assert.deepEqual(models[2].variants, [
      { id: "none", body: { reasoningEffort: "none" } },
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "medium", body: { reasoningEffort: "medium" } },
      { id: "xhigh", body: { reasoningEffort: "xhigh" } },
    ])
    assert.deepEqual(models[3].variants, [
      { id: "none", body: { reasoningEffort: "none" } },
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "medium", body: { reasoningEffort: "medium" } },
      { id: "xhigh", body: { reasoningEffort: "xhigh" } },
    ])
    // the auto row declares no efforts and no vendor vouches for it: none hang
    assert.deepEqual(models[4].variants, [])
    cleanup()
  } finally {
    await up.close()
    restore()
  }
})

test("a row the tables don't know: the cleaned gateway name, the brand word set right, the efforts as declared", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // two strangers: one declares its own efforts (with junk among them — a
    // non-string is dropped, a padded string trimmed), one declares none
    up.route("GET /api/v1/models", () =>
      json({
        data: [
          { id: "brand-new-x", type: "chat", name: "qwen brand new(x1.5)", capabilities: { function_calling: true } },
          { id: "vendor-fresh-9", type: "chat", name: "Kimi fresh 9", reasoning_efforts: [" low ", 7, "ultra"] },
        ],
      })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, seen } = fakeCtx(connection)
    const cleanup = await loomy.setup(ctx)
    const adds = []
    seen.providerTransforms[0]({
      get: () => undefined,
      add: (entry) => adds.push(entry),
      models: { set: (id, models) => adds.push({ models }) },
    })
    const stranger = adds[0].models.find((m) => m.id === "brand-new-x")
    assert.ok(stranger, "the stranger came through the live list")
    // the rate suffix off the name, the leading brand word set to its
    // official spelling, and nothing else about the name touched
    assert.equal(stranger.name, "Qwen brand new")
    assert.deepEqual(stranger.variants, []) // no declaration, no table entry: a level is never claimed
    // a stranger that declares its efforts hangs exactly what it declared —
    // a model new to the gateway is supported the day it appears, no
    // release of this plugin needed
    const fresh = adds[0].models.find((m) => m.id === "vendor-fresh-9")
    assert.ok(fresh, "the declaring stranger came through the live list")
    assert.deepEqual(fresh.variants, [
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "ultra", body: { reasoningEffort: "ultra" } },
    ])
    cleanup()
  } finally {
    await up.close()
    restore()
  }
})

test("a refused ask for the live list falls back to the snapshot, swallowing the error", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // no route for /api/v1/models: the fake answers 404
    const connection = { active: async () => ({}), resolve: async () => ({ access: "tok" }) }
    const { ctx, seen } = fakeCtx(connection)
    const cleanup = await loomy.setup(ctx)
    assert.ok(seen.reloads >= 1, "the replay still ran")
    const adds = []
    seen.providerTransforms[0]({ get: () => undefined, add: (entry) => adds.push(entry) })
    assert.ok(adds[0].models.some((m) => m.id === "DeepSeek-V4.1-Flash"), "the snapshot answered instead")
    cleanup() // the renewal timer now rides out of every setup — give it up here
  } finally {
    await up.close()
    restore()
  }
})

test("a credential event refreshes the list again", async () => {
  const { ctx, seen } = fakeCtx(undefined, [{ type: "credential.updated" }])
  const cleanup = await loomy.setup(ctx)
  await new Promise((resolve) => setImmediate(resolve)) // the subscription's one event, processed
  assert.ok(seen.reloads >= 2, "the event's refresh replayed after the initial one")
  cleanup()
})

test("an empty context loads to a cleanup and nothing more", async () => {
  const cleanup = await loomy.setup({})
  assert.equal(typeof cleanup, "function")
  cleanup() // no registrations to give up, and no throw either
})

test("the cleanup gives the registrations up: the subscription's signal with them", async () => {
  const { ctx, seen } = fakeCtx()
  const cleanup = await loomy.setup(ctx)
  assert.equal(seen.subs.length, 1)
  const opts = seen.subs[0]
  assert.deepEqual(opts.types, ["credential.updated", "credential.switched", "integration.updated"])
  assert.equal(opts.signal.aborted, false)
  cleanup()
  assert.equal(opts.signal.aborted, true)
  assert.deepEqual(seen.disposals, ["integration", "provider"])
})

// ---- the daily silent renewal ------------------------------------------------------

test("v2BeijingDay is the Beijing calendar day, not the host's local one", () => {
  const { v2BeijingDay } = _internal
  // 2026-11-03 16:30 UTC is 2026-11-04 00:30 in Beijing: the Beijing day leads
  assert.equal(v2BeijingDay(Date.UTC(2026, 10, 3, 16, 30)), "2026-11-04")
  // 2026-11-03 15:59 UTC is still 2026-11-03 23:59 in Beijing: the last minute
  assert.equal(v2BeijingDay(Date.UTC(2026, 10, 3, 15, 59)), "2026-11-03")
  // an instant on either side of a Beijing midnight never shares a day
  assert.notEqual(v2BeijingDay(Date.UTC(2026, 10, 3, 15, 59, 59)), v2BeijingDay(Date.UTC(2026, 10, 3, 16, 0, 0)))
  // the shape is the endpoint's own YYYY-MM-DD
  assert.match(v2BeijingDay(Date.UTC(2026, 0, 2, 12)), /^\d{4}-\d{2}-\d{2}$/)
})

test("the renewal: the first call asks first-login once and marks the Beijing day", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    up.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { dailyQuota: 5, dailyCycleDate: "2999-01-01" } }))
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, storage } = fakeCtx(connection)
    await _internal.v2Renew(ctx)
    const asks = up.seen.filter((r) => r.method === "POST" && r.path === "/api/v1/points/first-login")
    assert.equal(asks.length, 1, "the renewal asked the first-login endpoint once")
    assert.equal(asks[0].headers.authorization, "Bearer tok") // the session is the token
    assert.equal(asks[0].headers.token, "tok") // the gateway reads both spellings
    assert.deepEqual(asks[0].json, {}) // first-login's own body is one
    assert.equal(storage.get("loomy-auth/renewal/last"), _internal.v2BeijingDay(Date.now()))
    // the grant's size rides home with the mark: the fields the answer
    // carried, noted under the plugin's own namespaced key — the v2
    // credential's metadata has no such fields, so this note is the
    // pure-v2 panel's own source for its percentage
    assert.deepEqual(storage.get("loomy-auth/quota-size"), { dailyQuota: 5, dailyCycleDate: "2999-01-01" })
    // the same day again: the mark returns before any ask goes out
    await _internal.v2Renew(ctx)
    assert.equal(up.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 1, "no second ask the same day")
  } finally {
    await up.close()
    restore()
  }
})

test("the renewal notes only the size fields the answer actually carries — a missing one is left out, never invented", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // an answer with the quota alone: no cycle date rides, and the note
    // keeps the one field it was given — no invented 0, no invented date
    up.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: { dailyQuota: 7 } }))
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, storage } = fakeCtx(connection)
    await _internal.v2Renew(ctx)
    assert.deepEqual(storage.get("loomy-auth/quota-size"), { dailyQuota: 7 })
    // an answer with neither field: the day is marked and no note goes in
    const late = fakeCtx(connection)
    up.route("POST /api/v1/points/first-login", () => json({ code: "000000", data: {} }))
    // a second account's storage stands in: the day mark differs by none,
    // so the ask goes out on the second context alone
    late.storage.set("loomy-auth/renewal/last", "1970-01-01")
    await _internal.v2Renew(late.ctx)
    assert.equal(late.storage.has("loomy-auth/quota-size"), false, "an answer without the size writes no note")
    assert.equal(late.storage.get("loomy-auth/renewal/last"), _internal.v2BeijingDay(Date.now()), "the day is still marked")
  } finally {
    await up.close()
    restore()
  }
})

test("a business failure writes no mark, and the next call asks again", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    up.route("POST /api/v1/points/first-login", () => json({ code: "100001", desc: "not today" }))
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, storage } = fakeCtx(connection)
    await _internal.v2Renew(ctx)
    assert.equal(up.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 1, "the ask went out")
    assert.equal(storage.size, 0, "a business failure writes no mark")
    await _internal.v2Renew(ctx) // a failed day is not a renewed day
    assert.equal(up.seen.filter((r) => r.path === "/api/v1/points/first-login").length, 2, "the retry asked again")
  } finally {
    await up.close()
    restore()
  }
})

test("no connection, no token, no storage domain, a throwing domain: the renewal returns before any ask, silently", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // a connection whose credential has no token — only whitespace
    const blank = { active: async () => ({ integrationID: "loomy", id: "conn-1" }), resolve: async () => ({ type: "oauth", access: "   " }) }
    const one = fakeCtx(blank)
    await _internal.v2Renew(one.ctx)
    // no active connection at all
    const none = { active: async () => undefined, resolve: async () => ({ access: "tok" }) }
    const two = fakeCtx(none)
    await _internal.v2Renew(two.ctx)
    // no storage domain on the context at all
    await _internal.v2Renew({})
    // a domain that throws: the wrap swallows it whole
    const broken = { active: async () => { throw new Error("boom") } }
    const three = fakeCtx(broken)
    await _internal.v2Renew(three.ctx)
    assert.equal(up.seen.length, 0, "no ask went anywhere")
    assert.equal(one.storage.size, 0)
    assert.equal(two.storage.size, 0)
  } finally {
    await up.close()
    restore()
  }
})

test("the setup renews — at start and after the event — on a half-hour timer the cleanup clears", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  // the timer through a shim: the test holds what setInterval answered and
  // what clearInterval took, the cleanup's giving-up read off the two
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  const timers = []
  const cleared = []
  globalThis.setInterval = (fn, ms) => {
    const handle = realSet(fn, ms)
    timers.push({ handle, ms })
    return handle
  }
  globalThis.clearInterval = (handle) => {
    cleared.push(handle)
    return realClear(handle)
  }
  try {
    // first-login answers the business failure until the test flips it: a
    // failing renewal writes no mark, so the setup's renewal and the
    // event's each ask once, whoever runs first — two asks being the
    // signature of both having run
    let success = false
    up.route("GET /api/v1/models", () => json({ data: [{ id: "auto", name: "自动 · 均衡", type: "chat" }] }))
    up.route("POST /api/v1/points/first-login", () => json(success ? { code: "000000", data: {} } : { code: "100001", desc: "not yet" }))
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok" }),
    }
    const { ctx, storage } = fakeCtx(connection, [{ type: "credential.updated" }])
    const asks = () => up.seen.filter((r) => r.path === "/api/v1/points/first-login").length
    const cleanup = await loomy.setup(ctx)
    assert.equal(timers.length, 1, "one renewal timer was started")
    assert.equal(timers[0].ms, 30 * 60_000)
    await waitUntil(() => asks() === 2) // both renewals asked — setup's and the event's
    // from here on the day renews for real: the next call asks once more and
    // the mark lands, and the call after it finds the mark and asks nothing
    success = true
    await _internal.v2Renew(ctx)
    assert.equal(asks(), 3)
    assert.equal(storage.get("loomy-auth/renewal/last"), _internal.v2BeijingDay(Date.now()))
    await _internal.v2Renew(ctx)
    assert.equal(asks(), 3, "a marked day asks nothing")
    cleanup()
    assert.deepEqual(cleared, [timers[0].handle], "the cleanup cleared the renewal timer")
  } finally {
    globalThis.setInterval = realSet
    globalThis.clearInterval = realClear
    await up.close()
    restore()
  }
})

// ---- the /loomy panel -----------------------------------------------------------------

// a fake of the TUI host context beside the server one: the same base
// domains, plus the panel's own — a keymap recording every layer's factory,
// a dialog whose select answers the queued picks in order (an empty queue
// is the Esc) and records every open, an alert and a toast recorded alike.
// The DSL drives headless in Node, so the panel's loop is tested the way it
// runs: a command's run() walked against queued answers, no renderer.
const fakeTuiCtx = (connection, picks = []) => {
  const base = fakeCtx(connection)
  const seen = {
    layers: [], // the keymap layers' factories
    opens: [], // every dialog open: ["select" | "alert", its options]
    toasts: [], // every toast show
  }
  const ctx = {
    ...base.ctx,
    keymap: {
      layer: (factory) => seen.layers.push(factory),
    },
    ui: {
      dialog: {
        select: async (options) => {
          seen.opens.push(["select", options])
          return picks.length ? picks.shift() : undefined
        },
        alert: async (options) => seen.opens.push(["alert", options]),
      },
      toast: {
        show: (toast) => seen.toasts.push(toast),
      },
    },
  }
  return { ctx, seen, storage: base.storage }
}

test("the tui module is a v2 tui definition and a host without the keymap domain loads it to nothing", async () => {
  // the shape the v2 TUI's isPlugin reads: a default export whose id is a
  // non-empty string and whose setup is a function
  assert.equal(tui.id, "loomy-auth")
  assert.equal(typeof tui.setup, "function")
  // the defensive load: no keymap domain, no panel, no throw, no cleanup
  assert.equal(await tui.setup({}), undefined)
})

test("the panel's data layer: usageOf reads the records answer into the numbers the rows show", () => {
  // the records answer's own size is the fallback path — the older answer
  // shape, an answer that carries dailyQuota beside the remaining. It wins
  // over any note when it is there (the usageOf read's own floor), but the
  // upstream the repository has observed ships the remaining alone, so the
  // panel's size ordinarily travels the other sources: the credential's
  // fields, the renewal's storage note, the file note
  const payload = { code: "000000", data: { data: { balance: 8000, dailyBalance: 3011, dailyQuota: 5000 } } }
  const card = _internal.usageOf(payload, 5000, "2999-01-01")
  assert.equal(card.balance, "11011 积分") // 8000 permanent + the grant's remaining
  const daily = card.windows[0]
  assert.equal(daily.name, "每日赠送")
  assert.equal(daily.display, "3011 / 5000 积分") // the remaining over the size
  assert.equal(daily.used, Math.round(((5000 - 3011) / 5000) * 100))
  // the reset moment: the next Beijing midnight of the cycle date — far
  // enough out that no roll-forward can touch it (a cycle date already past
  // rolls forward, the card never reading "already reset")
  assert.equal(daily.resetsAt, "2999-01-01T16:00:00.000Z")
  // today's cycle date reads a reset that is still ahead
  const today = _internal.usageOf(payload, 5000, _internal.v2BeijingDay(Date.now()))
  assert.ok(Date.parse(today.windows[0].resetsAt) > Date.now(), "today's reset is ahead")
  // the quota the answer names wins over the note — a bare answer without
  // one shows the note's size (the renewal's storage note or the file note,
  // what the panel reads behind the credential), and with neither, no share
  // is invented: the remaining stands alone, labeled as the remaining it is
  const bare = _internal.usageOf({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011 } } }, undefined, undefined)
  assert.equal(bare.windows[0].display, "剩余 3011 积分")
  assert.equal(bare.windows[0].used, 0)
  const noted = _internal.usageOf({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011 } } }, 5000, undefined)
  assert.equal(noted.windows[0].display, "3011 / 5000 积分")
  // the permanent row set aside, always zero of a window to consume
  assert.deepEqual(
    { name: card.windows[1].name, used: card.windows[1].used, aside: card.windows[1].aside },
    { name: "永久积分", used: 0, aside: true }
  )
})

test("the panel: /loomy opens, the check-in asks first-login, its wording comes back, Esc closes", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // the records answer the real upstream ships: the remaining alone, no
    // size riding with it — the panel's size must come from elsewhere
    // (the renewal's storage note here, the credential's fields or the
    // file note behind them)
    up.route("GET /api/v2/points/records", () =>
      json({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011 } } })
    )
    up.route("POST /api/v1/points/first-login", () =>
      json({ code: "000000", data: { data: { dailyQuota: 5000, dailyConsumed: 1989, dailyBalance: 3011, dailyCycleDate: "2999-01-01" } } })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok", metadata: { accountId: "138****8000" } }),
    }
    // the pick queue: check in, then Esc — one full loop of the panel
    const { ctx, seen, storage } = fakeTuiCtx(connection, ["checkin", undefined])
    // the renewal runs first, as the server side's setup runs it before any
    // panel opens: its success notes the grant's size in the host's storage
    // — the pure-v2 account's own source, the metadata carrying no fields
    // of its own and the records answer no size at all
    await _internal.v2Renew(ctx)
    assert.deepEqual(storage.get("loomy-auth/quota-size"), { dailyQuota: 5000, dailyCycleDate: "2999-01-01" })
    assert.equal(await tui.setup(ctx), undefined, "the panel owns no timer, so the setup hands back no cleanup")
    assert.equal(seen.layers.length, 1, "one keymap layer went in")
    const command = seen.layers[0]().commands.find((c) => c.slash?.name === "loomy")
    assert.ok(command, "the layer carries the /loomy command")
    assert.equal(command.palette, true, "the command is palette-reachable")
    await command.run()
    // the reads: once before the check-in, once after it — the loop's
    // re-read — the session in both headers the gateway reads
    const reads = up.seen.filter((r) => r.method === "GET" && r.path === "/api/v2/points/records")
    assert.equal(reads.length, 2, "the panel read the records call before and after the check-in")
    assert.equal(reads[0].headers.authorization, "Bearer tok")
    assert.equal(reads[0].headers.token, "tok")
    // the check-in action: the same first-login call, its body the empty object
    const asks = up.seen.filter((r) => r.method === "POST" && r.path === "/api/v1/points/first-login")
    assert.equal(asks.length, 2, "the renewal's ask and the check-in's went out")
    assert.deepEqual(asks[1].json, {}) // the panel's own ask
    // its wording on an alert: the claim reader's own message
    const alert = seen.opens.find((o) => o[0] === "alert")
    assert.ok(alert, "the check-in's wording came back")
    assert.ok(alert[1].message.includes("每日赠送积分已刷新"), "the claim's own wording")
    // the first open carried the state rows and the two actions
    const open = seen.opens[0]
    assert.equal(open[0], "select")
    const options = open[1].options
    assert.ok(
      options.some((o) => o.title.includes("已登录") && o.title.includes("138****8000")),
      "the sign-in state row carries the masked phone"
    )
    assert.ok(options.some((o) => o.title.includes("积分总额")), "the points-total row")
    const dailyRow = options.find((o) => o.title.includes("每日赠送"))
    assert.ok(dailyRow, "the daily-grant row")
    // the size is the storage note's — the panel read the renewal's write,
    // the records answer carrying the remaining alone
    assert.ok(dailyRow.description.includes("3011 / 5000"), "remaining over size in the description")
    assert.match(dailyRow.description, /北京时间 \d{2}-\d{2} \d{2}:\d{2} 重置/, "the reset moment in Beijing time")
    assert.ok(options.some((o) => o.title === "立即签到"), "the check-in action")
    assert.ok(options.some((o) => o.title === "刷新"), "the refresh action")
    for (const option of options) {
      if (option.value === "checkin" || option.value === "refresh") {
        assert.ok(!option.disabled, `${option.title} is an action`)
      } else {
        assert.equal(option.disabled, true, `${option.title} is a readout`)
      }
    }
    assert.equal(seen.opens.length, 3, "select, alert, select — then the Esc closed the loop")
  } finally {
    await up.close()
    restore()
  }
})

test("the panel's fallback: a records answer carrying its own size answers when no note stands", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // the older answer shape: the size riding the records answer itself —
    // the usageOf read's own floor, standing in when neither the
    // credential's fields nor any note was written
    up.route("GET /api/v2/points/records", () =>
      json({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011, dailyQuota: 5000 } } })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok", metadata: { accountId: "138****8000" } }),
    }
    const { ctx, seen, storage } = fakeTuiCtx(connection, [undefined])
    assert.equal(storage.size, 0, "no note was written by anything")
    await tui.setup(ctx)
    await seen.layers[0]().commands[0].run()
    const dailyRow = seen.opens[0][1].options.find((o) => o.title.includes("每日赠送"))
    assert.ok(dailyRow, "the daily-grant row")
    assert.ok(dailyRow.description.includes("3011 / 5000"), "the answer's own size answers")
  } finally {
    await up.close()
    restore()
  }
})

test("the panel with no size anywhere: the remaining stands alone, labeled as the remaining it is", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // neither a note anywhere (no renewal ran, no check-in wrote, the
    // credential's metadata carries no fields) nor a size on the answer:
    // no share is invented
    up.route("GET /api/v2/points/records", () =>
      json({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011 } } })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok", metadata: { accountId: "138****8000" } }),
    }
    const { ctx, seen, storage } = fakeTuiCtx(connection, [undefined])
    assert.equal(storage.size, 0, "no note was written by anything")
    await tui.setup(ctx)
    await seen.layers[0]().commands[0].run()
    const dailyRow = seen.opens[0][1].options.find((o) => o.title.includes("每日赠送"))
    assert.ok(dailyRow, "the daily-grant row")
    assert.ok(dailyRow.description.includes("剩余 3011 积分"), "the remaining alone, labeled as the remaining")
    assert.ok(!dailyRow.description.includes("/"), "no share was invented")
  } finally {
    await up.close()
    restore()
  }
})

test("the panel without a connection opens showing the signed-out row and asks nothing anywhere", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    const { ctx, seen } = fakeTuiCtx(undefined, [undefined])
    await tui.setup(ctx)
    await seen.layers[0]().commands[0].run()
    assert.equal(seen.opens[0][0], "select")
    assert.ok(seen.opens[0][1].options[0].title.includes("未登录"), "the signed-out row")
    assert.ok(seen.opens[0][1].options.some((o) => o.title === "刷新"), "the panel still opens on its refresh action")
    assert.equal(up.seen.length, 0, "no ask went anywhere")
    assert.equal(seen.opens.length, 1, "the immediate Esc closed the loop")
  } finally {
    await up.close()
    restore()
  }
})

// ---- the desktop panel -----------------------------------------------------------------
//
// The ./gui-experimental bundle is a hand-written CommonJS file the desktop
// app loads into its windows (the recon's reading of the host's loader: the
// code evaluated as text, the app's own require beside it, the default
// export's setup the only thing that runs). What a window runs — DOM under
// Solid — a Node test cannot; what the bundle carries besides it, the
// tests hold here: the contract literal beside the server's, the Beijing
// formatting, the readout-to-rows read, and the load itself (a bare context
// answers nothing, no throw — the requires sit inside setup, so the
// require-free top level is what lets this file load in Node at all).

test("the desktop panel's bundle: a CommonJS module that loads in Node, its default a bare setup", () => {
  assert.equal(typeof guiBundle.default.setup, "function", "the default export's setup is what the loader validates")
  assert.equal(guiBundle.default.setup({}), undefined, "no Solid, no gui module, no add domain — a silent load, no throw")
  assert.equal(typeof guiBundle.beijingTimeOf, "function")
  assert.equal(typeof guiBundle.rowsOf, "function")
})

test("the desktop panel's bundle carries the server rpc's contract, letter for letter", () => {
  assert.deepEqual(guiBundle.CONTRACT, _internal.V2_RPC, "the two literals agree — the wire's id and methods cannot drift")
  assert.equal(guiBundle.CONTRACT.id, "loomy-auth-quota")
  assert.deepEqual(Object.keys(guiBundle.CONTRACT.methods).sort(), ["checkin", "status"])
})

test("the desktop panel's formatting: beijingTimeOf renders the reset moment as Beijing's MM-DD HH:mm", () => {
  assert.equal(guiBundle.beijingTimeOf("2999-01-01T16:00:00.000Z"), "01-02 00:00", "the same 8-hour shift the cycle arithmetic keeps")
  assert.equal(guiBundle.beijingTimeOf("2999-06-15T12:30:00.000Z"), "06-15 20:30")
  assert.equal(guiBundle.beijingTimeOf("not a moment"), undefined)
  assert.equal(guiBundle.beijingTimeOf(undefined), undefined)
})

test("the desktop panel's rows: one status readout to the words the panel shows, every state a column", () => {
  // no readout at all, a read in flight
  assert.deepEqual(guiBundle.rowsOf(undefined), [{ key: "state", text: "登录状态：未登录（用 /connect 或 opencode auth login 登录）" }])
  assert.equal(guiBundle.rowsOf({ loading: true })[0].text, "正在读取…")
  // a refused ask: one failed row, worded
  assert.deepEqual(guiBundle.rowsOf({ failed: "Failed to fetch" }), [{ key: "state", text: "读取失败：Failed to fetch" }])
  // signed out, and the dead sign-in's row
  assert.equal(guiBundle.rowsOf({ signedIn: false, expired: false }).length, 1)
  assert.ok(guiBundle.rowsOf({ signedIn: false, expired: true })[0].text.includes("已过期"), "the expired row")
  // a full readout: state, total, daily, reset — the TUI panel's rows in a column
  const rows = guiBundle.rowsOf({
    signedIn: true,
    expired: false,
    accountId: "138****8000",
    card: {
      balance: "11011 积分",
      windows: [{ display: "3011 / 5000 积分", resetsAt: "2999-01-01T16:00:00.000Z" }],
    },
  })
  assert.deepEqual(
    rows.map((r) => r.text),
    ["登录状态：已登录（138****8000）", "积分总额：11011 积分", "每日赠送：3011 / 5000 积分", "北京时间 01-02 00:00 重置"]
  )
  // an unparseable reset moment reads as no reset row, never a wrong one
  const noReset = guiBundle.rowsOf({
    signedIn: true,
    expired: false,
    card: { balance: "1 积分", windows: [{ display: "0 积分", resetsAt: "not a moment" }] },
  })
  assert.ok(!noReset.some((r) => r.key === "reset"), "no reset row without a parseable moment")
  // a bad answer rides beside the state
  const withError = guiBundle.rowsOf({ signedIn: true, expired: false, error: "积分查询失败（上游 code=9）" })
  assert.equal(withError[0].key, "state")
  assert.equal(withError[1].key, "error")
  assert.equal(withError[1].text, "积分查询失败（上游 code=9）")
})

test("the setup registers the desktop panel's rpc: the contract and the two methods, given up at cleanup", async () => {
  const { ctx, seen } = fakeCtx()
  let registered
  ctx.rpc = {
    register: async (def, handlers) => {
      registered = { def, handlers }
      return { dispose: () => seen.disposals.push("rpc") }
    },
  }
  const cleanup = await loomy.setup(ctx)
  assert.ok(registered, "the registration went in")
  assert.deepEqual(registered.def, _internal.V2_RPC, "the contract as the server side spells it")
  assert.equal(typeof registered.handlers.status, "function")
  assert.equal(typeof registered.handlers.checkin, "function")
  const nobody = await registered.handlers.status({})
  assert.equal(nobody.signedIn, false, "no connection, no readout — answered as data, not a throw")
  assert.equal(nobody.expired, false)
  await cleanup()
  assert.ok(seen.disposals.includes("rpc"), "the registration's disposal rides among the cleanups")
})

test("the desktop panel's rpc handlers: the status off the records call, the check-in off first-login, the size noted behind it", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // the records answer the real upstream ships, the size riding with it
    // here — the usageOf read's own floor; the first-login answer carries
    // the same size, the claim's arithmetic in full
    up.route("GET /api/v2/points/records", () =>
      json({ code: "000000", data: { data: { balance: 8000, dailyBalance: 3011, dailyQuota: 5000 } } })
    )
    up.route("POST /api/v1/points/first-login", () =>
      json({ code: "000000", data: { data: { dailyQuota: 5000, dailyConsumed: 1989, dailyBalance: 3011, dailyCycleDate: "2999-01-01" } } })
    )
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok", metadata: { accountId: "138****8000" } }),
    }
    const { ctx, storage } = fakeCtx(connection)
    const status = await _internal.v2QuotaStatus(ctx)
    assert.equal(status.signedIn, true)
    assert.equal(status.expired, false)
    assert.equal(status.accountId, "138****8000")
    assert.equal(status.card.balance, "11011 积分") // 8000 permanent + the grant's remaining
    assert.equal(status.card.windows[0].display, "3011 / 5000 积分")
    assert.ok(Date.parse(status.card.windows[0].resetsAt) > Date.now(), "the reset moment ahead")
    const claim = await _internal.v2QuotaCheckin(ctx)
    assert.equal(claim.outcome, "claimed")
    assert.ok(claim.message.includes("每日赠送积分已刷新"), "the claim's own wording")
    assert.deepEqual(storage.get("loomy-auth/quota-size"), { dailyQuota: 5000, dailyCycleDate: "2999-01-01" }, "the size noted behind the claim")
    const asks = up.seen.filter((r) => r.method === "POST" && r.path === "/api/v1/points/first-login")
    assert.equal(asks.length, 1, "one first-login ask")
    assert.deepEqual(asks[0].json, {})
    const reads = up.seen.filter((r) => r.method === "GET" && r.path === "/api/v2/points/records")
    assert.equal(reads.length, 1)
    assert.equal(reads[0].headers.authorization, "Bearer tok")
    assert.equal(reads[0].headers.token, "tok")
  } finally {
    await up.close()
    restore()
  }
})

test("the desktop panel's rpc handlers: no connection reads signed out, a dead sign-in reads expired, both as data", async () => {
  const up = await fakeLoomy()
  const restore = pointAt(up.origin)
  try {
    // the records answer's own verdict of a dead sign-in — the business
    // code, not an HTTP refusal, so the read answers expired as data
    up.route("GET /api/v2/points/records", () => json({ code: "020002", message: "登录失效" }))
    const { ctx } = fakeCtx()
    const nobody = await _internal.v2QuotaStatus(ctx)
    assert.equal(nobody.signedIn, false)
    assert.equal(nobody.expired, false)
    const connection = {
      active: async () => ({ integrationID: "loomy", id: "conn-1" }),
      resolve: async () => ({ type: "oauth", access: "tok", metadata: { accountId: "138****8000" } }),
    }
    const { ctx: withConn } = fakeCtx(connection)
    const dead = await _internal.v2QuotaStatus(withConn)
    assert.equal(dead.signedIn, false, "the dead sign-in reads as signed out")
    assert.equal(dead.expired, true, "with the expired marker")
    // the claim without a connection: the expired wording, as data
    const { ctx: claimless } = fakeCtx(undefined)
    const claim = await _internal.v2QuotaCheckin(claimless)
    assert.equal(claim.outcome, "failed")
    assert.ok(claim.message.includes("登录态已失效"), "the expired wording")
    assert.equal(up.seen.length, 1, "the only ask was the dead read's own records call")
    assert.equal(up.seen.filter((r) => r.method === "POST" && r.path === "/api/v1/points/first-login").length, 0, "the claimless ask never went out")
  } finally {
    await up.close()
    restore()
  }
})
