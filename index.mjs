// OpenCode provider plugin for a Loomy (iFlytek) account: the account signs
// in with Loomy's phone-code sign-in (a short text-message code, good for
// fourteen days with no way to renew), its chats are OpenAI-compatible ones
// at Loomy's model gateway, sent with the session token, and the account's
// points (the permanent balance and the daily grant) and the daily
// first-login refresh land on the Usage card. The phone-code sign-in — with
// the HMAC-SHA1 signature every request to Loomy's account host carries — is
// in; the gateway forwarding and its error translation are in; the live
// model list, with the web plane's fallback table behind it, is in; the
// points card (the permanent balance and the daily grant) and the daily
// first-login refresh are in; the newcomer tasks — the one-time purse the
// check-in claims beside the grant — are in.

// Loomy has three planes: the CAccount host (signing in, every request
// HMAC-signed), the integration gateway (points and the daily first-login,
// the session token in a plain header) and the model gateway
// ({integration}/api/v1, OpenAI-compatible, the token sent twice: as
// "token:" and as "Authorization: Bearer"). Their hosts and the signing
// keys are read when asked, not when this module loads, so tests can point
// them at fakes of their own by setting the environment.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ID = "loomy"
const NPM = "@ai-sdk/openai-compatible" // the OpenAI Chat shape Loomy's gateway speaks
const SUCCESS = "000000" // the business code every Loomy plane answers success with
const AUTH_CODES = new Set(["020002", "100002"]) // the sign-in is no longer valid
const SESSION_MS = 14 * 86400_000 // a phone-code session's life; Loomy offers no refresh

// the CAccount host, where the phone-code sign-in goes
const xfyunBase = () => (process.env.LOOMY_XFYUN_BASE_URL || "https://account.xfinfr.com").replace(/\/+$/, "")
// the integration gateway, where the points and the daily first-login live
const integrationBase = () => (process.env.LOOMY_POINTS_BASE_URL || "https://loomyad.xunfei.cn").replace(/\/+$/, "")
// the model gateway: OpenAI-compatible /models and /chat/completions
const apiBase = () => integrationBase() + "/api/v1"
// the signing pair the account plane's requests sign with; both halves are
// read when a sign-in is about to ask, so the environment can override
// either half at any time
const keyId = () => process.env.LOOMY_XFYUN_ACCESS_KEY_ID || "2thryby66wxi53sk"
const keySecret = () => process.env.LOOMY_XFYUN_ACCESS_KEY_SECRET || "zsak6eadrbawz683wf5r3m2snrwj868r"

// ---- the model catalog ------------------------------------------------------------
// The model gateway has a live /api/v1/models answer; the table below is a
// snapshot of that catalog as measured live on 2026-10-28, a first install's
// guide until the answer can be had (and the fallback whenever it can't) —
// the live list is the only source of truth and wins the moment it answers.
// The image generators the gateway also lists are not chat choices:
// parseModels keeps every such row off the chat list (by its type, and by
// the generator's name it carries — the same words the host's own
// image-model catalog reads, for the row that ships no type at all), and
// the roster below puts back the generators this plugin vouches for, each
// only while the live catalog still names it. The fallback keeps to the
// chat models: with no live answer there is no proof a generator still
// exists, and a dead draw entry is what the roster exists to prevent. The rates and the free bits are
// copied as the upstream declares them, and a missing toolcall bit — auto's
// record carries none — still reads as the OpenAI-compatible default, tools
// on, the way the two shapes below spell it.

const FALLBACK_MODELS = [
  { id: "spark-x2.6", name: "Spark-X2.6 正式版(限时免费)", rate: "x0.0", free: true, context: 1048576, output: 131072, reasoning: true },
  { id: "spark-x", name: "Spark-X2.5（限时免费）", rate: "x0.0", free: true, context: 1048576, output: 65536, reasoning: true },
  { id: "DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash", rate: "x2.0", context: 1048576, output: 384000, reasoning: true, vision: true },
  { id: "MiniMax-M3", name: "MiniMax M3", rate: "x4.0", context: 1048576, output: 512000, reasoning: true, vision: true },
  { id: "Kimi-k2.6", name: "Kimi k2.6", rate: "x6.5", context: 262144, output: 65536, reasoning: true, vision: true },
  { id: "qwen-3.8-max", name: "Qwen 3.8 Max", rate: "x12.0", context: 1000000, output: 65536, reasoning: true },
  { id: "GLM-5.3-Flash", name: "GLM 5.3 Flash", rate: "x0.8", context: 1048576, output: 131072, reasoning: true, vision: true },
  { id: "qwen3.8-flash", name: "qwen 3.8 flash", rate: "x0.8", context: 1000000, output: 131072, reasoning: true, vision: true },
  { id: "mimo-v2.5", name: "MiMo V2.5", rate: "x3.3", context: 1048576, output: 131072, reasoning: true, vision: true },
  { id: "auto", name: "自动 · 均衡" },
]

// Every model carries the same three reasoning efforts: an empty variants
// object does nothing, and the upstream ignores the field on the models
// that don't think — a known behavior, the reason even the plain models
// hang the levels here, each spelled out the way the client sends it.
const VARIANTS = Object.fromEntries(["low", "medium", "high"].map((effort) => [effort, { reasoningEffort: effort }]))

// The model gateway prints its point rate as a suffix on the display name —
// "DeepSeek V4 Flash 0731 (x3.0)", "GLM 5.3 Flash(x0.8)", "Spark X2.5
// (x0.1)" — and ships no structured rate field. splitRateSuffix takes it
// off, the same split the client's display-name reader and the gateway's
// own catalog make: only a trailing bracket counts, ASCII () and full-width
// （） both and only matched with their own kind; the content must be an
// x/X-prefixed, non-empty run of digits and dots with a digit among them —
// any other trailing label ("限时免费" and the like) is no rate, and stays
// in the name rather than being silently dropped. A name that is nothing
// but the bracket keeps itself whole: no empty display names.
function splitRateSuffix(name) {
  const raw = String(name ?? "")
  const trimmed = raw.replace(/\s+$/, "")
  const close = trimmed.endsWith(")") ? ")" : trimmed.endsWith("）") ? "）" : ""
  if (!close) return { name: raw, rate: undefined }
  const open = close === ")" ? "(" : "（"
  const body = trimmed.slice(0, -close.length)
  const at = body.lastIndexOf(open)
  if (at === -1) return { name: raw, rate: undefined }
  const inner = body.slice(at + open.length).trim()
  const number = inner[0] === "x" || inner[0] === "X" ? inner.slice(1).trim() : ""
  if (!number || !/[0-9]/.test(number) || !/^[0-9.]+$/.test(number)) return { name: raw, rate: undefined }
  const cleaned = body.slice(0, at).replace(/\s+$/, "")
  return { name: cleaned || raw, rate: "x" + number }
}

// a JSON value as a plain object — the only shape capabilities can be
const plainObject = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : undefined)

// a limit's value: a positive number, or a numeric string read as one (the
// tolerant read costs nothing and catches a gateway that quotes its numbers)
const posInt = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined
}

// the thinking models by their own name — the client hangs its reasoning
// bit on spark-x alone, and the catalog keeps that name check beside the
// capabilities bit
const isReasoningModel = (id) => id.toLowerCase().includes("spark-x")

// the words an image generator's id or name carries — the host's image
// model catalog reads the very same words (gpt-image, dall-e, flux,
// seedream, qwen-image…) — so a row that ships no type at all still reads
// as the drawer it is. No chat model of this catalog carries any of them.
const IMAGE_WORDS = [
  "image",
  "imagen",
  "imagine",
  "dall-e",
  "flux",
  "seedream",
  "cogview",
  "stable-diffusion",
  "sdxl",
  "wanx",
  "wan2",
  "kolors",
  "hidream",
  "banana",
  "sensenova-u1",
]

// the image generators this plugin vouches for, one entry each, as measured
// live on 2026-11-02 — the roster a release maintains. An entry reaches the
// table only while the live catalog names its id: a generator Loomy retires
// leaves at the next answer, with no release needed, and one it adds waits
// for the release that names it here. The name is the entry's display name;
// the row's own facts (the limits, the capability bits) ride beside it. No
// entry goes into the fallback tables — the config hook's and a session's
// short defaults — where no live answer could ever gate it.
const IMAGE_MODELS = [
  { id: "Hy-Image-3.5-preview", name: "Hy image 3.5 preview" },
  { id: "doubao-seedream-5-lite", name: "Doubao seedream 5 lite" },
  { id: "qwen-image-3.0-pro", name: "qwen image 3.0 pro" },
]

// parseModels reads the model gateway's /api/v1/models answer — the OpenAI
// {data:[…]} envelope, or the bare array the gateway has also been seen in —
// as the short model records both shapes below are built from. Rows without
// an id are dropped; a missing name falls back to the id, and the rate
// suffix comes off whatever name there is. The capability bits follow the
// gateway's own catalog mapping: tool call is the OpenAI-compatible default
// when the capabilities object is missing entire, and only what a present
// object says — a present object without function_calling says no; reasoning
// is the capabilities' own bit or a spark-x name; vision is the
// capabilities' own bit or "image" among the input modalities, either's
// case. The context and output limits pass through from the first key the
// row carries of each set — the client's own normalizer reads the same two
// sets. (This is the models interface alone; the points plane's two-layer
// data has no business here.)

// limitOf is a row's first limit among the keys of one set
function limitOf(row, keys) {
  for (const key of keys) {
    const value = posInt(row?.[key])
    if (value !== undefined) return value
  }
  return undefined
}

// rowModelOf is one gateway row, chat or generator alike, as a short model
// record: the facts are the row's own — the rate suffix off its name, the
// free bit, the capability bits, the two limits — whatever list the row
// serves
function rowModelOf(row, displayName) {
  const id = typeof row?.id === "string" ? row.id.trim() : ""
  const { name, rate } = splitRateSuffix(displayName)
  // free is the upstream's own declaration, nothing inferred: the words
  // 免费 in the display name, or a rate of exactly zero
  const free = /免费/.test(displayName) || (rate !== undefined && /^x0(\.0+)?$/i.test(rate.trim()))
  const caps = plainObject(row.capabilities)
  const hasModal = (want) =>
    (Array.isArray(caps?.input_modalities) ? caps.input_modalities : []).some(
      (item) => typeof item === "string" && item.toLowerCase() === want
    )
  // the reasoning efforts the row itself declares — the gateway's own
  // enumeration of the levels it serves for this model, the same source the
  // Loomy web client reads its picker from. The V1 side never looks at it
  // (its variants are the fixed low/medium/high the client itself sends);
  // the v2 side hangs its picker's levels off it. A present array is the
  // declaration, an empty one included; no array is no declaration at all.
  const efforts = Array.isArray(row.reasoning_efforts)
    ? row.reasoning_efforts.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim())
    : undefined
  return {
    id,
    name,
    rate,
    free,
    toolcall: caps === undefined || caps.function_calling === true,
    reasoning: caps?.reasoning === true || isReasoningModel(id),
    vision: caps?.vision === true || hasModal("image"),
    context: limitOf(row, ["context_length", "context_window", "input_token_limit", "max_input_tokens", "maxInputTokens"]),
    output: limitOf(row, ["max_output_tokens", "max_completion_tokens", "max_tokens", "maxOutputTokens"]),
    ...(efforts === undefined ? {} : { efforts }),
  }
}

