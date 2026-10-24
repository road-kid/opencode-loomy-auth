// The phone-code sign-in against a fake of the account host: sendMsgCode for
// the msgid (the field has shipped on two floors under two spellings — each of
// the four candidates takes its turn below), checkCode for the fourteen-day
// session. The whole signed envelope is checked on the wire: the account
// Authorization recomputed over exactly the bytes the request carried, the
// Date/Nonce/Content-MD5 triple, and the base's fields. An authorize failure
// throws (answering {type:"failed"} there would have the host take the "auto"
// branch and call callback with no code); a callback failure is a
// {type:"failed"} answer.
import "./nonet.mjs"
import { afterEach, beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { LoomyAuthPlugin, _internal } from "./index.mjs"
import { fakeLoomy, json, pointAt } from "./fake.mjs"

// plainly test values, not credentials; the plugin reads the pair from the
// environment when it signs, which is what lets this check recompute the
// signature with them
const KEY_ID = "test-access-key-id"
const KEY_SECRET = "test-access-key-secret"
const PHONE = "13800138000"

let f
let restore
let wasKeys
let hooks
beforeEach(async () => {
  f = await fakeLoomy()
  restore = pointAt(f.origin)
  wasKeys = {
    id: process.env.LOOMY_XFYUN_ACCESS_KEY_ID,
    secret: process.env.LOOMY_XFYUN_ACCESS_KEY_SECRET,
    app: process.env.LOOMY_XFYUN_APP_ID,
  }
  process.env.LOOMY_XFYUN_ACCESS_KEY_ID = KEY_ID
  process.env.LOOMY_XFYUN_ACCESS_KEY_SECRET = KEY_SECRET
  delete process.env.LOOMY_XFYUN_APP_ID // the envelope's appid is the client's own
  hooks = await LoomyAuthPlugin({ client: {} })
})
afterEach(async () => {
  for (const [key, value] of Object.entries({ "LOOMY_XFYUN_ACCESS_KEY_ID": wasKeys.id, "LOOMY_XFYUN_ACCESS_KEY_SECRET": wasKeys.secret, "LOOMY_XFYUN_APP_ID": wasKeys.app })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  restore()
  await f.close()
})

// the account-plane envelope as it should have gone out: the Authorization is
// the nine-line HMAC over exactly the bytes the request carried, recomputed
// here from what the fake saw, and the base is the client's own _makeBase()
const checkEnvelope = (r) => {
  assert.equal(r.method, "POST")
  assert.ok(r.headers.authorization.startsWith("account "), "Authorization is an account signature")
  assert.ok(r.headers.date, "Date is sent")
  assert.ok(r.headers.nonce, "Nonce is sent")
  const md5 = createHash("md5").update(r.text, "utf8").digest("base64")
  assert.equal(r.headers["content-md5"], md5) // the MD5 covers the wire's own bytes
  const s = ["POST", r.path, "", md5, "application/json", r.headers.date, r.headers.nonce, "", ""].join("\n")
  assert.equal(r.headers.authorization, `account ${KEY_ID}:${createHmac("sha1", KEY_SECRET).update(s, "utf8").digest("base64")}`)
  assert.equal(r.headers["content-type"], "application/json")
  assert.equal(r.headers.accept, "application/json")
  const base = r.json?.base ?? {}
  assert.equal(base.appid, "GM3LOOMY")
  assert.equal(base.modelid, "Web")
  assert.equal(base.version, "1.0.0")
  assert.equal(base.devid, "web")
  assert.equal(base.ua, "Loomy|Desktop|Electron|macOS")
  assert.match(base.traceid, /^[0-9a-f]{32}$/)
}

const authorize = (phone) => hooks.auth.methods[0].authorize({ phone })
const sendAnswer = (v) => f.route("POST /login/phone/sendMsgCode", () => json(v))
const checkAnswer = (v) => f.route("POST /login/phone/checkCode", () => json(v))

test("the msgid is found on each of the four shipping paths, once each", async () => {
  const shapes = [
    ["m1", { code: "000000", data: { msgid: "m1" } }],
    ["m2", { code: "000000", data: { msgId: "m2" } }],
    ["m3", { code: "000000", data: { data: { msgid: "m3" } } }],
    ["m4", { code: "000000", data: { data: { msgId: "m4" } } }],
  ]
  for (const [msgid, answer] of shapes) {
    sendAnswer(answer)
    checkAnswer({ code: "000000", data: { session: "sess-" + msgid, userid: "u-" + msgid } })
    const start = await authorize(PHONE)
    const out = await start.callback("123456")
    assert.equal(out.type, "success")
    assert.equal(out.access, "sess-" + msgid)
    const checks = f.seen.filter((r) => r.path === "/login/phone/checkCode")
    assert.equal(checks.at(-1).json.param.msgid, msgid) // the candidate that answered is the msgid carried back
  }
  assert.deepEqual(
    f.seen.filter((r) => r.path === "/login/phone/checkCode").map((r) => r.json.param.msgid),
    ["m1", "m2", "m3", "m4"]
  )
})

test("the signed envelope goes out whole, on both calls of the chain", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "000000", data: { session: "sess-1", userid: "uid-1" } })
  const start = await authorize("+86 138-0013-8000") // cleaned before it is judged
  const send = f.seen.find((r) => r.path === "/login/phone/sendMsgCode")
  checkEnvelope(send)
  assert.deepEqual(send.json.param, { ccode: "86", phone: PHONE, expire: 300 }) // the code lives five minutes
  await start.callback("123456")
  const check = f.seen.find((r) => r.path === "/login/phone/checkCode")
  checkEnvelope(check)
  assert.deepEqual(check.json.param, { ccode: "86", phone: PHONE, mcode: "123456", msgid: "mid-1", expire: 1209600 }) // fourteen days
})

