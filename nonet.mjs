// Imported first by every test here: nothing a test runs reaches Loomy. fetch
// goes to this machine (a test's fake) or fails, so a test left without its
// fake, or work still going after it, can't send a session token or a signed
// account request to account.xfinfr.com, loomyad.xunfei.cn or any other of
// Loomy's hosts.
const local = (u) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(String(u))
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : String(input)
  if (!local(u)) throw new Error("a test asked " + u + " with no fake in place")
  return realFetch(input, init)
}
