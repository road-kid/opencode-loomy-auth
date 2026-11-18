# Changelog

## 0.2.2 — 2026-11-18

### Fixed

- The models hook's records now spell the capability bits flat as well,
  in models.dev's spelling (`attachment`, `reasoning`, `tool_call`,
  `modalities`), beside the `capabilities` nest OpenCode v1 reads. The
  host passes a models hook's records through verbatim, and a picker
  that reads the badge off the top level (zcode's and workbuddy's
  records spell it there) went unserved: the released 0.2.1 carried the
  nested spelling alone, every vision model's mark unshown on it,
  `deepseek-v4-flash-1017` the one a user noticed. The nest and the
  config hook's table are unchanged; the shape test now checks the flat
  keys against the nest instead of treating them as config keys.

- The same records now carry the input/output boolean mapping inside
  `capabilities`, in OpenCode's own info shape: `input: { text, image }`
  and `output: { text }`, image following the row's vision bit. Read
  2026-11-18 at magpie 0.1.4477, the host hands a models hook's records
  through verbatim and its image badge reads the record's
  `capabilities.input.image` boolean mapping alone. A record that
  spelled image input as top-level `attachment` and the `modalities`
  array alone answered `imageSaid` false, and the host fell back to
  looking the model up by id in its own models.dev catalog: that
  catalog knows `DeepSeek-V4.1-Flash` and not the gateway's
  `deepseek-v4-flash-1017` alias, so the 1017 badge went missing — the
  config table's row was right, the hook's answer overwriting it. An
  explicit `capabilities.input.image` is what overrides that fallback;
  the config table's own records run the host's `modalities()` over the
  arrays and need no such key. The shape test now covers the mapping
  against the 1017 row's live answer.

## 0.2.1 — 2026-11-17

### Changed