test("a success answers the credential magpie persists", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "000000", data: { session: "sess-1", userid: "uid-1" } })
  const start = await authorize(PHONE)
  assert.equal(start.method, "code") // the host asks for the texted code and hands it to callback
  assert.equal(start.url, "")
  assert.ok(start.instructions.includes("138****8000"), "the instructions show the masked phone")
  const out = await start.callback("123456")
  assert.equal(out.type, "success")
  assert.equal(out.access, "sess-1") // the session is the model gateway's token
  assert.equal(out.refresh, "") // a phone-code session has no way to renew
  assert.equal(typeof out.expires, "number") // milliseconds
  assert.ok(out.expires > Date.now() + 13 * 86400_000 && out.expires <= Date.now() + 14 * 86400_000 + 5_000)
  assert.equal(out.accountId, "138****8000")
  assert.equal(out.uid, "uid-1") // extra fields persist with the credential
})

test("a failed business code in authorize throws, never a failed answer", async () => {
  sendAnswer({ code: "100001", desc: "too many sends" })
  await assert.rejects(authorize(PHONE), /too many sends/)
})

test("a dead sign-in code in authorize throws its own wording", async () => {
  sendAnswer({ code: "020002", desc: "whatever" })
  await assert.rejects(authorize(PHONE), /登录态已失效/)
})

test("a send that answers no msgid at all fails honestly", async () => {
  sendAnswer({ code: "000000", data: {} })
  await assert.rejects(authorize(PHONE), /msgid/)
})

test("an HTTP-level failure in authorize is the status itself", async () => {
  f.route("POST /login/phone/sendMsgCode", () => json({ boom: true }, 500))
  await assert.rejects(authorize(PHONE), /HTTP 500/)
})

test("an unjudgeable phone throws before any request", async () => {
  await assert.rejects(authorize("12345"), /11 位/)
  assert.equal(f.seen.length, 0)
})

test("a failed business code in callback answers failed", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "100001", desc: "wrong code" })
  const start = await authorize(PHONE)
  assert.deepEqual(await start.callback("000000"), { type: "failed", error: "登录失败：wrong code" })
})

test("a dead sign-in code in callback answers failed with its own wording", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "100002" })
  const start = await authorize(PHONE)
  assert.deepEqual(await start.callback("123456"), { type: "failed", error: "登录态已失效，请重新登录" })
})

test("a success without a session answers failed honestly", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "000000", data: {} })
  const start = await authorize(PHONE)
  assert.deepEqual(await start.callback("123456"), { type: "failed", error: "登录成功但上游没有返回 session" })
})

test("a code that is not six digits never reaches the host", async () => {
  sendAnswer({ code: "000000", data: { msgid: "mid-1" } })
  checkAnswer({ code: "000000", data: { session: "sess-1", userid: "uid-1" } })
  const start = await authorize(PHONE)
  assert.deepEqual(await start.callback("12ab"), { type: "failed", error: "请填写 6 位数字验证码" })
  assert.equal(f.seen.length, 1) // the send alone went out
})

test("the mask keeps the ends and hides the middle", () => {
  assert.equal(_internal.maskPhone(PHONE), "138****8000")
  assert.equal(_internal.maskPhone("12345"), "12345") // too short to mask stays whole
})
