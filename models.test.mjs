// The model catalog: parseModels reading the model gateway's /api/v1/models
// answer (the OpenAI {data:[…]} envelope or the bare array), the capability
// bits as the gateway's own catalog maps them, the point rate riding the
// display name's tail, and the two shapes a model record is spelled in — the
// config hook's fallback table with tool_call's underscore, the models hook's
// ModelInfo with capabilities and the cost's nested cache — with the fallback
// table answering whenever the live list can't be had.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { LoomyAuthPlugin, _internal } from "./index.mjs"
import { fakeLoomy, json, pointAt, text } from "./fake.mjs"

let f
let restore
beforeEach(async () => {
  f = await fakeLoomy()
  restore = pointAt(f.origin)
})
afterEach(async () => {
  restore()
  await f.close()
})

test("parseModels reads the {data:[…]} envelope and the bare array alike", () => {
  const row = { id: "m1", name: "M One (x2.5)" }
  assert.deepEqual(_internal.parseModels({ data: [row] }), _internal.parseModels([row]))
  const [one] = _internal.parseModels({ data: [row] })
  assert.deepEqual(one, { id: "m1", name: "M One", rate: "x2.5", free: false, toolcall: true, reasoning: false, vision: false, context: undefined, output: undefined })
  assert.deepEqual(_internal.parseModels({ data: [] }), [])
  assert.deepEqual(_internal.parseModels(undefined), [])
  assert.deepEqual(_internal.parseModels({}), [])
  // a row without an id is dropped; an id is trimmed; a missing name shows the id
  assert.deepEqual(_internal.parseModels([{ name: "no id" }, { id: "  m2  " }]), [
    { id: "m2", name: "m2", rate: undefined, free: false, toolcall: true, reasoning: false, vision: false, context: undefined, output: undefined },
  ])
})

test("the context and output limits read each of the candidate keys", () => {
  const ctx = ["context_length", "context_window", "input_token_limit", "max_input_tokens", "maxInputTokens"] // five
  for (const key of ctx) {
    assert.equal(_internal.parseModels([{ id: "c", [key]: 131072 }])[0].context, 131072, key)
  }
  const out = ["max_output_tokens", "max_completion_tokens", "max_tokens", "maxOutputTokens"] // four
  for (const key of out) {
    assert.equal(_internal.parseModels([{ id: "o", [key]: 8192 }])[0].output, 8192, key)
  }
  // a quoted number reads as the number; a non-numeric or non-positive one as missing
  assert.equal(_internal.parseModels([{ id: "q", context_length: "65536" }])[0].context, 65536)
  assert.equal(_internal.parseModels([{ id: "n", context_length: "big" }])[0].context, undefined)
  assert.equal(_internal.parseModels([{ id: "z", context_length: 0 }])[0].context, undefined)
})

test("toolcall's default is the missing capabilities object alone (B5)", () => {
  assert.equal(_internal.parseModels([{ id: "a" }])[0].toolcall, true) // no capabilities at all: the compatible default
  assert.equal(_internal.parseModels([{ id: "b", capabilities: {} }])[0].toolcall, false) // a present object without the key says no
  assert.equal(_internal.parseModels([{ id: "c", capabilities: { function_calling: true } }])[0].toolcall, true)
  assert.equal(_internal.parseModels([{ id: "d", capabilities: { function_calling: false } }])[0].toolcall, false)
})

test("reasoning is the capabilities' own bit or a spark-x name (B6)", () => {
  assert.equal(_internal.parseModels([{ id: "spark-x" }])[0].reasoning, true)
  assert.equal(_internal.parseModels([{ id: "Spark-X2.5", capabilities: { reasoning: false } }])[0].reasoning, true)
  assert.equal(_internal.parseModels([{ id: "other", capabilities: { reasoning: true } }])[0].reasoning, true)
  assert.equal(_internal.parseModels([{ id: "other" }])[0].reasoning, false)
  assert.equal(_internal.parseModels([{ id: "sparkle-1" }])[0].reasoning, false) // "spark-x" is the name, not a prefix
})

