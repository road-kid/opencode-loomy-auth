// The opencode v2 adapter, against fakes the whole way: the default export's
// shape beside the V1 named one, the registrations the setup makes on a fake
// host context (the integration's name and phone-code method, the provider's
// info and rows), the sign-in re-wrapped into the v2 credential shape, the
// live model list behind a signed-in connection and the snapshot behind none
// or a refused ask, an empty context loading to a cleanup alone, and the
// registrations — the event subscription's abort among them — given up at
// cleanup.
import "./nonet.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import loomy, { LoomyAuthPlugin } from "./index.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

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
  const ctx = {
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
  return { ctx, seen }
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
    assert.equal(typeof deepseek.capabilities.tools, "boolean")
    assert.deepEqual(deepseek.capabilities.input, ["text", "image"]) // a vision row
    assert.deepEqual(deepseek.capabilities.output, ["text"])
    assert.equal(deepseek.limit.context, 1048576)
    assert.equal(deepseek.cost[0].cache.read, 0)
    assert.equal(deepseek.cost[0].cache.write, 0)
    assert.equal(deepseek.status, "active")
    assert.equal(deepseek.enabled, true)
    assert.equal(typeof deepseek.time.released, "number")
    // the reasoning efforts ride as variants: the body overlay the host
    // merges into the request, the gateway's own camelCase spelling
    assert.deepEqual(deepseek.variants, [
      { id: "low", body: { reasoningEffort: "low" } },
      { id: "medium", body: { reasoningEffort: "medium" } },
      { id: "high", body: { reasoningEffort: "high" } },
    ])
    assert.equal(deepseek.rate, undefined) // the v2 record has no field for it
    assert.equal(deepseek.free, undefined)
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
    up.route("GET /api/v1/models", () =>
      json({ data: [{ id: "live-model-a", name: "Live A", type: "chat", context_length: 4096, max_output_tokens: 1024 }] })
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
      ["live-model-a"] // the live row alone: no snapshot rows, no image generators
    )
    assert.equal(models[0].limit.context, 4096)
    assert.equal(models[0].limit.output, 1024)
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