- Reasoning efforts follow each model's real gears instead of one pinned
  list. The plugin pinned every model to low/medium/high and, on the v2
  side, intersected that with a table taking the Loomy front end's three
  display gears as the candidate set. The gateway's `reasoning_efforts`
  proved no better a source: every thinking row on sale carries the same
  five-level stamp (none, low, medium, high, xhigh), and the vendors' own
  documents disprove it for all six. A per-vendor table (`VENDOR_LEVELS`)
  is now the first source for the V1 variants and the v2 picker:

  - deepseek-v4.1-flash, deepseek-v4-flash-1017: low / high / max —
    DeepSeek's thinking-mode guide (default high, no medium); the desktop
    picker read the same, and the 1017 row is the same family, sharing
    the menu by assumption
  - glm-5.3-flash: low / high / max — Zhipu's ModelScope card and
    docs.bigmodel.cn (default max, no none; xhigh is a third-party
    platform's alias of max)
  - qwen3.8-flash: low / medium / xhigh — the Qwen3.8 chat template
    (default xhigh; high is no native level — it answers "Unexpected
    reasoning effort" — and none is absent)
  - mimo-v2.5: no gears at all — MiMo's docs run thinking on a
    `thinking.type` switch (enabled / disabled), not an effort menu
  - spark-x2.6: none / low / high — iFlytek's MaaS card, the HF card
    agreeing

  A row the table does not name keeps its `reasoning_efforts` declaration
  passed through as it stands, in its order; a row that declares nothing
  (`auto`) keeps the fixed low/medium/high as the V1 fallback and hangs
  no v2 variant; an empty table row pins a model that has no gears to an
  empty picker. The snapshot's thinking rows carry the same menus their
  live counterparts serve, so a snapshot host and a live host agree.

### Fixed

- The snapshot catalog follows the gateway's live list as measured on
  2026-11-17. `deepseek-v4-flash-1017` is in, its row declaring image
  input, so a host seeding from the snapshot offers it as
  attachment-capable instead of a text-only default; spark-x,
  MiniMax-M3, Kimi-k2.6 and qwen-3.8-max, retired upstream that day, are
  out; MiMo V2.5's limits follow the live row (context 1024000, output
  128000). The v2 display-name table drops the retired ids and names the
  1017 row after its DeepSeek sibling.

- The image generators draw at the gateway's own image route. All three
  roster rows — Hy-Image-3.5-preview, doubao-seedream-5-lite,
  qwen-image-3.0-pro — were pointed at `/chat/completions` like every
  chat model, and the gateway answers each with 404 (该模型暂未开放).
  Measured 2026-11-17: `POST {apiBase}/images/generations` with
  `{model, prompt, n}` answers 200 and returns the picture, the route
  the rows themselves declare with `type: "image"` and
  `output_modalities: ["image"]`. Their records now carry that url and
  no reasoning-effort variants — a thinking model's gear menu is
  meaningless on a generator. The round trip was drawn end to end the
  same day through magpie's hub. Chat models are untouched.

## 0.2.0 — 2026-11-06

### Added

- One package, every host: beside the named `LoomyAuthPlugin` export the
  magpie and OpenCode v1 hosts read (unchanged), the package ships a
  default export shaped `{ id: "loomy-auth", setup, server }` — the
  `setup` OpenCode ≥ 2.x loads, the `server` function the hosts that read
  object entrypoints call (magpie's own loader does, since its 2026-11-03
  build: a default export carrying an id is read by the server under it,
  the named-export scan never running). The install stays what it was —
  `magpie plugin add` or the npm name on the magpie side; on the v2 side
  the `plugins` key of `opencode.json(c)` (the npm name, or a local
  directory path — a file path is skipped), or a directory dropped into
  `~/.config/opencode/plugins/` / `.opencode/plugins/`, discovered on its
  own and hot-reloaded on file changes.
- On opencode v2 the model rows carry the display names the vendors
  themselves spell — the official spellings read off each vendor's own
  pages (Kimi K2.6, Qwen 3.8 Flash, MiniMax M3, 自动 · 均衡 for auto),
  keyed by the model id. A row the table doesn't know keeps its cleaned
  gateway name with only the leading brand word set to the official
  spelling — no title-casing past that, the version tokens as the
  gateway wrote them.
- The reasoning efforts hang as variants from each model's real gears:
  the levels the vendor's own docs vouch for, intersected with the
  gateway row's `reasoning_efforts` declaration. The gateway serves every
  thinking row the same five values (none / low / medium / high / xhigh),
  but the vendors' own pages — read one by one on 2026-11-04 — say
  otherwise, and a menu of aliases and ghost gears is a menu of lies:
  DeepSeek's medium and xhigh are documented aliases of high (its real
  enumeration is none / low / high / max, and the gateway never declares
  max); Kimi K2.6 has no `reasoning_effort` at all — thinking runs on
  `thinking.type`'s two-value switch, and only none's turn-it-off meaning
  is real (measured through the gateway: none answers with zero thinking,
  xhigh measurably breaks the same way); Qwen's high is the docs' own
  alias of xhigh, so the Qwen rows show none / low / medium / xhigh with
  the gear once; GLM 5.3 Flash thinks whether asked or not — no none,
  low / high alone; MiMo's xhigh is an alias of high; MiniMax M3 alone
  takes all five whole; Spark X2.6 knows none / low / high. A model the
  table doesn't know keeps the gateway's declaration as it stands —
  Loomy's own contract for vendors we cannot check — and the snapshot's
  rows (which declare nothing) hang the official levels alone. The
  picker's own Default variant sends no `reasoningEffort` at all, which
  lands on the gateway's default gear — each vendor's own default
  differs, and the gateway's is the one that applies. The host merges the
  overlay into the request as `reasoningEffort`, the camelCase field the
  gateway itself parses (the OpenAI snake_case spelling it never reads).
- The v2 rows ship `time.released: 0`. The desktop picker's visibility
  rule hides a model that has no show record while it is not the newest of
  its family and its release date parses; rows sharing one date with no
  family would leave a single "newest" visible and fold the rest away. A
  zero the host renders as an empty date parses to no date, and the
  picker's own rule keeps a model without a parseable release date
  visible — every model shows by default.
- On opencode v2 the sign-in runs through `opencode auth login` (or
  `/connect` in the TUI): the Loomy integration, the phone-code way, the
  11-digit phone number, the six-digit SMS code (five minutes to live) —
  and the session is the same fourteen-day one with nothing to renew. The
  desktop OpenCode's account-connection screen reads the same server
  APIs. The model side keeps its shape: the `loomy` provider stays hidden
  until the sign-in exists (a dead model is what the hiding prevents),
  the list is read live from the gateway's `/api/v1/models` and refreshes
  with the sign-in state, and the built-in 2026-10-28 snapshot (chat
  models only) stands in while the gateway is unreachable. Bearer auth
  rides the gateway calls by the host's own injection.
