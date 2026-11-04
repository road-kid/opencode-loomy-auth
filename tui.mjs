// The /loomy panel for the OpenCode v2 TUI — a minimal read of the account:
// the sign-in state, the two wallets' numbers and the grant's reset moment,
// with the day's first-login check-in and a re-read beside them. One select
// dialog in a loop, the smallest shape the reference plugin (antigravity)
// ships its own account view in: no JSX, no slots, no router — the panel's
// whole surface is the host's keymap layer and its dialog and toast.
//
// Who loads this file: the v2 TUI alone, through the package's "./tui"
// export (the server side computes features.tui from that key on its own).
// magpie never imports it — its entry list reads exports["./server"], main,
// exports["."] and the index.* fallbacks, and "./tui" is none of them — so
// this file keeps to one job: a default export shaped { id, setup } with
// nothing at top level but definitions (no timers, no listeners, no fetch).
//
// The data plane is index.mjs's own, imported through its _internal face:
// the same tokenGet on the records call, the same usageOf for the card's
// numbers, the same tokenPost on first-login with checkinOf for its wording.
// One machinery, every surface — the panel's numbers cannot drift from the
// server side's. The import is safe for both hosts: magpie's loader
// short-circuits on the default export and never scans the named ones, and
// the v2 host reads the default alone.

import { _internal } from "./index.mjs"

const {
  SUCCESS, // the business code every Loomy plane answers success with
  AUTH_CODES, // the two codes that say the sign-in is no longer valid
  RECORDS_PATH, // the records call the points summary rides on
  FIRST_LOGIN_PATH, // the daily grant's renewal, the panel's check-in
  V2_QUOTA_KEY, // the storage key the renewal noted the grant's size under
  tokenGet,
  tokenPost,
  businessCode,
  upstreamMessage,
  pickNumber,
  usageOf,
  checkinOf,
  quotaNoteOf,
  wordsOf,
} = _internal

const ID = "loomy" // the integration the connection domain is asked with

// the panel's own words — the plugin's Chinese, the register the card's zh
// strings keep (the error wording itself comes from wordsOf, which without a
// host folder answers the zh set). This file is never loaded by an English
// host, so no second tongue is carried for it.
const W = {
  title: "Loomy 积分",
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
}

// beijingTimeOf renders an ISO moment as Beijing's "MM-DD HH:mm" — the same
// 8-hour shift the cycle arithmetic itself keeps; an unparseable moment
// (the card answered nothing) reads as no time at all
function beijingTimeOf(iso) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return undefined
  return new Date(t + 8 * 3600e3).toISOString().slice(5, 16).replace("T", " ")
}

// snapshot is the panel's one read: the credential out of the host's
// connection domain — the same reading v2Refresh makes on the server side —
// and, with a token in hand, the records call run through usageOf. Every
// step is feature-detected and wrapped: a host without the domain, a
// connection with no token, a dead sign-in, a bad answer — each is a state
// the panel can render, never a throw. The grant's size and cycle date are
// read the way the V1 hook reads its note, in the order the sources can be
// trusted: off the credential's own fields first (the fields a magpie-side
// check-in writes — the v2 sign-in itself carries no such fields), then the
// host's storage note (the one the v2 renewal writes under its namespaced
// key — the pure-v2 account's own source, the records answer carrying the
// remaining alone), then the file note (the one the check-ins write, shared
// across the plugin's surfaces) — the records answer's own dailyQuota
// behind them all, the usageOf read itself settling that floor. A refusing
// store answers nothing, the same defensiveness the domain reads keep.
async function snapshot(ctx) {
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
  if (!access) return { access: "", accountId, expired: false, card: undefined, error: undefined }
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
    if (AUTH_CODES.has(code)) return { access: "", accountId, expired: true, card: undefined, error: undefined }
    if (code !== SUCCESS) {
      const text = upstreamMessage(payload)
      const w = wordsOf()
      return {
        access,
        accountId,
        expired: false,
        card: undefined,
        error: text ? w.pointsFailed(text) : w.pointsFailedCode(code),
      }
    }
    if (noted === undefined) noted = await quotaNoteOf(accountId)
    return { access, accountId, expired: false, card: usageOf(payload, noted, cycle), error: undefined }
  } catch (e) {
    if (e?.signIn === "expired") return { access: "", accountId, expired: true, card: undefined, error: undefined }
    return { access, accountId, expired: false, card: undefined, error: e?.message ?? String(e) }
  }
}