// the envelope's rows, either shape the gateway answers in
const rowsOf = (payload) => (Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [])

function parseModels(payload) {
  const out = []
  for (const row of rowsOf(payload)) {
    const id = typeof row?.id === "string" ? row.id.trim() : ""
    if (!id) continue
    const displayName = typeof row.name === "string" && row.name.trim() ? row.name.trim() : id
    // a row that isn't a chat model — the image generators say so in their
    // type, and an image generator's name tells the same story when the
    // row ships no type at all — is no choice to chat with: selecting one
    // is selecting a failure. The roster puts the vouched-for ones back
    // beside this list, gated on the live answer, as imageModelsOf does.
    if (
      (typeof row?.type === "string" && row.type.trim() && row.type.trim() !== "chat") ||
      IMAGE_WORDS.some((w) => `${id}\n${displayName}`.toLowerCase().includes(w))
    )
      continue
    out.push(rowModelOf(row, displayName))
  }
  return out
}

// imageModelsOf is the roster's entries the live catalog still names, as
// model records: the row's own facts, the roster's display name, and what
// a generator is — no tools, no thinking — however its row reads
function imageModelsOf(payload) {
  const listed = new Map(
    rowsOf(payload).map((row) => [typeof row?.id === "string" ? row.id.trim().toLowerCase() : "", row])
  )
  const out = []
  for (const entry of IMAGE_MODELS) {
    const row = listed.get(entry.id.toLowerCase())
    if (!row) continue
    const displayName = typeof row.name === "string" && row.name.trim() ? row.name.trim() : entry.name
    const m = rowModelOf(row, displayName)
    m.name = entry.name
    m.toolcall = false
    m.reasoning = false
    out.push(m)
  }
  return out
}

// configModelOf is one model as the config hook's table spells it
// (models.dev's shape, minimax's configModels): tool_call with the
// underscore there. The rate stays in the record, out of the name. A
// toolcall bit that isn't there (the fallback table's) is the compatible
// default — only an explicit false says no.
function configModelOf(m) {
  return {
    id: m.id,
    name: m.name || m.id,
    reasoning: m.reasoning === true,
    tool_call: m.toolcall !== false,
    attachment: m.vision === true,
    modalities: { input: m.vision === true ? ["text", "image"] : ["text"], output: ["text"] },
    limit: { context: m.context ?? 0, output: m.output ?? 0 },
    cost: { input: 0, output: 0 },
    ...(m.free === true ? { free: true } : {}),
    variants: VARIANTS,
  }
}

// providerModelOf is one model as the provider's models hook spells it
// (OpenCode's ModelInfo, minimax's modelOf): the provider's own id on
// every record, capabilities' toolcall without the underscore, and the
// cost's cache keys nested under cache. The rate rides the record — the
// field the host reads to show the picker's multiplier — out of the name,
// where it never belonged.
function providerModelOf(m, providerID = ID) {
  return {
    id: m.id,
    providerID,
    name: m.name || m.id,
    api: { id: m.id, url: apiBase() + "/chat/completions", npm: NPM },
    limit: { context: m.context ?? 0, output: m.output ?? 0 },
    capabilities: { toolcall: m.toolcall !== false, reasoning: m.reasoning === true, attachment: m.vision === true },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    ...(m.free === true ? { free: true } : {}),
    ...(m.rate !== undefined ? { rate: m.rate } : {}),
    variants: VARIANTS,
  }
}

// fallbackOf is the models hook's fallback answer: the table it was given,
// with the snapshot's rate and free bits put back on. The host spells the
// config table into its own records field by field, and the rate and the
// free bit are not fields it keeps — a table handed straight back would
// reach the picker with neither. A row the snapshot doesn't know passes
// untouched, and nothing is invented: an unrated model stays unrated. A
// refused ask marks the table the way the host reads it —
// Symbol.for("magpie.fellBack") on it — so the editor says the list is the
// plugin's defaults and not the account's; a session that was never there,
// or a live answer that said nothing, is no refusal and goes unmarked, as
// it did when the table itself was handed back.
function fallbackOf(p, refused) {
  const known = new Map(FALLBACK_MODELS.map((m) => [m.id, m]))
  const table = Object.fromEntries(
    Object.entries(p?.models ?? {}).map(([key, m]) => {
      const f = known.get(key)
      if (!f) return [key, m]
      return [
        key,
        {
          ...m,
          ...(m.rate === undefined && f.rate !== undefined ? { rate: f.rate } : {}),
          ...(m.free === undefined && f.free === true ? { free: true } : {}),
        },
      ]
    }),
  )
  if (refused) table[Symbol.for("magpie.fellBack")] = true
  return table
}

// ---- the CAccount signature -------------------------------------------------------
// Every request to the account host is HMAC-SHA1 signed, the way the client's
// electron/xfyun/sign.js signs one: nine lines (the method, the escaped path,
// an always-empty query line, the body's MD5, the content type, the date, the
// nonce, and two always-empty header lines) HMAC'd with the configured key
// pair and sent as "account {id}:{base64}".

const CONTENT_TYPE = "application/json" // the string-to-sign's fifth line, and the requests' own content type

// RFC3986 for one path segment: encodeURIComponent, then the five characters
// it lets through that RFC3986 does not (!'()*) get their uppercase %XX on top
const escapeSegment = (segment) =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (ch) => "%" + ch.charCodeAt(0).toString(16).toUpperCase())

// the path as signed: a leading slash, no trailing one, every segment escaped
function escapedPath(path) {
  let clean = String(path ?? "")
  if (!clean.startsWith("/")) clean = "/" + clean
  if (clean.length > 1 && clean.endsWith("/")) clean = clean.slice(0, -1)
  return clean.split("/").map(escapeSegment).join("/")
}

// the nine lines, \n-joined; the last two being empty, the string ends two
// newlines past the nonce. Built as an array so the count cannot drift.
const stringToSign = (method, escapedPathStr, md5, date, nonce) =>
  [String(method).toUpperCase(), escapedPathStr, "", md5, CONTENT_TYPE, date, nonce, "", ""].join("\n")

// base64(md5(utf8 bytes)) over exactly the JSON that goes on the wire; an
// empty body signs as the empty string (the client's contentMD5("") — both
// account requests carry a body, so that branch never runs in the flow)
const contentMd5 = (jsonString) =>
  jsonString === "" ? "" : createHash("md5").update(jsonString, "utf8").digest("base64")

// the Authorization header's value: "account {AccessKeyId}:{base64(HMAC-SHA1)}"
const signHeader = (keyId, keySecret, stringToSign) =>
  `account ${keyId}:${createHmac("sha1", keySecret).update(stringToSign, "utf8").digest("base64")}`

// ---- the sign-in's own small vocabulary -------------------------------------------

// a mainland phone number as the client's sendSmsCode reads one: spaces and
// hyphens dropped, an optional +86 (or a bare 86 leading straight into the
// eleven digits) stripped, then exactly eleven digits starting 1[3-9]. A
// valid input answers the cleaned digits; anything else answers undefined.
function normalizePhone(value) {
  const trimmed = String(value ?? "").replace(/[\s-]/g, "")
  let digits = trimmed.startsWith("+86") ? trimmed.slice(3) : trimmed
  if (digits.startsWith("86") && digits.length === 13) digits = digits.slice(2)
  return /^1[3-9]\d{9}$/.test(digits) ? digits : undefined
}

// the send-code answer's msgid, which the sign-in has to carry back: the
// field has shipped as msgid and as msgId, on the data floor and one floor
// below it — these four paths, in this order, and no others. None of them
// holding a string means the send-code answer is treated as failed.
function extractMsgid(payload) {
  const candidates = [payload?.data?.msgid, payload?.data?.msgId, payload?.data?.data?.msgid, payload?.data?.data?.msgId]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return ""
}

// first three digits, stars, last four — the auditable trace without the
// personal data. Input shorter than seven characters stays whole.
const maskPhone = (phone) => {
  const text = String(phone ?? "")
  const chars = [...text]
  return chars.length < 7 ? text : chars.slice(0, 3).join("") + "****" + chars.slice(-4).join("")
}

// every Loomy plane answers business results inside a 200: the code as a
// string, the wording in desc (message as its fallback)
const businessCode = (payload) => (typeof payload?.code === "string" ? payload.code.trim() : "")
const upstreamMessage = (payload) => {
  const desc = typeof payload?.desc === "string" ? payload.desc.trim() : ""
  if (desc) return desc
  return typeof payload?.message === "string" ? payload.message.trim() : ""
}

// what a failed business code should tell the person signing in: the two
// sign-in codes say so in so many words, the rest pass the upstream wording
// through (or the bare code when there is no wording)
const describeLoginError = (code, upstreamMsg) => {
  const w = wordsOf()
  if (AUTH_CODES.has(code)) return w.loginExpired
  const text = String(upstreamMsg ?? "").trim()
  return text ? w.loginFailed(text) : w.loginFailedCode(code)
}

// ---- the request envelope and the signed POST -------------------------------------

// the client's _makeBase() constants: the web desk the desktop client says it
// is. devid is a fixed "web", not a device fingerprint.
const WEB_MODEL_ID = "Web"
const WEB_DEVICE_ID = "web"
const CLIENT_UA = "Loomy|Desktop|Electron|macOS"
const CLIENT_VERSION = "1.0.0"
// the envelope's appid; LOOMY_XFYUN_APP_ID can override it, the way the
// client's own config can
const appId = () => process.env.LOOMY_XFYUN_APP_ID || "GM3LOOMY"

// the envelope's traceid: sixteen random bytes as lowercase hex
const traceid = () => randomBytes(16).toString("hex")

// the envelope both account requests ride in — the field order is the
// client's, and the MD5 covers these bytes as serialized
const makeBase = () => ({
  appid: appId(),
  modelid: WEB_MODEL_ID,
  version: CLIENT_VERSION,
  devid: WEB_DEVICE_ID,
  ua: CLIENT_UA,
  traceid: traceid(),
})

