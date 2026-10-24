// A fake of Loomy's hosts for the tests: one local server standing in for the
// CAccount host and the integration gateway, which the plugin's two base-URL
// environment variables are pointed at (the plugin reads them when it calls,
// not when it loads — pointAt sets them and answers with the restore
// function). route("METHOD /path", handler) answers a request — the handler
// returns what json()/text() built, or writes res itself — and seen lists
// what came: method, path, query, headers and body, the body parsed as JSON
// when it parses.
import http from "node:http"

// an answer a handler can return: status, headers, body
export const json = (v, status = 200) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(v) })
export const text = (v, status = 200, headers = {}) => ({
  status,
  headers: { "content-type": "text/plain", ...headers },
  body: String(v),
})

export function fakeLoomy() {
  return new Promise((resolve) => {
    const routes = new Map()
    const seen = []
    const server = http.createServer((req, res) => {
      const chunks = []
      req.on("data", (chunk) => chunks.push(chunk))
      req.on("end", () => {
        const url = new URL(req.url, "http://127.0.0.1")
        const body = Buffer.concat(chunks).toString("utf8")
        const r = { method: req.method, path: url.pathname, query: url.searchParams, headers: req.headers, text: body, url: url.pathname + url.search }
        if (body) try { r.json = JSON.parse(body) } catch {}
        seen.push(r)
        const h = routes.get(req.method + " " + url.pathname)
        if (!h) {
          res.writeHead(404, { "content-type": "text/plain" })
          res.end("no route " + req.method + " " + url.pathname)
          return
        }
        let out
        try {
          out = h(r, res)
        } catch (e) {
          res.writeHead(500, { "content-type": "text/plain" })
          res.end(String(e?.message ?? e))
          return
        }
        if (out === undefined) return // the handler answered res itself
        res.writeHead(out.status ?? 200, out.headers ?? {})
        res.end(out.body ?? "")
      })
    })
    server.listen(0, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        seen,
        route: (key, h) => routes.set(key, h),
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.() // fetch's keep-alive sockets would hold the close
            server.close(() => done())
          }),
      })
    })
  })
}

// point the plugin's planes at the fake by the two variables it reads when it
// calls; the answer is the restore function (the values they had, the absent
// ones deleted again)
export function pointAt(origin) {
  const keys = ["LOOMY_XFYUN_BASE_URL", "LOOMY_POINTS_BASE_URL"]
  const was = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) process.env[key] = origin
  return () => {
    for (const [key, value] of Object.entries(was)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
