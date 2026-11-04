// The /loomy panel for the OpenCode v2 desktop — the same read the TUI
// panel makes, in the desktop's own window: the sign-in state, the points
// total, the daily grant's remaining over its size with its reset moment
// in Beijing time, and the two actions beside them — check in now, refresh.
//
// Who loads this file: the desktop app's windows (and its main process,
// which runs no setup of this bundle's), by way of the package's
// "./gui-experimental" export — a package with a name and exports resolves
// the key through them, and the entry must end .cjs or .js, which this is.
// The app evaluates the bundle as CommonJS text — the code handed to a new
// Function with the app's own require beside it — so there is no build here
// and none is needed: no JSX to compile, no dependency to bundle. Everything
// the bundle requires the app supplies at runtime ("solid-js" for the
// reactive primitives, the gui module for the Panel registry), and those
// requires sit inside setup — the module top level stays definitions alone,
// so the file evaluates clean in Node too (the tests read it) and in the
// main process (a window-only setup never runs there).
//
// The data plane is one bridge: the RPC the server part registers in
// index.mjs's v2Setup ("loomy-auth-quota"), called through ctx.client — the
// app's own client for the server that runs the plugin, read at each call,
// a new client after that server restarts. The renderer never holds the
// gateway's credential, and the handlers on the other side of the bridge
// run the very machinery the TUI panel runs, so the panel's numbers cannot
// drift from the server side's. The contract travels as a pure JSON-Schema
// literal, this copy beside the server's — the tests read both and hold
// them together.
//
// No JSX (no build): the rows are DOM built by hand, made live with Solid's
// own primitives — a signal for the readout, an effect to re-render it —
// the smallest reactive shape the panel render supports. The words are the
// TUI panel's own, the register its dialog rows keep; this surface is never
// worded by an English host, so no second tongue is carried for it.

"use strict"

// the panel's words — the TUI panel's vocabulary, three additions of its
// own: the first read's placeholder, the wording of a refused ask (the one
// failure the TUI panel cannot meet, its reads running on the server side's
// own ground) and the wording of a missing channel
const W = {
  title: "Loomy 积分",
  loading: "正在读取…",
  signedIn: (who) => `登录状态：已登录${who ? `（${who}）` : ""}`,
  signedOut: "登录状态：未登录（用 /connect 或 opencode auth login 登录）",
  expired: "登录状态：已过期（用 /connect 重新登录）",
  balance: (v) => `积分总额：${v}`,
  daily: (v) => `每日赠送：${v}`,
  resetAt: (t) => `北京时间 ${t} 重置`,
  checkin: "立即签到",
  checkinHint: "续满每日赠送（今日已续则显示已刷新）",
  refresh: "刷新",
  refreshHint: "重新拉取积分",
  failed: (t) => `读取失败：${t}`,
  noChannel: "插件服务端未就绪",
}

// the contract — the server side's own literal (index.mjs's V2_RPC), the
// two methods the panel calls and nothing else. Loose schemas: these
// payloads are the panel's readouts, not a public surface anyone else
// validates, and no rpc.* error names are declared — refusals cross as
// data, states the panel renders.
const CONTRACT = {
  id: "loomy-auth-quota",
  methods: {
    status: { input: { type: "object" }, output: { type: "object" } },
    checkin: { input: { type: "object" }, output: { type: "object" } },
  },
  events: {},
}