// one signed POST to the CAccount host. The body is stringified once, so the
// MD5 and the wire carry the same bytes; HTTP-level failures throw here, the
// business code in the answer is the caller's to translate. Twenty seconds:
// the client's own timeout, drawn in a little.
async function caccountPost(path, body) {
  const json = JSON.stringify(body)
  const md5 = contentMd5(json)
  const date = new Date().toUTCString() // the RFC7231 form: "Tue, 07 Oct 2026 08:00:00 GMT"
  const nonce = randomUUID() // the client signs the hyphenated UUID itself
  const res = await fetch(xfyunBase() + path, {
    method: "POST",
    headers: {
      "Content-Type": CONTENT_TYPE,
      Accept: "application/json",
      Authorization: signHeader(keyId(), keySecret(), stringToSign("POST", escapedPath(path), md5, date, nonce)),
      Date: date,
      Nonce: nonce,
      "Content-MD5": md5,
    },
    body: json,
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(wordsOf().accountHttp(res.status))
  return await res.json()
}

// ---- the integration gateway ------------------------------------------------------

// The plane the points, the daily first-login and the model list answer on:
// the session token in both headers its gateways read — "token:" and
// "Authorization: Bearer", the client's authMode "token" dual write — and
// not one signature: the HMAC-SHA1 belongs to the account plane alone, and
// a signed header sent here is noise the gateway never checks. HTTP-level
// refusals are translated here the way client.rs translates them (401 and
// 403 the sign-in's end, anything else the bare status); the business code
// in the answer stays the caller's to read.
async function tokenRequest(method, path, json, token) {
  const res = await fetch(integrationBase() + path, {
    method,
    headers: {
      Accept: "application/json",
      token: token,
      Authorization: "Bearer " + token,
      ...(json === undefined ? {} : { "Content-Type": CONTENT_TYPE }),
    },
    ...(json === undefined ? {} : { body: json }),
    signal: AbortSignal.timeout(20_000), // the client's own timeout, drawn in a little
  })
  if (res.status === 401 || res.status === 403) throw signInExpired()
  if (!res.ok) throw new Error(wordsOf().gatewayHttp(res.status))
  return await res.json()
}

// a read (the points summary, the model list); the query rides in the path
const tokenGet = (path, token) => tokenRequest("GET", path, undefined, token)

// a write (the daily first-login): the body stringified once, an empty
// object when the caller passes none — first-login's own body is one
const tokenPost = (path, body, token) => tokenRequest("POST", path, JSON.stringify(body ?? {}), token)

// ---- the phone-code sign-in -------------------------------------------------------
// Two signed calls to the account host: sendMsgCode for the code's msgid,
// checkCode for the fourteen-day session. magpie collects the phone number
// first (prompts), calls authorize(inputs), then — method "code" — asks for
// the texted code and hands it to callback(code).

const phoneCodeMethod = {
  type: "oauth",
  label: "Loomy 手机验证码登录（讯飞）",
  prompts: [
    {
      type: "text",
      key: "phone",
      message: "手机号（11 位，不带 +86）",
      placeholder: "13800138000",
      validate: (v) => (normalizePhone(v) === undefined ? "请填写 11 位中国大陆手机号" : undefined),
    },
  ],
  async authorize(inputs) {
    const phone = normalizePhone(inputs?.phone)
    // an authorize failure has to throw: answering {type:"failed"} here would
    // have the host take the "auto" branch and call callback() with no code
    if (phone === undefined) throw new Error("请填写 11 位中国大陆手机号")
    const payload = await caccountPost("/login/phone/sendMsgCode", {
      base: makeBase(),
      param: { ccode: "86", phone, expire: 300 }, // the code lives five minutes
    })
    const code = businessCode(payload)
    if (code !== SUCCESS) throw new Error(describeLoginError(code, upstreamMessage(payload)))
    const msgid = extractMsgid(payload)
    if (!msgid) throw new Error("验证码已发出但上游没有返回 msgid，请稍后重试")
    return {
      url: "",
      instructions: `验证码已发送到 ${maskPhone(phone)}，请输入收到的 6 位验证码。`,
      method: "code",
      async callback(input) {
        const mcode = String(input ?? "").trim()
        if (!/^\d{6}$/.test(mcode)) return { type: "failed", error: "请填写 6 位数字验证码" }
        const res = await caccountPost("/login/phone/checkCode", {
          base: makeBase(),
          param: { ccode: "86", phone, mcode, msgid, expire: 1209600 }, // fourteen days
        })
        const status = businessCode(res)
        if (status !== SUCCESS) return { type: "failed", error: describeLoginError(status, upstreamMessage(res)) }
        const session = typeof res.data?.session === "string" ? res.data.session.trim() : ""
        if (!session) return { type: "failed", error: "登录成功但上游没有返回 session" }
        const userid = typeof res.data?.userid === "string" ? res.data.userid.trim() : ""
        return {
          type: "success",
          access: session, // the session is the model gateway's token
          refresh: "", // a phone-code session has no way to renew
          expires: Date.now() + SESSION_MS, // milliseconds; extra fields persist with the credential
          accountId: maskPhone(phone),
          uid: userid,
        }
      },
    }
  },
}

// ---- the points card and the daily refresh ----------------------------------------
// Loomy has no balance endpoint: the points summary rides on the V2 records
// call's answer — the client's own points page reads it there — and no
// check-in endpoint either: the daily grant is renewed by the first-login
// call the client makes on every login, idempotent per day on the server's
// side. Both answer on the integration gateway above, with the session
// token and no signature.

// the records call the summary rides on; pageSize 1 because the summary is
// the point and the records themselves go unread (balance.rs's own query)
const RECORDS_PATH = "/api/v2/points/records?pageNo=1&pageSize=1&direction=debit&granularity=chat"

// the daily grant's refresh, the every-login call the client makes
const FIRST_LOGIN_PATH = "/api/v1/points/first-login"

// a summary number: a number as it is, a numeric string ("5000" — a shape
// the upstream has been seen in) as the number it names, anything else as
// missing
function pickNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined
  if (typeof v === "string") {
    const text = v.trim()
    if (text && Number.isFinite(Number(text))) return Number(text)
  }
  return undefined
}

// the summary's floor: the V2 answer has shipped two ways, the summary
// directly in data and one floor below it in data.data — the deeper floor
// first, the shallower one behind it, the same settle balance.rs makes
const pointsFloor = (payload) => plainObject(payload?.data?.data) ?? plainObject(payload?.data) ?? {}

// ---- the grant's size, kept from the first-login answer ---------------------------
// The card's percentage needs the grant's size, but the records call — the
// only read the card makes — answers with the grant's remaining alone
// (dailyBalance), and the size (dailyQuota) rides the first-login answer
// the check-in already pays for. So the check-in notes the size per
// account, and the note's home is the credential itself: the host's own
// user data, carried across plugin upgrades (a package directory is
// replaced whole on every install, so a note beside the plugin file
// survives nothing) and scoped to the account for free — magpie's
// client.auth.set replaces the record as a whole, so the current record
// rides along and the note lands beside it, and the read comes back with
// getAuth(). Where no auth.set exists, or for an upgrade from a release
// that noted only there, a small JSON beside the plugin (memory for the
// run, file for the next) stands in — the card reads the credential
// first, the file behind it. Every half is best-effort: a refusing store
// answers nothing rather than failing the card or the claim, and
// LOOMY_QUOTA_CACHE_FILE moves the file the way the other knobs move
// the hosts.

const quotaCacheFile = () =>
  process.env.LOOMY_QUOTA_CACHE_FILE || fileURLToPath(new URL("./.loomy-quota.json", import.meta.url))

// the run's notes, one size per account; a read falls through to the file
// whenever the memory map has no note, so a fresh process — or a note
// another one wrote — is picked up where it stands
const quotaNotes = new Map()

async function quotaNoteOf(account) {
  if (quotaNotes.has(account)) return quotaNotes.get(account)
  try {
    const store = plainObject(JSON.parse(await readFile(quotaCacheFile(), "utf8")))
    if (store) {
      for (const [key, value] of Object.entries(store)) {
        if (quotaNotes.has(key)) continue
        const quota = pickNumber(value)
        if (quota !== undefined) quotaNotes.set(key, quota)
      }
    }
  } catch {}
  return quotaNotes.get(account)
}

// noteQuota keeps one account's size in the memory map and merges it into
// the file, so other accounts' notes survive the write
// the notes write one after another: two accounts signing in at once both
// read-merge-write the same file, and an unsynchronized pair would let the
// later write drop the earlier account's note
let noteWrites = Promise.resolve()

async function noteQuota(account, quota) {
  if (quota === undefined) return
  quotaNotes.set(account, quota)
  noteWrites = noteWrites
    .then(async () => {
      let store = {}
      try {
        store = plainObject(JSON.parse(await readFile(quotaCacheFile(), "utf8"))) ?? {}
      } catch {}
      store[account] = quota
      await writeFile(quotaCacheFile(), JSON.stringify(store), "utf8")
    })
    .catch(() => {})
  await noteWrites
}

// askQuotaOnce is the card's own way out of a missing note — a fresh
// install, an upgrade that wiped one, a credential that lost its fields.
// The quota rides the first-login answer alone and no read endpoint
// carries it, so the card asks that answer itself: once per account per
// run, because the call is idempotent for the day (the client makes it on
// every login; a repeat answers alreadyProcessed with the same numbers).
// Whatever refuses here is a card without a percentage, never a failed
// card — and a refusal is remembered for the run, so a broken upstream is
// not asked on every render.
const QUOTA_ASK_RETRY_MS = 10 * 60_000 // a refused ask retries after a while, not on every render
const quotaAsksFailed = new Map()

async function askQuotaOnce(client, auth, access) {
  const account = String(auth?.accountId ?? "")
  const failedAt = quotaAsksFailed.get(account)
  if (failedAt !== undefined && Date.now() - failedAt < QUOTA_ASK_RETRY_MS) return undefined
  try {
    const payload = await tokenPost(FIRST_LOGIN_PATH, {}, access)
    const code = businessCode(payload)
    const quota = code === SUCCESS && !AUTH_CODES.has(code) ? pickNumber(pointsFloor(payload)?.dailyQuota) : undefined
    if (quota === undefined) {
      quotaAsksFailed.set(account, Date.now())
      return undefined
    }
    await rememberQuota(client, auth, quota, cycleDateOf(payload))
    return quota
  } catch {
    quotaAsksFailed.set(account, Date.now())
    return undefined
  }
}

// the cycle date the first-login answer names, a string or nothing
const cycleDateOf = (payload) => {
  const value = pointsFloor(payload)?.dailyCycleDate
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

// rememberQuota is the note's primary write: the credential itself, whole
// record replaced with the note beside its fields. A host without an
// auth.set — or a write that refuses — falls back to the file note, and
// nothing here may ever break the claim that carries it. The cycle date
// rides with the quota: the window's exact reset moment is computed from
// it, and the two belong to the same day or neither means anything
const rememberQuota = async (client, auth, quota, cycleDate) => {
  if (quota === undefined) return
  // both homes, best-effort each: the credential survives plugin upgrades,
  // and the file answers at once — a getAuth that lingers on the pre-write
  // record for the rest of the run finds the file behind it
  if (typeof client?.auth?.set === "function") {
    try {
      const body = { ...(auth ?? {}), dailyQuota: quota }
      if (typeof cycleDate === "string" && cycleDate) body.dailyCycleDate = cycleDate
      await client.auth.set({ path: { id: ID }, body })
    } catch {}
  }
  await noteQuota(String(auth?.accountId ?? ""), quota)
}

// the grant's cycle is the Beijing calendar day: the cycle date the
// first-login answer names, a YYYY-MM-DD whose midnight — Beijing time —
// opens the day the quota belongs to. The window's reset moment is the
// next Beijing midnight: the same arithmetic the client's own calendar
// keeps, with no buffer invented (a moment that has already passed — a
// note from an earlier day still held — rolls forward, never back, so a
// countdown never reads "already reset").
const BEIJING_OFFSET_MS = 8 * 3600_000

function beijingCycleResetAt(cycleDate, now = Date.now()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cycleDate ?? "").trim())
  let day
  if (m) {
    day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - BEIJING_OFFSET_MS
  } else {
    const shifted = new Date(now + BEIJING_OFFSET_MS)
    day = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - BEIJING_OFFSET_MS
  }
  let reset = day + 86_400_000
  while (reset <= now) reset += 86_400_000
  return new Date(reset).toISOString()
}