test("vision is the capabilities' own bit or image among the input modalities", () => {
  assert.equal(_internal.parseModels([{ id: "v1", capabilities: { vision: true } }])[0].vision, true)
  assert.equal(_internal.parseModels([{ id: "v2", capabilities: { input_modalities: ["TEXT", "Image"] } }])[0].vision, true)
  assert.equal(_internal.parseModels([{ id: "v3", capabilities: { input_modalities: ["text"] } }])[0].vision, false)
  assert.equal(_internal.parseModels([{ id: "v4" }])[0].vision, false)
})

test("the point rate rides the display name's tail, ASCII or full-width; other tails are no rate", () => {
  assert.deepEqual(_internal.splitRateSuffix("DeepSeek V4 Flash 0731 (x3.0)"), { name: "DeepSeek V4 Flash 0731", rate: "x3.0" })
  assert.deepEqual(_internal.splitRateSuffix("GLM 5.3 Flash(x0.8)"), { name: "GLM 5.3 Flash", rate: "x0.8" })
  assert.deepEqual(_internal.splitRateSuffix("Spark X2.5（x0.1）"), { name: "Spark X2.5", rate: "x0.1" })
  assert.deepEqual(_internal.splitRateSuffix("Model (X2)"), { name: "Model", rate: "x2" }) // a capital X counts
  assert.deepEqual(_internal.splitRateSuffix("Model（限时免费）"), { name: "Model（限时免费）", rate: undefined }) // not a rate: stays in the name
  assert.deepEqual(_internal.splitRateSuffix("(x9)"), { name: "(x9)", rate: "x9" }) // the rate is taken, the name keeps itself whole: no empty display names
  assert.deepEqual(_internal.splitRateSuffix(""), { name: "", rate: undefined })
  // through parseModels the split lands in the record, out of the name
  const [m] = _internal.parseModels([{ id: "d", name: "DeepSeek V4 Flash 0731 (x3.0)" }])
  assert.equal(m.name, "DeepSeek V4 Flash 0731")
  assert.equal(m.rate, "x3.0")
})

test("the config hook's fallback table is the tool_call shape (F3), with the efforts spelled out (F4)", async () => {
  const hooks = await LoomyAuthPlugin({ client: {} })
  const config = {}
  await hooks.config(config)
  const p = config.provider.loomy
  assert.equal(p.name, "Loomy")
  assert.equal(p.npm, "@ai-sdk/openai-compatible")
  assert.equal(p.api, f.origin + "/api/v1")
  assert.equal(Object.keys(p.models).length, _internal.FALLBACK_MODELS.length) // the web plane's ten
  const spark = p.models["spark-x"]
  assert.equal(spark.id, "spark-x")
  assert.equal(spark.name, "Spark X2.5")
  assert.equal(spark.tool_call, true) // the underscore spelling this table reads
  assert.ok(!("toolcall" in spark) && !("capabilities" in spark), "no ModelInfo keys in the config shape")
  assert.equal(spark.reasoning, true)
  assert.equal(spark.attachment, false)
  assert.deepEqual(spark.modalities, { input: ["text"], output: ["text"] })
  assert.deepEqual(spark.limit, { context: 0, output: 0 })
  assert.deepEqual(spark.cost, { input: 0, output: 0 })
  assert.deepEqual(spark.variants, { low: { reasoningEffort: "low" }, medium: { reasoningEffort: "medium" }, high: { reasoningEffort: "high" } })
  // the plain models carry the efforts too, and a second run clobbers nothing
  assert.deepEqual(p.models["MiniMax-M3"].variants, spark.variants)
  p.name = "Mine"
  await hooks.config(config)
  assert.equal(config.provider.loomy.name, "Mine")
})

