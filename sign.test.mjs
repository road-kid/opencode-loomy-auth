// The CAccount signature every account-plane request carries (the desktop
// client's own signing code spells it out): nine lines —
// the method, the escaped path, an always-empty query line, the body's MD5,
// the content type, the date, the nonce, and two always-empty header lines —
// HMAC-SHA1'd with the account host's key pair and sent as
// "account {AccessKeyId}:{base64}". The vectors below hold a fixed date and
// nonce, so a drift in the layout, the escaping or the digests cannot pass
// silently; the MD5 and HMAC lines are checked against RFC 1321's and
// RFC 2202's own vectors, not against this module's own arithmetic. The phone
// cleaning is here too: the client's normalize_phone strips spaces, hyphens
// and the +86 before it judges, and judges eleven digits, not twelve.
import "./nonet.mjs"
import { test } from "node:test"
import assert from "node:assert/strict"
import { _internal } from "./index.mjs"

const DATE = "Tue, 07 Oct 2026 08:00:00 GMT"
const NONCE = "0b35916a-6a1f-4c94-9c57-6d73f4d94a28"
const BODY = '{"param":{"ccode":"86","phone":"13800138000","expire":300}}'
const MD5 = "UYkEp9MJ0S1XYsR5bJ0C1A=="

test("contentMd5 is the body's MD5 as base64, RFC 1321's own vector", () => {
  assert.equal(_internal.contentMd5(""), "") // the no-body branch: the empty string, not the empty digest
  assert.equal(_internal.contentMd5("abc"), "kAFQmDzST7DWlj99KOF/cg==")
  assert.equal(Buffer.from(_internal.contentMd5("abc"), "base64").toString("hex"), "900150983cd24fb0d6963f7d28e17f72")
  assert.equal(_internal.contentMd5(BODY), MD5)
})

test("stringToSign is nine lines, two empty ones trailing", () => {
  const s = _internal.stringToSign("post", "/login/phone/sendMsgCode", MD5, DATE, NONCE)
  assert.equal(s, ["POST", "/login/phone/sendMsgCode", "", MD5, "application/json", DATE, NONCE, "", ""].join("\n"))
  assert.equal(s.split("\n").length, 9)
  assert.ok(s.endsWith(NONCE + "\n\n")) // the last two lines are empty: two newlines past the nonce
})

test("signHeader is the HMAC-SHA1 as base64, RFC 2202's own vector", () => {
  // test case 2: key "Jefe", data "what do ya want for nothing?"
  assert.equal(_internal.signHeader("any-id", "Jefe", "what do ya want for nothing?"), "account any-id:7/zfauXrL6LSdBbV8YTfnCWafHk=")
})

test("the nine lines sign stably under the fixed vectors", () => {
  const send = _internal.stringToSign("POST", "/login/phone/sendMsgCode", MD5, DATE, NONCE)
  assert.equal(_internal.signHeader("plain-test-key-id", "plain-test-secret", send), "account plain-test-key-id:HK7kQTRLGhkKOqS4ngfY6qN5ybY=")
  const check = _internal.stringToSign("POST", "/login/phone/checkCode", "xycgXDvZRH7dlr60//2aFg==", DATE, NONCE)
  assert.equal(_internal.signHeader("plain-test-key-id", "plain-test-secret", check), "account plain-test-key-id:5/GrCKatZYL10VxyZKounk83d0I=")
})

test("escapedPath escapes RFC3986's unreserved set alone, per segment", () => {
  assert.equal(_internal.escapedPath("/login/phone/sendMsgCode"), "/login/phone/sendMsgCode")
  assert.equal(_internal.escapedPath("login/phone/sendMsgCode"), "/login/phone/sendMsgCode") // a leading slash is added
  assert.equal(_internal.escapedPath("/login/phone/sendMsgCode/"), "/login/phone/sendMsgCode") // a trailing one is dropped
  // encodeURIComponent lets !'()* through; the signature's path does not, and
  // the %XX it puts there is uppercase
  assert.equal(_internal.escapedPath("/a b/!x'(y)*z~.-_"), "/a%20b/%21x%27%28y%29%2Az~.-_")
  assert.ok(_internal.escapedPath("/a*b").includes("%2A"))
  assert.equal(_internal.escapedPath("/验证码"), "/" + encodeURIComponent("验证码"))
})

test("normalizePhone cleans before it judges, and judges eleven digits (E1)", () => {
  assert.equal(_internal.normalizePhone("13800138000"), "13800138000")
  assert.equal(_internal.normalizePhone("+86 138-0013-8000"), "13800138000")
  assert.equal(_internal.normalizePhone(" 138 0013 8000 "), "13800138000")
  assert.equal(_internal.normalizePhone("+8613800138000"), "13800138000")
  assert.equal(_internal.normalizePhone("8613800138000"), "13800138000") // a bare 86 leading straight into the eleven digits
  assert.equal(_internal.normalizePhone("138001380001"), undefined) // twelve digits: E1's wrong regex took these
  assert.equal(_internal.normalizePhone("1380013800"), undefined) // ten digits
  assert.equal(_internal.normalizePhone("12800138000"), undefined) // the second digit narrows to 3-9
  assert.equal(_internal.normalizePhone("+86138001380001"), undefined) // the prefix has to leave exactly eleven
})