// ---- the words, in the UI's language ----------------------------------------------
// The host renders a window's name and unit through its own translator —
// unknown keys pass through as they are — and shows display and the
// check-in's message verbatim. The host hands the plugin its data folder as
// the plugin input's directory, and the interface language sits in
// settings.json there; read at ask-time, so a language change follows at
// once. zh keeps the plugin's own words; anything else — a missing file, an
// unreadable one included — takes the English strings.

const I18N = {
  zh: {
    daily: "每日赠送",
    permanent: "永久积分",
    newcomer: "新手任务",
    credits: "积分",
    noQuota: n => `剩余 ${n} 积分`,
    zero: "0 积分",
    now: d => `当前 ${d}`,
    refreshedToday: r => (r ? `今日已刷新（${r}）` : "今日已刷新"),
    claimedGain: (gain, daily) => (daily !== undefined ? `每日赠送积分已刷新（+${gain}，当前 ${daily}）` : `每日赠送积分已刷新（+${gain}）`),
    claimedRest: r => `每日赠送积分已刷新（${r}）`,
    claimed: "每日赠送积分已刷新",
    refreshFailed: t => `每日积分刷新失败：${t}`,
    refreshFailedCode: c => `每日积分刷新失败（上游 code=${c}）`,
    claimable: (sum, n) => `可领 ${sum} 积分（${n} 项）`,
    claimTail: (gain, n) => `，新手任务 +${gain}（${n} 项）`,
    loginExpired: "登录态已失效，请重新登录",
    loginFailed: t => `登录失败：${t}`,
    loginFailedCode: c => `登录失败（上游 code=${c}）`,
    signInExpired: "Loomy 登录态已失效，请重新登录",
    pointsFailed: t => `积分查询失败：${t}`,
    pointsFailedCode: c => `积分查询失败（上游 code=${c}）`,
    account: "Loomy 账号",
    accountHttp: s => `Loomy 账号接口 HTTP ${s}`,
    gatewayHttp: s => `Loomy 网关接口 HTTP ${s}`,
  },
  en: {
    daily: "Daily grant",
    permanent: "Permanent points",
    newcomer: "Newcomer tasks",
    credits: "credits",
    noQuota: n => `${n} credits remaining`,
    zero: "0 credits",
    now: d => `${d} credits now`,
    refreshedToday: r => (r ? `Already refreshed today (${r})` : "Already refreshed today"),
    claimedGain: (gain, daily) => (daily !== undefined ? `Daily grant refreshed (+${gain}, ${daily} credits now)` : `Daily grant refreshed (+${gain})`),
    claimedRest: r => `Daily grant refreshed (${r})`,
    claimed: "Daily grant refreshed",
    refreshFailed: t => `Daily refresh failed: ${t}`,
    refreshFailedCode: c => `Daily refresh failed (upstream code=${c})`,
    claimable: (sum, n) => `${sum} credits claimable (${n} tasks)`,
    claimTail: (gain, n) => `, newcomer tasks +${gain} (${n} claimed)`,
    loginExpired: "Sign-in expired, sign in again",
    loginFailed: t => `Sign-in failed: ${t}`,
    loginFailedCode: c => `Sign-in failed (upstream code=${c})`,
    signInExpired: "Loomy sign-in expired, sign in again",
    pointsFailed: t => `Points query failed: ${t}`,
    pointsFailedCode: c => `Points query failed (upstream code=${c})`,
    account: "Loomy account",
    accountHttp: s => `Loomy account API HTTP ${s}`,
    gatewayHttp: s => `Loomy gateway API HTTP ${s}`,
  },
}

// the interface language: settings.json sits in the folder the host hands
// the plugin as its input's directory (magpie's own data folder), captured
// at factory time; an empty string clears it (the tests' way back)
const noteHostDirectory = (directory) => {
  hostDirectory = typeof directory === "string" ? directory : ""
}
let hostDirectory = ""

function wordsOf() {
  let lang = "zh" // no host folder — OpenCode, the tests — keeps the plugin's own words
  if (hostDirectory) {
    try {
      lang = JSON.parse(readFileSync(join(hostDirectory, "settings.json"), "utf8"))?.lang ?? "zh"
    } catch {}
  }
  return typeof lang === "string" && lang.toLowerCase().startsWith("zh") ? I18N.zh : I18N.en
}

// usageOf is the card. The two wallets Loomy keeps — the permanent balance
// and the daily grant — add into the one balance line, and the grant takes
// the window. used is a percentage 0-100; the amounts live in display
// alone. The grant's dailyBalance is its remaining, not its size — the
// first-login answer says the arithmetic aloud: dailyQuota 5000,
// dailyConsumed 1989, dailyBalance 3011 — so the percentage needs a size:
// the pair an older answer carried (dailyRemainingPoints/dailyLimitPoints,
// kept first while both halves are there), the dailyQuota on the answer
// that carries it, or the size the check-in noted from the first-login
// call. With a size the grant shows its consumed share; without one no
// share is invented — the remaining stands in the display alone, labeled
// as the remaining it is, and no figure of the grant is assumed. The
// permanent line is a status row set aside, always zero — a permanent
// balance has no window to consume. The balance line is the total the
// answer names (availableBalance/currentBalance — the first-login answer's
// own name for it) or the two wallets summed.
function usageOf(payload, notedQuota, cycleDate) {
  const data = pointsFloor(payload)
  const permanent = pickNumber(data.balance) ?? pickNumber(data.permanentBalance) ?? 0
  const pair =
    pickNumber(data.dailyRemainingPoints) !== undefined && pickNumber(data.dailyLimitPoints) !== undefined
  const remaining = pair ? pickNumber(data.dailyRemainingPoints) : pickNumber(data.dailyBalance)
  const quota = pair ? pickNumber(data.dailyLimitPoints) : (pickNumber(data.dailyQuota) ?? notedQuota)
  const share = remaining !== undefined && quota !== undefined && quota > 0 ? (quota - remaining) / quota : undefined
  const named = pickNumber(data.availableBalance) ?? pickNumber(data.currentBalance)
  const total = named ?? (permanent + (pickNumber(data.dailyBalance) ?? 0))
  const w = wordsOf()
  return {
    balance: `${Math.round(total * 100) / 100} ${w.credits}`,
    windows: [
      {
        name: w.daily,
        used: share !== undefined ? Math.max(0, Math.min(100, Math.round(share * 100))) : 0,
        span: 86400, // a day: the grant comes back with the calendar
        display:
          share !== undefined
            ? `${remaining} / ${quota} ${w.credits}`
            : remaining !== undefined
              ? w.noQuota(remaining)
              : w.zero,
        // amount is the consumed share — the host's own rendering pairs it
        // with limit as what is left, so a remaining here would show the
        // day's usage as if it were what is left
        ...(share !== undefined ? { amount: Math.round((quota - remaining) * 100) / 100, limit: quota, unit: "credits" } : {}),
        resetsAt: beijingCycleResetAt(cycleDate),
      },
      { name: w.permanent, used: 0, display: `${permanent} ${w.credits}`, unit: "credits", aside: true },
    ],
  }
}

// checkinOf reads a first-login answer as the claim. The answer's
// alreadyProcessed is the one flag that tells the day's renewal from a
// repeat: a repeat answers true and the claim is done — already claimed,
// not claimed again — and the day's first answers false. What the answer
// carries of the grant is its remaining (dailyBalance), not its gain; the
// gain reads only when the arithmetic is there in full (dailyQuota minus
// dailyConsumed), and then it is promised as the claim's credit. The
// wording carries the remaining beside the quota whenever both are there.
function checkinOf(payload) {
  const code = businessCode(payload)
  if (AUTH_CODES.has(code)) {
    return { outcome: "failed", message: describeLoginError(code, upstreamMessage(payload)), signIn: "expired" }
  }
  if (code !== SUCCESS) {
    const text = upstreamMessage(payload)
    const w = wordsOf()
    return { outcome: "failed", message: text ? w.refreshFailed(text) : w.refreshFailedCode(code) }
  }
  const data = plainObject(payload?.data?.data) ?? plainObject(payload?.data) ?? {}
  const daily = pickNumber(data.dailyBalance)
  const quota = pickNumber(data.dailyQuota)
  const consumed = pickNumber(data.dailyConsumed)
  const w = wordsOf()
  const rest = daily !== undefined && quota !== undefined ? `${daily} / ${quota} ${w.credits}` : daily !== undefined ? w.now(daily) : ""
  if (data.alreadyProcessed === true) {
    return { outcome: "done", message: w.refreshedToday(rest) }
  }
  const gain = quota !== undefined && consumed !== undefined ? quota - consumed : undefined
  return {
    outcome: "claimed",
    ...(gain !== undefined && gain > 0 ? { credit: gain } : {}),
    message:
      gain !== undefined && gain > 0
        ? w.claimedGain(gain, daily)
        : rest
          ? w.claimedRest(rest)
          : w.claimed,
  }
}

// ---- the newcomer tasks, a one-time purse beside the daily grant -------------------
// Beside the daily grant Loomy hangs eight one-off newcomer tasks, 10000
// points in all: one query reads which are done, one idempotent write
// claims each undone one — the upstream judges completion its own way and
// answers a repeat alreadyCompleted, so claiming twice cannot pay twice.
// The check-in claims what is pending behind the daily grant, one claim at
// a time and highest value first (an upstream that dislikes same-account
// concurrency is asked serially; a failure mid-way leaves the small ones,
// not the big ones), and nothing that refuses among these one-time claims
// is allowed to touch the daily claim's own result. The card carries the
// still-claimable sum as an aside row while any of it stands — a purse
// spent once has no window to consume, so it never drives the percentages
// — and the read is cached for the run, the card refreshing far more
// often than the tasks change; the check-in's claim round clears it.