// panel is the loop itself: read, render, wait for a pick, act, read again.
// The dialog rows carry the state (disabled — they are the readout) and the
// two actions; Esc and every other dismissal answer undefined and close.
// The check-in is the same first-login call the server side's renewal makes,
// its wording the same checkinOf the V1 claim answers with; a failure of the
// call itself (an expired sign-in among them) is worded, never a crash. A
// host that refuses its dialog closes the panel whole — the panel is never
// worth a failed load.
async function panel(ctx) {
  const dialog = ctx?.ui?.dialog
  if (typeof dialog?.select !== "function") return // a host without its dialog has no panel to open
  // the wording surface: the alert when the host has one, the toast behind
  // it, silence when it has neither — whatever it answers, the loop goes on
  const say = async (message) => {
    try {
      if (typeof dialog?.alert === "function") await dialog.alert({ title: W.title, message })
      else if (typeof ctx?.ui?.toast?.show === "function") await ctx.ui.toast.show({ message })
    } catch {}
  }
  while (true) {
    const state = await snapshot(ctx)
    const options = [
      state.expired
        ? { title: W.expired, value: "state", disabled: true }
        : state.access
          ? { title: W.signedIn(state.accountId), value: "state", disabled: true }
          : { title: W.signedOut, value: "state", disabled: true },
    ]
    if (state.error) options.push({ title: state.error, value: "error", disabled: true })
    if (state.card) {
      const daily = state.card.windows[0]
      const reset = beijingTimeOf(daily?.resetsAt)
      options.push(
        { title: W.balance(state.card.balance), value: "balance", disabled: true },
        {
          title: W.daily(daily?.name),
          value: "daily",
          description: daily ? (reset ? `${daily.display}；${W.resetAt(reset)}` : daily.display) : undefined,
          disabled: true,
        }
      )
    }
    if (state.access) options.push({ title: W.checkin, value: "checkin", description: W.checkinHint })
    options.push({ title: W.refresh, value: "refresh", description: W.refreshHint })
    let picked
    try {
      picked = await dialog.select({ title: W.title, options })
    } catch {
      return // the dialog's own refusal is the panel's close
    }
    if (!picked) return // Esc / cancel: the panel's close
    if (picked === "checkin") {
      try {
        const claim = checkinOf(await tokenPost(FIRST_LOGIN_PATH, {}, state.access))
        await say(claim.message)
      } catch (e) {
        await say(e?.signIn === "expired" ? wordsOf().signInExpired : (e?.message ?? String(e)))
      }
    }
    // checkin and refresh both fall through: the loop re-reads and re-renders
  }
}

// the plugin itself. The keymap layer is the factory form the host contract
// asks — pure, the layer removed on its own when the plugin deactivates —
// and the setup hands nothing back: the panel owns no timer and no listener,
// so there is nothing for a cleanup to give up. A host without the keymap
// domain is a silent load, the same feature-detect the server side's setup
// keeps: the worst a half-hearted host gets is the parts it has domains for.
export const LoomyTuiPlugin = {
  id: "loomy-auth",
  setup(ctx) {
    if (typeof ctx?.keymap?.layer !== "function") return
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "loomy.panel",
          title: "Loomy 积分面板",
          group: "Loomy",
          palette: true, // the command palette
          slash: { name: "loomy" }, // /loomy, and the completion that finds it
          run: () => panel(ctx),
        },
      ],
    }))
  },
}

export default LoomyTuiPlugin