test("the models hook answers the ModelInfo shape off the live list (F3/F4)", async () => {
  f.route("GET /api/v1/models", () =>
    json({
      data: [
        {
          id: "GLM-5.3-Flash",
          name: "GLM 5.3 Flash(x0.8)",
          context_length: 131072,
          max_output_tokens: 8192,
          capabilities: { function_calling: true },
        },
      ],
    })
  )
  const hooks = await LoomyAuthPlugin({ client: {} })
  const fallback = { keep: "me" }
  const out = await hooks.provider.models({ id: "loomy", models: fallback }, { auth: { access: "tok" } })
  assert.equal(Object.keys(out).length, 1)
  const m = out["GLM-5.3-Flash"]
  assert.equal(m.id, "GLM-5.3-Flash")
  assert.equal(m.providerID, "loomy")
  assert.equal(m.name, "GLM 5.3 Flash") // the rate is out of the name
  assert.deepEqual(m.api, { id: "GLM-5.3-Flash", url: f.origin + "/api/v1/chat/completions", npm: "@ai-sdk/openai-compatible" })
  assert.deepEqual(m.capabilities, { toolcall: true, reasoning: false, attachment: false }) // no underscore here
  assert.deepEqual(m.cost, { input: 0, output: 0, cache: { read: 0, write: 0 } }) // the cache keys nested
  assert.deepEqual(m.limit, { context: 131072, output: 8192 })
  assert.deepEqual(m.variants, { low: { reasoningEffort: "low" }, medium: { reasoningEffort: "medium" }, high: { reasoningEffort: "high" } })
  assert.ok(!("tool_call" in m), "no config keys in the ModelInfo shape")
  // the ask went out with the session's two headers and no signature
  const r = f.seen.find((x) => x.path === "/api/v1/models")
  assert.equal(r.headers.token, "tok")
  assert.equal(r.headers.authorization, "Bearer tok")
  assert.ok(!r.headers["content-md5"], "the account plane's signature never reaches the gateway")
})

test("an empty, failing or unparseable live list falls back to the table it was given", async () => {
  const hooks = await LoomyAuthPlugin({ client: {} })
  const fallback = { keep: "me" }
  const ask = () => hooks.provider.models({ id: "loomy", models: fallback }, { auth: { access: "tok" } })
  f.route("GET /api/v1/models", () => json({ data: [] })) // empty: no models are invented
  assert.equal(await ask(), fallback)
  f.route("GET /api/v1/models", () => json({ boom: true }, 500)) // HTTP-level failure
  assert.equal(await ask(), fallback)
  f.route("GET /api/v1/models", () => text("not json")) // unparseable
  assert.equal(await ask(), fallback)
  assert.equal(f.seen.length, 3)
})

test("no session asks nothing and answers the fallback", async () => {
  const hooks = await LoomyAuthPlugin({ client: {} })
  const fallback = { keep: "me" }
  assert.equal(await hooks.provider.models({ id: "loomy", models: fallback }, { auth: {} }), fallback)
  assert.equal(f.seen.length, 0)
})

test("a dead session is passed on, not papered over with the fallback", async () => {
  f.route("GET /api/v1/models", () => json({}, 401))
  const hooks = await LoomyAuthPlugin({ client: {} })
  await assert.rejects(hooks.provider.models({ id: "loomy", models: {} }, { auth: { access: "tok" } }), (e) => e.signIn === "expired")
})

test("free is the upstream's own declaration, nothing inferred", () => {
  const rows = [
    { id: "spark-free", name: "Spark-X2.6 正式版(限时免费)(x0.0)" }, // the words, and a zero rate
    { id: "spark-zero", name: "Thing （x0.0）" }, // the zero rate alone
    { id: "paid", name: "Paid (x0.8)" }, // a real rate is never free
    { id: "unrated", name: "Plain One" }, // no declaration at all is not free either
  ]
  const by = Object.fromEntries(_internal.parseModels(rows).map((m) => [m.id, m.free]))
  assert.deepEqual(by, { "spark-free": true, "spark-zero": true, paid: false, unrated: false })
})

test("a row that isn't a chat model is no choice to offer", () => {
  const rows = [
    { id: "chat-one", type: "chat", name: "One" },
    { id: "image-one", type: "image", name: "Drawer" }, // selecting it is selecting a failure
    { id: "no-type", name: "Typeless" }, // the answer has also shipped rows with no type at all
  ]
  assert.deepEqual(
    _internal.parseModels(rows).map((m) => m.id),
    ["chat-one", "no-type"]
  )
})