const TASKS_PATH = "/api/v1/onboarding/tasks"
const TASK_COMPLETE_PATH = "/api/v1/onboarding/tasks/complete"

// the eight tasks in the claim order itself, value first; the keys and
// values are the client's own registry spelling, and a task the answer
// never names counts as not yet claimed — an upstream that changes its
// board answers unknown keys, which read as nothing rather than an error
const ONBOARDING_TASKS = [
  { key: "share_soul", title: "分享搭子给朋友", points: 2000 },
  { key: "generate_ppt", title: "生成第一份 PPT", points: 1500 },
  { key: "install_skill", title: "安装一个技能", points: 1500 },
  { key: "create_soul", title: "创建第一个搭子", points: 1500 },
  { key: "pick_skill", title: "选择一个技能", points: 1000 },
  { key: "set_schedule", title: "设置定时任务", points: 1000 },
  { key: "configure_remote", title: "配置远程控制", points: 1000 },
  { key: "first_message", title: "发送第一条消息", points: 500 },
]

// the tasks answer read into what there is to claim
function onboardingStateOf(payload) {
  const data = plainObject(payload?.data?.data) ?? plainObject(payload?.data) ?? {}
  const done = plainObject(data.tasks) ?? {}
  return ONBOARDING_TASKS.filter((task) => done[task.key] !== true)
}

// one claim round, best-effort by contract: whatever refuses here answers
// an empty tail, and a word of it never reaches the daily claim's own
// wording. Only a success that is not already a repeat counts its points
async function claimOnboarding(access) {
  try {
    const payload = await tokenGet(TASKS_PATH, access)
    const code = businessCode(payload)
    if (code !== SUCCESS || AUTH_CODES.has(code)) return ""
    let gained = 0
    let claimed = 0
    for (const task of onboardingStateOf(payload)) {
      const answer = await tokenPost(TASK_COMPLETE_PATH, { key: task.key }, access)
      if (businessCode(answer) === SUCCESS && pointsFloor(answer)?.alreadyCompleted !== true) {
        gained += task.points
        claimed += 1
      }
    }
    return claimed > 0 ? wordsOf().claimTail(gained, claimed) : ""
  } catch {
    return ""
  }
}

// the card's aside row while anything stands to claim; one read per
// session per run — a refusal caches as no row rather than retrying on
// every render, and the check-in's claim round clears the note
const onboardingAsides = new Map()

async function onboardingAsideOf(access) {
  if (onboardingAsides.has(access)) return onboardingAsides.get(access)
  let aside
  try {
    const payload = await tokenGet(TASKS_PATH, access)
    const code = businessCode(payload)
    if (code === SUCCESS && !AUTH_CODES.has(code)) {
      const pending = onboardingStateOf(payload)
      if (pending.length) {
        const sum = pending.reduce((n, task) => n + task.points, 0)
        const ws = wordsOf()
        aside = { name: ws.newcomer, used: 0, display: ws.claimable(sum, pending.length), aside: true }
      }
    }
  } catch {}
  onboardingAsides.set(access, aside)
  return aside
}

// ---- the chat forwarding and the error translation --------------------------------

// a sign-in the gateway has ended: a phone-code session has no way to renew
// (Loomy offers no refresh), so the only way on is signing in again — the
// marker is what tells magpie to ask for exactly that
function signInExpired() {
  const error = new Error(wordsOf().signInExpired)
  error.signIn = "expired"
  return error
}

// the words a refusal about the account's points carries, whichever plane
// said it — the full set, exhaust and limit included
const QUOTA = /insufficient|balance|credit|quota|exhaust|limit|余额|积分|额度|不足|用完|上限/i

// a refusal of these three statuses is about the quota only when its words
// say so; any other status never is, whatever its words
const quotaHit = (status, text) =>
  (Number(status) === 402 || Number(status) === 403 || Number(status) === 429) && QUOTA.test(String(text ?? ""))

// the wording an error body carries, whichever envelope it rode in: an
// OpenAI-style error.message, a bare message, Loomy's own desc, or a msg
function refusalText(text) {
  let msg = String(text ?? "").trim()
  try {
    const v = JSON.parse(String(text ?? ""))
    const found = [v?.error?.message, v?.message, v?.desc, v?.msg].find((w) => typeof w === "string" && w.trim())
    if (found) msg = found.trim()
  } catch {}
  return msg
}

// a quota refusal rewritten the way magpie routes on — 429 with
// rate_limit_error, so the routing group can take over with another
// account. No code field: magpie's reading of the rewrite needs none.
function translateQuota(status, text) {
  return new Response(
    JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "usage limit reached: " + refusalText(text) } }),
    { status: 429, statusText: "Too Many Requests", headers: { "content-type": "application/json" } }
  )
}

// a body whose business code is one of the two the client's own
// AUTH_ERROR_CODES call a dead sign-in
const authDead = (payload) => AUTH_CODES.has(businessCode(payload))

// answer is the gateway's answer as magpie reads it: every response the
// sign-in noted as kept; a refusal about the quota a 429 another account
// can take over from; and a dead sign-in thrown as the one end it has
// (Loomy offers no refresh, so there is nothing to retry). The order the
// last two are told apart in is the point: a refusal's body is read before
// the refusal is judged, because a gateway can refuse an account whose
// points are spent with a 403 — AutoClaw's gateway has been caught
// answering exactly that — and reading it as a dead session asks for a
// sign-in that would answer the same 403 again. So the quota statuses'
// bodies are read first and a quota refusal becomes the 429; only what the
// words didn't claim falls through to the sign-in's end, a 401 always (no
// quota status includes it) and a 403 that carried one of the two
// dead-session codes or no quota words at all. A 200 — stream included —
// passes through untouched, its body never read here: only the refusal
// statuses carry finite error payloads, never streams.
async function answer(res) {
  const headers = new Headers(res.headers)
  headers.set("X-Magpie-Sign-In", "kept")
  if (res.status !== 401 && res.status !== 402 && res.status !== 403 && res.status !== 429) {
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  }
  // a 401 is the sign-in's end outright: its body is not read — released,
  // not carried
  if (res.status === 401) {
    try {
      res.body?.cancel?.()
    } catch {}
    throw signInExpired()
  }
  const text = await res.text()
  headers.delete("content-length")
  headers.delete("content-encoding")
  if (quotaHit(res.status, text)) {
    const rewritten = translateQuota(res.status, text)
    rewritten.headers.set("X-Magpie-Sign-In", "kept")
    return rewritten
  }
  let payload
  try {
    payload = JSON.parse(text)
  } catch {}
  if (authDead(payload) || res.status === 403) throw signInExpired()
  return new Response(text, { status: res.status, statusText: res.statusText, headers })
}

export const LoomyAuthPlugin = async (input) => {
  noteHostDirectory(input?.directory)
  const { client } = input ?? {}
  return {
  // the provider entry a fresh config needs — name, npm package, api base
  // and the fallback model table keyed by id — each filled only where the
  // config doesn't say its own
  config: async (config) => {
    config.provider ??= {}
    config.provider[ID] ??= {}
    const p = config.provider[ID]
    p.name ??= "Loomy"
    p.npm ??= NPM
    p.api ??= apiBase()
    p.models ??= Object.fromEntries(FALLBACK_MODELS.map((m) => [m.id, configModelOf(m)]))
  },
  auth: {
    provider: ID,
    methods: [phoneCodeMethod], // the phone-code sign-in, the only way into a Loomy account
    loader(getAuth) {
      return {
        baseURL: apiBase(),
        apiKey: "loomy", // a placeholder the SDK asks for; the session token goes into the headers in the loader's fetch
        async fetch(input, init) {
          const auth = await getAuth()
          const access = typeof auth?.access === "string" ? auth.access.trim() : ""
          // no token and nowhere to get one (Loomy has no refresh): the
          // sign-in has to happen again
          if (!access) throw signInExpired()
          // the request arrives either as a Request or as (input, init);
          // the body comes from whichever of the two holds it
          const req = input instanceof Request ? input : null
          let body = init?.body
          if (body === undefined && req) body = await req.clone().text()
          // the session in both headers the gateway reads (the client's
          // authMode "token" dual write), and the Accept of a chat stream —
          // this plane's alone, the account and points planes take JSON
          const headers = new Headers(init?.headers ?? req?.headers)
          headers.delete("content-length")
          headers.set("token", access)
          headers.set("Authorization", "Bearer " + access)
          headers.set("Accept", "text/event-stream")
          const finalInit = {
            ...init,
            method: init?.method ?? req?.method ?? "POST",
            headers,
            ...(body !== undefined ? { body } : {}),
          }
          // a body this side of the SDK is a string or a stream; a stream
          // needs duplex "half" to ride a second fetch
          if (body !== undefined && typeof body !== "string" && finalInit.duplex === undefined) {
            finalInit.duplex = "half"
          }
          const res = await fetch(req ? req.url : input, finalInit)
          // the answer is judged on its whole self, body first: a 403 the
          // gateway words as the account's points having run out is a quota
          // refusal — the 429 answer() rewrites it into — not a dead
          // session; only the refusals the words don't claim are the
          // sign-in's end (answer throws those)
          return answer(res)
        },
      }
    },
    // the account's card: the summary off the records call, the user the
    // masked phone persisted with the credential at sign-in, and the
    // sign-in kept — its only end is the one the records call itself
    // reports
    async usage(getAuth) {
      const auth = await getAuth()
      const access = typeof auth?.access === "string" ? auth.access.trim() : ""
      if (!access) return { error: "not signed in" }
      try {
        const payload = await tokenGet(RECORDS_PATH, access)
        const code = businessCode(payload)
        if (AUTH_CODES.has(code)) throw signInExpired()
        if (code !== SUCCESS) {
          const text = upstreamMessage(payload)
          throw new Error(text ? wordsOf().pointsFailed(text) : wordsOf().pointsFailedCode(code))
        }
        let noted = pickNumber(auth.dailyQuota) ?? (await quotaNoteOf(String(auth.accountId ?? "")))
        if (noted === undefined) noted = await askQuotaOnce(client, auth, access)
        const card = {
          plan: "Loomy",
          ...usageOf(
            payload,
            noted,
            typeof auth.dailyCycleDate === "string" ? auth.dailyCycleDate : undefined
          ),
          user: auth.accountId || wordsOf().account,
          signIn: "kept",
        }
        // the one-time newcomer purse rides as an aside row while any of
        // it stands to claim — a refusal answers no row at all
        const aside = await onboardingAsideOf(access)
        if (aside) card.windows = [...card.windows, aside]
        return card
      } catch (e) {
        // a dead sign-in keeps its marker (thrown here or by the gateway's
        // own 401/403); every other failure is a kept sign-in's bad answer
        return { error: e?.message ?? String(e), ...(e?.signIn ? { signIn: e.signIn } : { signIn: "kept" }) }
      }
    },
    // the daily first-login: Loomy's grant renewal as the claim magpie runs
    // once a day; its outcome lands on the same card
    async checkin(getAuth) {
      const auth = await getAuth()
      const access = typeof auth?.access === "string" ? auth.access.trim() : ""
      if (!access) return { outcome: "failed", message: "not signed in" }
      try {
        const payload = await tokenPost(FIRST_LOGIN_PATH, {}, access)
        // the grant's size, kept for the card before the claim is read — a
        // note that must never break the claim itself
        await rememberQuota(client, auth, pickNumber(pointsFloor(payload)?.dailyQuota), cycleDateOf(payload))
        const claim = checkinOf(payload)
        // the newcomer tasks, claimed behind the daily grant and beside its
        // wording — best-effort, one at a time, and never a word about a
        // failure among them; the round clears the card's aside note
        const tail = await claimOnboarding(access)
        onboardingAsides.set(access, undefined)
        return tail ? { ...claim, message: claim.message + tail } : claim
      } catch (e) {
        return { outcome: "failed", message: e?.message ?? String(e), ...(e?.signIn ? { signIn: e.signIn } : {}) }
      }
    },
  },
  provider: {
    id: ID,
    // the live list off the model gateway, asked with the session token:
    // the chat models, and beside them the image generators the roster
    // vouches for, each only while this answer still names it — it wins
    // when it answers with anything usable, and the fallback table (chat
    // models alone, no gated entry without a live answer to gate it by)
    // answers when there is no session to ask with, when the answer parses
    // to nothing, or when the ask fails any other way. The one failure
    // passed on is the sign-in's end — magpie should ask for the sign-in
    // again, not be shown a stale table as if it were live.
    async models(p, { auth }) {
      const access = typeof auth?.access === "string" ? auth.access.trim() : ""
      if (!access) return fallbackOf(p)
      try {
        const payload = await tokenGet("/api/v1/models", access)
        const models = [...parseModels(payload), ...imageModelsOf(payload)]
        if (!models.length) return fallbackOf(p)
        return Object.fromEntries(models.map((m) => [m.id, providerModelOf(m, p.id)]))
      } catch (e) {
        if (e?.signIn === "expired") throw e
        return fallbackOf(p, true)
      }
    },
  }
  }
}