- On opencode v2 the TUI carries a `/loomy` panel: one select dialog with
  the sign-in state, the points total, the daily grant (remaining over its
  size, its reset moment in Beijing time) and two actions — check in now
  (the same first-login call, worded by the same claim reader as magpie's
  Check in now) and refresh. The numbers come off the very machinery the
  server side uses — the records call through `usageOf`, imported from
  `index.mjs`'s `_internal` face, so no second copy can drift. The grant's
  size reaches the panel the v2 way: the records answer carries the
  remaining alone, and the v2 credential's metadata no size fields, so the
  renewal notes the size (and cycle date) the first-login answer carries
  in the host's storage under its own namespaced key, and the panel reads
  the credential's fields first, that note behind them, the shared file
  note behind that — a pure-v2 account's percentage no longer out of
  reach. The package exports `./tui` (the key the v2 host reads to
  compute `features.tui`) and ships `tui.mjs` in `files`.
- On opencode v2 the desktop app carries the same panel in its own window:
  the package exports `./gui-experimental` → `dist/gui-experimental.cjs`,
  the prebuilt CommonJS bundle the desktop's GUI plugin loader reads, with
  the same rows the TUI panel shows (sign-in state, points total, the
  daily grant's remaining over its size and its Beijing-time reset) and
  the same two actions beside them. Magpie's loader, whose entry list
  never leaves the four sources it has always read, touches neither
  `./tui` nor this key; the v2 host is what reads them. The bundle is
  hand-written CommonJS, no build step: the app supplies the modules it
  requires at runtime (`solid-js`, the gui module with the registries),
  and the rows are DOM built by hand with Solid's own primitives, no JSX
  to compile. The numbers cross one bridge: the RPC the server part
  registers in `v2Setup` (`loomy-auth-quota`, two methods — `status`, the
  records call through `usageOf` off the credential the connection domain
  holds; `checkin`, the same first-login call worded by the same claim
  reader, the grant's size noted behind it the way the renewal notes it) —
  the window calls it through the app's own client (`ctx.client.rpc`),
  never touching the gateway's credential, which only the server side
  holds. The contract travels as a pure JSON-Schema literal, the bundle's
  copy beside the server's, the tests holding the two together; the
  bundle's own words, its Beijing-time formatting and its readout-to-rows
  read are tested in Node (a `.cjs` requires clean), while the render
  itself — DOM in a window — is not. The GUI API is experimental upstream
  (the `-experimental` export name says so) and may change between desktop
  releases.
- On opencode v2 the day's first-login renewal runs by itself: at load,
  behind every credential event and on a half-hour timer, the same
  once-a-day claim magpie's Daily check-in makes — its success marked per
  Beijing calendar day in the host's storage (a namespaced key on the
  flat shared keyspace), anything less than success left unmarked for the
  next event or tick to retry, and nothing ever reported. The timer's
  clearing rides the plugin cleanup's disposers.
- The points card, the daily check-in and the image-generator roster stay
  magpie-only: they ride the host-extension hooks magpie exposes. The
  `/loomy` panel (above) brings the points' numbers to the v2 TUI itself,
  and the desktop panel beside it brings them to the v2 desktop's own
  windows; the rest of the plugin there is the phone-code sign-in, the
  live model list and the gateway chat.
- The image-generator roster rides beside the chat list from a roster the
  plugin keeps: each row only while the live catalog still names its id —
  a retired one leaves with no release, a new one waits for the release
  that vouches for it, and the fallback tables carry none. A model row
  carrying an image generator's name stays off the chat list even when the
  row ships no `type` at all — the same words the host's own image-model
  catalog reads. This work carried its own v0.1.7 tag; it ships here for
  the first time.

## 0.1.6 — 2026-11-01

### Fixed

- The model picker shows the point rates again: the rate rides the model
  record the host reads — the live list's and the fallback table's alike,
  the fallback's free bits with them.
- A failed model-list ask marks the fallback it hands back, the way the
  host reads it.

## 0.1.5 — 2026-10-28

### Changed

- The usage card speaks the interface language: the window name, the
  unit and the check-in wording follow the `lang` in the host's
  settings.json (zh keeps 每日赠送/永久积分, anything else takes the
  English strings), the unit riding the host dictionary either way.
- The error paths speak the interface language too (sign-in expired or
  failed, points query failed, the hosts' HTTP errors, the account
  fallback).
- The Chinese README moved to `docs/README.zh.md` — npm's readme picker
  reads the package root, where the English `README.md` now stands alone.
- The READMEs tell the protocol's facts and leave the override knobs out
  of the public docs.

### Fixed

- The built-in fallback model table is the catalog observed on 2026-10-28
  (the retired ids are gone; the ten chat entries carry their rates, free
  bits, context and output limits as the gateway served them).
- The quota note's file write is serialized: two accounts signing in at
  once no longer race the read-merge-write and drop each other's note.
- A refused self-heal ask retries after ten minutes instead of never.

## 0.1.4 — 2026-10-28

### Added

- A usage card that finds no quota note anywhere — a fresh install, an
  upgrade that wiped the file, a credential that lost its fields — asks
  the first-login answer itself, once per run: the call is idempotent for
  the day (the client makes it on every login), so the percentage heals
  on the first render instead of waiting for the next check-in. A refusal
  is remembered for the run, never retried on every render.
- The daily window carries `resetsAt` — the next Beijing midnight of the
  cycle date the first-login answer names — so the card counts down to
  the real refill; the consumed share rides as `amount` with
  `limit`/`unit` beside the display (the host renders `limit − amount`
  as what is left), and the display reads `2659 / 5000 积分`.
- A model the upstream itself declares free (the words 免费, or a rate of
  exactly `x0.0`) carries a `free` bit; no rate at all is not free. Rows
  that aren't chat models — the image generators — are left off the list.
- A Chinese README (`README.zh.md`) at the package root, translating the
  English one; the English `README.md` stays the default.

### Fixed

- The noted daily quota no longer dies with the plugin directory: the
  note now lives on the credential itself — the host's own user data,
  carried across plugin upgrades and scoped to the account — with the
  small file beside the plugin kept as the fallback (a host without that
  store) and as the read-behind (an upgrade from a release that noted
  only there). An upgrade-installed plugin no longer needs a fresh
  check-in before the percentage comes back.

## 0.1.3 — 2026-10-28

The first npm release: it carries the work of the three earlier tags
that were never installable — 0.1.0's initial features, 0.1.1's fixes and
0.1.2's rename (published briefly, then unpublished) — with this
version's own work on top.

### Added

- Phone-code sign-in (SMS, a fourteen-day session), the OpenAI-compatible
  model gateway with the live model list, the dual point wallets on the
  usage card, and the daily first-login refresh.
- The newcomer tasks (onboarding): the eight one-off tasks worth 10000
  points in all are claimed by the check-in — serially, highest value
  first, idempotent on the upstream's `alreadyCompleted`; a refusal among
  them never touches the daily claim's own result. The usage card carries
  an aside row with the still-claimable sum while any of it stands (one
  read per session per run; the check-in's round clears it).
- `LOOMY_QUOTA_CACHE_FILE` moves the quota cache file.

### Changed

- The package is published as `@roadkid/opencode-loomy-auth`, renamed
  from `@magpie-community/opencode-loomy-auth` — a scope this plugin has
  not joined, whose name could not be published from this account
  (0.1.2, published briefly, was unpublished and ships with this
  version).
- Docs: the README's model table records the catalog the gateway served on
  2026-10-28, and the docs' wording is tightened throughout.

### Fixed

- The usage card's percentage was forever 0%: the pair it computed from
  (`dailyRemainingPoints`/`dailyLimitPoints`) never comes back from the
  live upstream, and the `dailyBalance` the card fell back to showing
  alone is the grant's *remaining*, not its size. The consumed share now
  reads `(quota − remaining) / quota` off the remaining, with the quota
  taken from the answer when it carries one (`dailyQuota`, or the older
  pair) or from the size the check-in notes per account — kept in memory
  for the run and in a `.loomy-quota.json` beside the plugin across
  restarts, so it takes a check-in (the Daily check-in switch, or Check
  in now) to write the first note. Without a quota the card shows the
  remaining alone; no share is invented and no quota is assumed. (#1)
- The check-in reported *claimed* for every success. The answer's
  `alreadyProcessed` tells the day's renewal from a repeat: a repeat now
  reports *done* (「今日已刷新」, with what is left of the grant), and the
  day's first reports *claimed* — with the gain as its credit when the
  answer carries the whole arithmetic (`dailyQuota` − `dailyConsumed`).
  (#1)