// beijingTimeOf renders an ISO moment as Beijing's "MM-DD HH:mm" — the same
// 8-hour shift the cycle arithmetic itself keeps (the TUI panel's own
// renderer, shared word for word); an unparseable moment (the card answered
// nothing) reads as no time at all
function beijingTimeOf(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return undefined
  return new Date(t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")
}

// rowsOf turns one status readout into the panel's rows — the TUI panel's
// dialog rows in a column, the same words and the same order: the state
// line, the error beside it when there is one, the two wallets, the reset
// moment under them. Every state the server side can answer — no readout
// at all, a read in flight, a refused ask, a signed-out account, a dead
// sign-in, a bad answer, a full card — is a column of rows here, never a
// throw. `failed` is the refused ask's own shape (the reject the rpc's
// caller caught, kept as a string), the states around it the status
// method's own.
function rowsOf(status) {
  if (!status) return [{ key: "state", text: W.signedOut }]
  if (status.loading) return [{ key: "state", text: W.loading }]
  if (typeof status.failed === "string") return [{ key: "state", text: W.failed(status.failed) }]
  if (!status.signedIn) return [{ key: "state", text: status.expired ? W.expired : W.signedOut }]
  const rows = [{ key: "state", text: W.signedIn(status.accountId) }]
  if (status.error) rows.push({ key: "error", text: status.error })
  const daily = status.card?.windows?.[0]
  if (status.card) rows.push({ key: "balance", text: W.balance(status.card.balance) })
  if (daily) {
    rows.push({ key: "daily", text: W.daily(daily.display) })
    const reset = beijingTimeOf(daily.resetsAt)
    if (reset) rows.push({ key: "reset", text: W.resetAt(reset) })
  }
  return rows
}

// el is one DOM node — the bundle has no JSX to build one, and the panel's
// render owes the host a node back. Text goes in as text, never as markup;
// the styling is inline, so the panel carries no stylesheet of its own.
function el(tag, css, text) {
  const node = document.createElement(tag)
  if (css) node.style.cssText = css
  if (text !== undefined) node.textContent = text
  return node
}

// say puts a word up in a toast, when the host has one — the check-in's
// wording is the claim's own, the TUI panel's alert beside it. A host
// without the toast, or one that refuses, stays silent: the rows already
// carry the refreshed numbers, and a missing toast is never worth a crash.
function say(ctx, message, variant) {
  if (!message) return
  try {
    ctx?.toast?.show?.({ title: W.title, description: message, variant: variant === "error" ? "error" : "success" })
  } catch {}
}

// the plugin itself — the bundle's default export, the shape the loader
// validates (a window setup; no main, so the main process evaluates the
// file and runs nothing). Every step is feature-detected: a host without
// Solid, the gui module or the add domain is a silent load, the same
// defensiveness the server side's setup keeps — the worst a half-hearted
// host gets is the parts it has domains for, never a failed load. The
// requires sit here, inside setup: in a window the app's own require
// answers them, in Node and the main process they throw, and the setup
// answers nothing — the whole file staying require-free at the top level
// is what lets the tests read it in Node at all.
function setup(ctx) {
  let solid
  let gui
  try {
    solid = require("solid-js")
    gui = require("@opencode/plugin/gui")
  } catch {
    return
  }
  const createSignal = solid?.createSignal
  const createEffect = solid?.createEffect
  if (typeof createSignal !== "function" || typeof createEffect !== "function" || !gui?.Panel) return
  if (typeof ctx?.add !== "function") return

  ctx.add(gui.Panel, {
    id: "quota",
    region: "side",
    // the one tab, its title the panel's own words — the getter form the
    // host re-reads as its surroundings change
    list: () => [{ id: "quota", title: () => W.title }],
    // the panel's body: one readout column and the two actions under it.
    // The reactive bits are created here, in the render — the host's own
    // owner around them — so the readout re-renders as the reads settle and
    // is given up with the panel that holds it.
    render: () => {
      const [view, setView] = createSignal({ loading: true })
      const [busy, setBusy] = createSignal(false)

      // the read: the client read at the call — a new one after the server
      // restarts — the status method's readout the rows render from. A dead
      // server rejects every call: the failure becomes a row, never a crash.
      const read = async () => {
        try {
          const rpc = ctx?.client?.rpc?.(CONTRACT)
          if (typeof rpc?.status !== "function") throw new Error(W.noChannel)
          setView(await rpc.status({}))
        } catch (e) {
          setView({ failed: e?.message ?? String(e) })
        }
      }

      // the check-in: the claim comes back worded (the server side's own
      // reading of the first-login answer, the TUI panel's checkinOf), said
      // in a toast when the host has one, and the rows re-read behind it
      // whatever the toast did. Both buttons sleep while it runs.
      const checkin = async () => {
        if (busy()) return
        setBusy(true)
        try {
          const rpc = ctx?.client?.rpc?.(CONTRACT)
          if (typeof rpc?.checkin !== "function") throw new Error(W.noChannel)
          const claim = await rpc.checkin({})
          say(ctx, claim?.message, claim?.outcome === "failed" ? "error" : "success")
          await read()
        } catch (e) {
          say(ctx, W.failed(e?.message ?? String(e)), "error")
        } finally {
          setBusy(false)
        }
      }

      const root = el("div", "padding:10px 12px;font-size:12px;line-height:2;user-select:text;")
      const rowsBox = el("div")
      const actions = el("div", "margin-top:6px;")
      const refreshButton = el("button", "margin-right:8px;padding:2px 10px;font:inherit;", W.refresh)
      refreshButton.title = W.refreshHint
      refreshButton.addEventListener("click", () => void read())
      const checkinButton = el("button", "padding:2px 10px;font:inherit;", W.checkin)
      checkinButton.title = W.checkinHint
      checkinButton.addEventListener("click", () => void checkin())
      actions.appendChild(refreshButton)
      actions.appendChild(checkinButton)
      root.appendChild(rowsBox)
      root.appendChild(actions)

      // the rows re-render as the readout settles; the buttons sleep while
      // a claim or a read is in flight
      createEffect(() => {
        const rows = rowsOf(view())
        rowsBox.replaceChildren()
        for (const row of rows) {
          rowsBox.appendChild(el("div", row.key === "error" ? "color:#d9534f;" : "", row.text))
        }
      })
      createEffect(() => {
        const asleep = busy()
        refreshButton.disabled = asleep
        checkinButton.disabled = asleep
      })

      void read()
      return root
    },
  })
}

module.exports = {
  // the pure surface, the tests' to read: the words, the formatting, the
  // rows, the contract — and the default the bundle loader validates
  W,
  CONTRACT,
  beijingTimeOf,
  rowsOf,
  default: { setup },
}