// the storage key the v2 renewal notes the grant's size under — declared
// here, above the _internal face that hands it to the panel, because a
// const does not hoist the way the function declarations around it do
const V2_QUOTA_KEY = "loomy-auth/quota-size"

// ---- the desktop panel's rpc, the GUI's one channel to the numbers ---------------
// The desktop OpenCode ships the package's ./gui-experimental bundle into its
// windows, and a window reads its numbers only through the app's own client —
// the renderer never holds the gateway's credential, and a GUI asking the
// gateway on its own would ride a CORS allowance that is the desktop's own
// undocumented doing, not a surface anyone promises. So the numbers cross one
// bridge: an RPC the server part registers in v2Setup, on the v2 host's rpc
// domain (feature-detected, the way every domain there is — a host without
// one loads the plugin whole and gives the GUI no channel), whose two methods
// run the very machinery the TUI panel runs. The bundle carries its own copy
// of the contract literal (pure JSON Schema, a dependency of neither side);
// the tests read both copies and hold them together.
//
// The contract: two methods, no events, the schemas loose (type: object —
// these payloads are the panel's readouts, not a public surface anyone else
// validates). No rpc.* error names declared, none of the framework's
// reserved ones: a handler answers its refusals as data, states the panel
// renders, the way the TUI panel's snapshot keeps — never a throw the wire
// would word as an internal error. The const sits here, beside the storage
// key above it, for the same reason that one does: the _internal face below
// hands it to the tests, and a const does not hoist.
const V2_RPC = {
  id: "loomy-auth-quota",
  methods: {
    status: { input: { type: "object" }, output: { type: "object" } },
    checkin: { input: { type: "object" }, output: { type: "object" } },
  },
  events: {},
}

// v2QuotaStatus is the panel's one read — the TUI panel's snapshot in the
// rpc's own shape: the credential out of the connection domain (the same
// reading v2Refresh makes — the token, the masked phone, the grant's fields
// when a magpie-side check-in wrote them), the renewal's storage note behind
// it, the file note behind that, and the records call through usageOf over
// it all. Every step is feature-detected and wrapped: a host without the
// domain, a connection with no token, a dead sign-in, a bad answer — each is
// a state the method answers, never a throw.
//
// The answer crosses the rpc's output encoder, which refuses a key holding
// undefined ("Expected JSON value at [\"error\"]") — an absent field must be
// absent, not present as undefined. So the optional keys are left out when
// they carry no value.
async function v2QuotaStatus(ctx) {
  let access = ""
  let accountId = ""
  let noted
  let cycle
  try {
    const connection = await ctx?.integration?.connection?.active?.(ID)
    if (connection) {
      const credential = await ctx.integration.connection.resolve?.(connection)
      access = typeof credential?.access === "string" ? credential.access.trim() : ""
      accountId = typeof credential?.metadata?.accountId === "string" ? credential.metadata.accountId.trim() : ""
      noted = pickNumber(credential?.metadata?.dailyQuota)
      cycle =
        typeof credential?.metadata?.dailyCycleDate === "string" && credential.metadata.dailyCycleDate.trim()
          ? credential.metadata.dailyCycleDate.trim()
          : undefined
    }
  } catch {} // a refused domain reads as signed out; the read never throws
  if (!access) return { signedIn: false, expired: false, accountId }
  // the renewal's storage note: the same defensive read the domain above
  // keeps — a missing domain, a throwing one, an unreadable value all
  // answer nothing, and the sources behind it go on
  if (noted === undefined || cycle === undefined) {
    try {
      const size = await ctx?.storage?.get?.(V2_QUOTA_KEY)
      if (noted === undefined) noted = pickNumber(size?.dailyQuota)
      if (cycle === undefined) {
        cycle = typeof size?.dailyCycleDate === "string" && size.dailyCycleDate.trim() ? size.dailyCycleDate.trim() : undefined
      }
    } catch {}
  }
  try {
    const payload = await tokenGet(RECORDS_PATH, access)
    const code = businessCode(payload)
    // the sign-in's end is the records answer's own verdict or the gateway's
    // own 401/403 (the throw's marker below) — the V1 hook's same two reads
    if (AUTH_CODES.has(code)) return { signedIn: false, expired: true, accountId }
    if (code !== SUCCESS) {
      const text = upstreamMessage(payload)
      const w = wordsOf()
      return { signedIn: true, expired: false, accountId, error: text ? w.pointsFailed(text) : w.pointsFailedCode(code) }
    }
    if (noted === undefined) noted = await quotaNoteOf(accountId)
    return { signedIn: true, expired: false, accountId, card: usageOf(payload, noted, cycle) }
  } catch (e) {
    if (e?.signIn === "expired") return { signedIn: false, expired: true, accountId }
    return { signedIn: true, expired: false, accountId, error: e?.message ?? String(e) }
  }
}

// v2QuotaCheckin is the panel's check-in: the same first-login call the TUI
// panel's action makes, worded by the same checkinOf, its failures worded
// the same way the TUI's catch words them. Behind the claim — best-effort,
// never a word about a refusal among it — the grant's size is noted into the
// host's storage the way the renewal notes it, so the refreshed read that
// follows the check-in shows the share at once.
async function v2QuotaCheckin(ctx) {
  let access = ""
  try {
    const connection = await ctx?.integration?.connection?.active?.(ID)
    if (connection) {
      const credential = await ctx.integration.connection.resolve?.(connection)
      access = typeof credential?.access === "string" ? credential.access.trim() : ""
    }
  } catch {} // a refused domain reads as signed out; the claim never throws
  if (!access) return { outcome: "failed", message: wordsOf().signInExpired }
  try {
    const payload = await tokenPost(FIRST_LOGIN_PATH, {}, access)
    try {
      const quota = pickNumber(pointsFloor(payload)?.dailyQuota)
      const cycleDate = cycleDateOf(payload)
      if (quota !== undefined || cycleDate !== undefined) {
        const size = { ...(quota !== undefined ? { dailyQuota: quota } : {}), ...(cycleDate !== undefined ? { dailyCycleDate: cycleDate } : {}) }
        await ctx?.storage?.set?.(V2_QUOTA_KEY, size)
      }
    } catch {}
    return checkinOf(payload)
  } catch (e) {
    return e?.signIn === "expired"
      ? { outcome: "failed", message: wordsOf().signInExpired }
      : { outcome: "failed", message: e?.message ?? String(e) }
  }
}

// for tests
export const _internal = {
  FALLBACK_MODELS,
  escapedPath,
  stringToSign,
  contentMd5,
  signHeader,
  normalizePhone,
  extractMsgid,
  maskPhone,
  businessCode,
  upstreamMessage,
  describeLoginError,
  traceid,
  makeBase,
  caccountPost,
  tokenGet,
  tokenPost,
  signInExpired,
  quotaHit,
  refusalText,
  translateQuota,
  authDead,
  answer,
  pickNumber,
  usageOf,
  checkinOf,
  quotaCacheFile,
  noteHostDirectory,
  wordsOf,
  quotaAsksFailed,
  QUOTA_ASK_RETRY_MS,
  quotaNoteOf,
  noteQuota,
  rememberQuota,
  askQuotaOnce,
  ONBOARDING_TASKS,
  onboardingStateOf,
  claimOnboarding,
  onboardingAsideOf,
  beijingCycleResetAt,
  splitRateSuffix,
  IMAGE_WORDS,
  IMAGE_MODELS,
  parseModels,
  imageModelsOf,
  configModelOf,
  providerModelOf,
  fallbackOf,
  v2BeijingDay,
  v2Renew,
  // the desktop panel's rpc: the contract literal (the bundle carries its
  // own copy; the tests hold the two together) and the two methods the
  // registration wraps — the panel's read and the panel's claim, the same
  // machinery the TUI panel runs
  V2_RPC,
  v2QuotaStatus,
  v2QuotaCheckin,
  // the four constants the TUI panel reads beside the functions above: the
  // same literals the hooks use, exported so the panel's numbers and its
  // check-in travel the exact paths the server side does (a named export
  // neither host's loader touches — magpie's short-circuits on the default,
  // the v2 one reads the default alone)
  SUCCESS,
  AUTH_CODES,
  RECORDS_PATH,
  FIRST_LOGIN_PATH,
  V2_QUOTA_KEY, // the storage key the renewal noted the grant's size under — the panel's second source for it
}

// ==== the opencode v2 adapter ======================================================

// OpenCode 2.x loads a plugin by another contract than the named function
// above: a default export naming an id and a setup, the setup handed the
// host's own context and returning the function to run at unload. The V1
// hosts read the named export and never see this default; the v2 host reads
// the default and ignores the named exports. Both shapes ship in the one
// file — no @opencode/plugin import (its define() is the identity anyway),
// so the package keeps its zero dependencies.
//
// The v2 side also works differently underneath. There is no per-request
// fetch to write: the provider record names an integration, and the host
// itself resolves that integration's active connection into the request's
// Authorization header before the call goes out — the sign-in gate, the
// token injection and the streaming are the host's own machinery. What this
// side registers is the shape of things: the sign-in method under the
// integration, the provider and its model rows under the provider domain,
// and a listener on the credential events that re-asks the live model list
// whenever the account behind it changes — the day's first-login renewal
// riding silently behind the same events, a half-hour timer between them.
//
// None of it may break the host: every domain is feature-detected (a step's
// domain missing means the step is skipped, not a failed load), every step
// is wrapped, and the setup never throws — the worst a half-hearted host
// gets is the parts of the plugin it has domains for.

const V2_METHOD_ID = "phone-code" // the method's id under the loomy integration
// the bundled openai-compatible module the host ships — the docs' own
// spelling of the provider record's package field ("@ai-sdk/openai-compatible"
// remaps onto the same module)
const V2_PACKAGE = "@opencode/ai/providers/openai-compatible"

// the display names as the vendors themselves spell them, keyed by the
// lowercase model id — the ids arrive in any case (Kimi-k2.6, qwen3.8-flash,
// glm-5.3-flash) and the gateway's own names are marketing strings
// ("Spark-X2.6 正式版(限时免费)", "qwen 3.8 flash"), so the rows carry the
// official spellings read off each vendor's own pages
const V2_NAMES = {
  "spark-x2.6": "Spark X2.6",
  "deepseek-v4.1-flash": "DeepSeek V4.1 Flash",
  "minimax-m3": "MiniMax M3",
  "kimi-k2.6": "Kimi K2.6",
  "qwen-3.8-max": "Qwen 3.8 Max",
  "qwen3.8-flash": "Qwen 3.8 Flash",
  "glm-5.3-flash": "GLM 5.3 Flash",
  "mimo-v2.5": "MiMo V2.5",
  auto: "自动 · 均衡",
}

// the brand words in the vendors' own spellings, for a row the name table
// doesn't know: the gateway writes its brand words in any case (qwen, GLM,
// kimi…) and the leading word alone is set right — no title-casing past it,
// the version tokens kept as the gateway wrote them
const V2_BRANDS = {
  spark: "Spark",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  kimi: "Kimi",
  qwen: "Qwen",
  glm: "GLM",
  mimo: "MiMo",
}

// v2DisplayName is such a stranger's display name: the record's own name
// (the FALLBACK and live rows both carry theirs without the rate suffix)
// or its id, with the first segment — cut at a space or a hyphen — swapped
// for the brand table's spelling when its lowercase reads as a brand word.
// A name the table doesn't touch keeps itself whole.
function v2DisplayName(m) {
  const raw = m.name || m.id
  const at = raw.search(/[\s-]/)
  const head = at === -1 ? raw : raw.slice(0, at)
  const brand = V2_BRANDS[head.toLowerCase()]
  return brand === undefined ? raw : brand + raw.slice(head.length)
}

// the effort levels each vendor itself vouches for, keyed by the lowercase
// model id — read off the vendors' own doc pages on 2026-11-04, a level at
// a time, not off the gateway's declaration (which serves every thinking
// row the same five values, aliases and all). The rule for what makes the
// table: a level counts only where the vendor spells it as a gear of its
// own — an alias a vendor documents as silently mapping onto another depth
// (DeepSeek's medium and xhigh both land on high, Qwen's high is xhigh,
// MiMo's xhigh lands on high) is that depth wearing a second name, not a
// gear, and the menu carries no duplicates. Row by row, the source in
// brackets:
// — spark-x2.6: none/low/high, the model card's own thinking-budget gears;
//   no medium, no xhigh [huggingface.co, the Spark-X2.6 card]
// — spark-x: the same three, an inference drawn from the series rather
//   than a doc (the id is fallback-only, off the live list already)
// — deepseek-v4.1-flash: none/low/high — the docs enumerate none/low/high/
//   max, medium and xhigh are documented aliases of high, and max is a
//   depth the gateway never declares [api-docs.deepseek.com]
// — minimax-m3: all five — the Responses schema takes none/low/medium/
//   high/xhigh whole [platform.minimax.io]
// — kimi-k2.6: none alone. K2.6 has no reasoning_effort at all (thinking
//   runs on thinking.type's two-value switch; the three-gear enumeration
//   belongs to the K3 series), and only none's turn-it-off meaning is real
//   here: measured through the gateway, none answers with zero thinking,
//   low and high restate the depth the gateway already runs by default,
//   and xhigh measurably breaks — zero thinking again
//   [platform.kimi.com]
// — qwen-3.8-max and qwen3.8-flash: none/low/medium/xhigh — the native
//   gears plus none for thinking off; high is the docs' own alias of xhigh
//   and stays off the menu rather than showing the same gear twice
//   [help.aliyun.com]
// — glm-5.3-flash: low/high — the docs enumerate low/high/max, thinking
//   cannot be turned off at all (no none), medium and xhigh do not exist,
//   and max is again a depth the gateway never declares
//   [docs.bigmodel.cn]
// — mimo-v2.5: none/low/medium/high — the schema takes eight values, but
//   xhigh/max/ultra are documented aliases of high and minimal maps to low
//   [mimo.mi.com]
const V2_LEVELS = {
  "spark-x2.6": ["none", "low", "high"],
  "spark-x": ["none", "low", "high"],
  "deepseek-v4.1-flash": ["none", "low", "high"],
  "minimax-m3": ["none", "low", "medium", "high", "xhigh"],
  "kimi-k2.6": ["none"],
  "qwen-3.8-max": ["none", "low", "medium", "xhigh"],
  "qwen3.8-flash": ["none", "low", "medium", "xhigh"],
  "glm-5.3-flash": ["low", "high"],
  "mimo-v2.5": ["none", "low", "medium", "high"],
}

// v2VariantsOf is a row's picker levels as variants, three filters deep.
// The bone is the official table: an id the table knows keeps only the
// levels its vendor vouches for — the live row's own reasoning_efforts
// declaration (rowModelOf's efforts) intersected with the table when one
// rides the row, the declaration's own order kept; the table itself when
// none does (a snapshot row declares nothing). An id the table doesn't
// know (auto included) is a stranger, and a stranger's levels are the
// gateway's declaration as it stands — Loomy's own contract, not ours to
// second-guess for a vendor we cannot check; nothing declared and nothing
// in the table hang nothing. The variant's id is what the picker reads,
// the body overlay what the host merges into the request JSON —
// reasoningEffort, the camelCase field the gateway itself parses (the
// OpenAI snake_case spelling it never reads). The picker's own Default
// sends no reasoningEffort at all, which is the gateway's default gear —
// each vendor's own default differs, and the gateway's is the one that
// actually applies.
function v2VariantsOf(m) {
  const official = V2_LEVELS[m.id.toLowerCase()]
  const declared = m.efforts // the live row's own reasoning_efforts declaration; a snapshot row carries none
  const levels = official
    ? (declared ?? official).filter((level) => official.includes(level))
    : declared ?? []
  return levels.map((effort) => ({ id: effort, body: { reasoningEffort: effort } }))
}

let v2Live = null // the live chat rows (parseModels' short records), or null for the snapshot
let v2Disposers = [] // the run's registrations, given up wholesale at cleanup

// modelV2Of is one short model record — a FALLBACK_MODELS row or a
// parseModels row, the same shape either way — as a v2 Model.Info spells it:
// the id three times over (the record's, the model's, the provider's), the
// display name from the official table (a stranger's cleaned gateway name
// with its brand word set right), the capability bits under the names the
// host reads there, the limits, a zero cost — the gateway's rate is a Loomy
// fact the v2 record has no field for. The rate, free and reasoning bits
// stay behind: fields the v2 record doesn't know, dropped rather than
// smuggled in.
//
// The release time is a deliberate zero, and the picker is why. The desktop
// host hides a model that has no show record of its own while it is not the
// newest of its family and its release date parses — one row per family
// survives, the rest fold away — and these rows ship no family at all, so a
// shared date on every one of them (the snapshot's own stamp, say) would
// leave a single "newest" visible and hide all the others. A zero the host
// renders as an empty release date parses to no date, and the same official
// rule keeps a model without a parseable date visible: every row shows by
// default, the choosing left to the user.
function modelV2Of(m, providerID = ID) {
  return {
    id: m.id,
    modelID: m.id,
    providerID,
    name: V2_NAMES[m.id.toLowerCase()] ?? v2DisplayName(m),
    package: V2_PACKAGE,
    capabilities: {
      tools: m.toolcall !== false,
      input: m.vision === true ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    limit: { context: m.context ?? 0, output: m.output ?? 0 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    time: { released: 0 },
    // the picker's levels as variants: the official table's real gears and
    // the gateway's own declaration intersected, a stranger's declaration
    // as it stands — the whole of it spelled out at v2VariantsOf above
    variants: v2VariantsOf(m),
  }
}

// providerInfoOf is the provider record: the loomy integration behind it and
// the base URL the host forwards to. Activation "auto" is the sign-in gate
// itself — the provider is listed only while the integration has an active
// connection, which is to say only while the account is signed in.
function providerInfoOf() {
  return {
    id: ID,
    name: "Loomy",
    activation: "auto", // listed once the sign-in exists, gone when it ends
    package: V2_PACKAGE,
    settings: { baseURL: apiBase() },
    integrationID: ID,
  }
}

// v2Models is the model rows the provider carries: the live list while one
// was had, the snapshot otherwise — the same precedence the V1 models hook
// keeps, read from the cache instead of at ask-time.
const v2Models = (providerID = ID) => (v2Live ?? FALLBACK_MODELS).map((m) => modelV2Of(m, providerID))

// v2Transform is the provider domain's registration callback: the editor's
// get tells a provider already on the books (an earlier run's, or the host's
// own config) from a fresh one — the first takes the model rows set over it,
// the second is added whole with its info record.
function v2Transform(editor) {
  if (editor?.get?.(ID)) {
    editor.models?.set?.(ID, v2Models(ID))
  } else {
    editor?.add?.({ info: providerInfoOf(), models: v2Models(ID) })
  }
}

// v2Method is the phone-code sign-in as an integration method registration.
// The V1 method's authorize already does the whole flow — validate the
// phone, send the code, check it — so this is the same machinery in the
// registration's shape: the form field is the V1 prompt's own words, the
// authorize's answer is the authz record the host walks (mode "code": show
// the instructions, take the texted code into the callback), and the
// callback's success becomes the credential record the host keeps — its
// five fields, the masked phone and the uid in the metadata. A failed check
// throws: the host reads a throw out of the callback as the sign-in's
// failure, the same end the V1 method's authorize throws its own.
function v2Method() {
  return {
    integrationID: ID,
    method: {
      id: V2_METHOD_ID,
      type: "oauth",
      label: phoneCodeMethod.label,
      form: [
        {
          key: "phone",
          type: "string",
          title: phoneCodeMethod.prompts[0].message,
          required: true,
          placeholder: phoneCodeMethod.prompts[0].placeholder,
        },
      ],
    },
    authorize: async (answer) => {
      const attempt = await phoneCodeMethod.authorize({ phone: answer?.phone == null ? "" : String(answer.phone) })
      return {
        url: attempt.url,
        instructions: attempt.instructions,
        mode: "code",
        async callback(code) {
          const res = await attempt.callback(code)
          if (res?.type !== "success") throw new Error(res?.error || "登录失败")
          return {
            type: "oauth",
            methodID: V2_METHOD_ID,
            refresh: res.refresh || "",
            access: res.access,
            expires: res.expires,
            metadata: { accountId: res.accountId, uid: res.uid },
          }
        },
      }
    },
  }
}

// v2BeijingDay is the Beijing calendar day a moment falls in — the day
// Loomy's own grant cycles turn on (the V1 card's arithmetic keeps the
// same 8-hour shift at BEIJING_OFFSET_MS), so the renewal's once-a-day
// mark is keyed by that day and not the host's local one: a session in
// Berlin still counts as the same Loomy day the endpoint does.
function v2BeijingDay(now = Date.now()) {
  return new Date(now + 8 * 3600e3).toISOString().slice(0, 10)
}

// v2Renew is the daily silent renewal — the V1 first-login claim carried
// on the v2 host's own back: the credential out of the integration's
// active connection (the same reading v2Refresh makes), the same
// first-login endpoint the client hits on every sign-in, idempotent for
// the day. The host's storage is one flat shared keyspace with no
// per-plugin scoping, so the mark's key carries the plugin's namespace
// itself. A day already renewed returns before any ask; a connection
// with no token returns before one; and only the endpoint's own success
// code writes the mark — a business failure leaves it off, the next tick
// asking again. Nothing here is ever reported: whatever the renewal
// meets — no storage domain, a refused ask, a business failure — is a
// silent return, the retry being the next event, the next half hour, or
// the next day.
//
// The renewal also carries the grant's size home. The answer it already
// pays for names dailyQuota (and the cycle date with it), the same read
// the V1 check-in makes of the same answer (pickNumber over pointsFloor,
// cycleDateOf beside it), and the v2 credential's metadata carries no
// such fields — the sign-in writes only accountId and uid — so a pure-v2
// account's panel would never find a size anywhere else: the records
// answer carries the remaining alone, and the file note only a magpie
// check-in writes. So a successful renewal notes the pair in the host's
// own storage, under its own namespaced key: whichever fields the answer
// actually carries go in (a missing one is left out, never invented),
// and the write is best-effort beside the day's own mark — a refusing
// store costs the panel its percentage, never the renewal its claim.
const V2_RENEWAL_KEY = "loomy-auth/renewal/last" // the day's mark, namespaced: the keyspace is the host's own
const V2_RENEWAL_INTERVAL_MS = 30 * 60_000 // the between-ticks rest: a half hour, not a spin

async function v2Renew(ctx) {
  try {
    if (typeof ctx?.storage?.get !== "function" || typeof ctx?.storage?.set !== "function") return
    const today = v2BeijingDay(Date.now())
    const last = await ctx.storage.get(V2_RENEWAL_KEY)
    if (last === today) return
    const connection = await ctx?.integration?.connection?.active?.(ID)
    if (!connection) return
    const credential = await ctx.integration.connection.resolve?.(connection)
    const access = typeof credential?.access === "string" ? credential.access.trim() : ""
    if (!access) return
    const payload = await tokenPost(FIRST_LOGIN_PATH, {}, access)
    if (businessCode(payload) === SUCCESS) {
      await ctx.storage.set(V2_RENEWAL_KEY, today)
      // the same size-and-cycle read the V1 check-in makes of the same
      // answer — the panel's percentage rides on it, silently
      const quota = pickNumber(pointsFloor(payload)?.dailyQuota)
      const cycleDate = cycleDateOf(payload)
      if (quota !== undefined || cycleDate !== undefined) {
        const size = { ...(quota !== undefined ? { dailyQuota: quota } : {}), ...(cycleDate !== undefined ? { dailyCycleDate: cycleDate } : {}) }
        await ctx.storage.set(V2_QUOTA_KEY, size)
      }
    }
  } catch {} // the renewal is never worth a failure: silent, whatever it meets
}

// v2Refresh re-asks the live model list and replays the provider transform:
// read off at setup and again on every credential event, because the rows
// are the account's own — a fresh sign-in may name models the snapshot never
// knew. The credential comes from the host's connection domain (the active
// connection for the loomy integration, resolved), the ask is the same
// /api/v1/models the V1 hook makes, and any refusal — no connection, no
// token, a failed ask, an empty answer — falls back to the snapshot by way
// of a null cache, swallowed whole: a stale model list is never worth a
// failed load, and a failed ask resets the cache rather than keeping the
// previous account's rows. The replay is the host's reload (it re-runs the
// registered transforms against its own editors); a host without one keeps
// the rows until its next replay. Nothing here throws, whatever the host's
// domains turn out to be.
async function v2Refresh(ctx) {
  let rows = null
  try {
    const connection = await ctx?.integration?.connection?.active?.(ID)
    if (connection) {
      const credential = await ctx.integration.connection.resolve?.(connection)
      const access = typeof credential?.access === "string" ? credential.access.trim() : ""
      if (access) {
        const payload = await tokenGet("/api/v1/models", access)
        const parsed = parseModels(payload)
        if (parsed.length) rows = parsed
      }
    }
  } catch {} // the ask's refusal is the snapshot's turn, never a failed refresh
  v2Live = rows
  try {
    if (typeof ctx?.provider?.reload === "function") await ctx.provider.reload()
  } catch {}
}

// v2Setup is the registration itself, in the order the host needs it: the
// integration (its name and its sign-in method), the provider (info and
// rows), the credential events (each one a refresh, each one the day's
// renewal behind it), then the first refresh
// — an account signed in before this run started gets its live list at
// once — and the renewal wired behind it, at start, at every event, and
// on a half-hour timer whose clearing rides among the disposers. A repeat
// setup (a host that loads twice, a test's second context)
// gives up the previous run's registrations first. The cleanup runs the
// disposals the registrations answered — a synchronous call each, whatever
// they return — and the subscription's abort rides among them.
async function v2Setup(ctx) {
  for (const dispose of v2Disposers.splice(0)) {
    try {
      await dispose()
    } catch {}
  }
  v2Live = null
  // the integration: the name beside the id, and the sign-in method under it
  try {
    if (typeof ctx?.integration?.transform === "function") {
      const registration = await ctx.integration.transform((editor) => {
        editor.update?.(ID, (item) => {
          item.name = "Loomy"
        })
        editor.method?.update?.(v2Method())
      })
      if (typeof registration?.dispose === "function") v2Disposers.push(registration.dispose)
    }
  } catch {}
  // the provider: info and rows, added or set over what's there
  try {
    if (typeof ctx?.provider?.transform === "function") {
      const registration = await ctx.provider.transform(v2Transform)
      if (typeof registration?.dispose === "function") v2Disposers.push(registration.dispose)
    }
  } catch {}
  // the desktop panel's rpc: the two methods above, the GUI's one channel —
  // a host without the rpc domain skips it, the plugin whole regardless
  try {
    if (typeof ctx?.rpc?.register === "function") {
      const registration = await ctx.rpc.register(V2_RPC, {
        status: () => v2QuotaStatus(ctx),
        checkin: () => v2QuotaCheckin(ctx),
      })
      if (typeof registration?.dispose === "function") v2Disposers.push(registration.dispose)
    }
  } catch {}
  // the credential events: a sign-in, a switch, an integration update — each
  // a fresh live list, a replay, and the day's renewal behind them. The
  // subscription is awaited before the walk (a host's subscribe may be an
  // async function answering the iterable, or a plain one returning it —
  // await reads both the same), the walk is aborted at cleanup, and an
  // unknown type name is the host's warning, not an error here.
  try {
    if (typeof ctx?.event?.subscribe === "function") {
      const controller = new AbortController()
      void (async () => {
        try {
          for await (const _event of await ctx.event.subscribe({
            types: ["credential.updated", "credential.switched", "integration.updated"],
            signal: controller.signal,
          })) {
            await v2Refresh(ctx)
            void v2Renew(ctx) // fire-and-forget: the renewal is silent, whatever it meets
          }
        } catch {}
      })()
      v2Disposers.push(() => controller.abort())
    }
  } catch {}
  // the first refresh: a signed-in account's live list, without waiting for
  // an event that may never come
  try {
    await v2Refresh(ctx)
  } catch {}
  // the daily renewal: once now, once after every credential event, and on
  // a half-hour timer between the two — the day's first-login claim made
  // whatever hour the host was started at. Fire-and-forget: v2Renew wraps
  // its whole body, so the promise never rejects and the renewal is never
  // worth a failed setup; the timer's clearing rides among the disposers,
  // the same giving-up the registrations answer. The timer unrefs itself
  // the way the reference plugin's does (the optional chain for a host
  // whose timer object carries no unref): an unreffed interval never holds
  // the host's own natural exit open — the renewal keeps its half hour
  // only while the process lives, never the other way around.
  void v2Renew(ctx)
  const renewalTimer = setInterval(() => v2Renew(ctx), V2_RENEWAL_INTERVAL_MS)
  renewalTimer.unref?.()
  v2Disposers.push(() => clearInterval(renewalTimer))
  return () => {
    for (const dispose of v2Disposers.splice(0)) {
      try {
        dispose()
      } catch {}
    }
  }
}

// server is the third contract, the one the object-entrypoint readers call —
// magpie's own host among them (its loader answers a default export carrying
// an id by the server function under it and never reaches the named-export
// scan). The V1 factory needs no reshaping: the caller hands it the same
// input the named export took, and the hooks it answers are the V1 hooks.
// One module, three shapes, the same machinery under each.
export default {
  id: "loomy-auth",
  setup: v2Setup,
  server: (input) => LoomyAuthPlugin(input),
}
