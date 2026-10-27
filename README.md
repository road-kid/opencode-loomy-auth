# @roadkid/opencode-loomy-auth

An [OpenCode](https://opencode.ai) / [magpie](https://usemagpie.ai) provider
plugin for a Loomy (iFlytek) account. You sign in with Loomy's phone-code
sign-in, your chats go through Loomy's OpenAI-compatible model gateway, and
your points — the permanent balance and the daily grant, two wallets — and the
daily first-login refresh that renews the grant land on the Usage card.

| Provider id | Sign-in | Upstream hosts |
|---|---|---|
| `loomy` | phone code (+86) | `loomyad.xunfei.cn` (account plane `account.xfinfr.com`) |

The package exports `LoomyAuthPlugin` (`loomy`).

## Install

```sh
magpie plugin add github:road-kid/opencode-loomy-auth    # this repository
magpie plugin add @roadkid/opencode-loomy-auth  # the npm name
magpie plugin add .                                      # a local copy — no npm, no GitHub
magpie plugin login loomy      # the phone-code sign-in
magpie provider test loomy     # one small request per API, to check the wiring
magpie quota                   # the points card
```

The same package loads in OpenCode (the `"plugin"` array in `opencode.json`,
then `opencode auth login`). magpie keeps the sign-in in `plugin-auth.json`
(mode 600); OpenCode keeps it in `auth.json`.

## Signing in

The sign-in is Loomy's phone-code one, in two steps:

- magpie asks for the phone number first (mainland China, 11 digits; a leading
  `+86` or `86`, spaces and hyphens are cleaned off before the check);
- the plugin sends the SMS code (it lives five minutes), magpie opens a
  six-digit code box, and the plugin trades the code for the session.

The session lasts fourteen days and Loomy offers no refresh. When it ends
(HTTP 401/403, or the business codes `020002`/`100002`), the plugin marks the
sign-in expired and magpie asks for a new SMS sign-in — there is nothing to
renew. The account's id is the masked phone (`138****8000`); the Loomy userid
is kept with the credential.

## Requests

Chats are OpenAI Chat (`@ai-sdk/openai-compatible`) sent to
`https://loomyad.xunfei.cn/api/v1/chat/completions`, the request body passed
through untouched. The session token rides in both headers the gateway reads —
`token:` and `Authorization: Bearer`, the client's own dual write.

A refusal whose words say the points or quota ran out (a 402, 403 or 429 that
says so) goes on as a 429 `rate_limit_error`, so magpie can move the
conversation to another account. Any other 401/403 is the sign-in's end.

## Models

Signed in, the model list is read live from `GET /api/v1/models`: capabilities
become the tool / reasoning / image bits, the context and output limits pass
through, and every model carries the low/medium/high reasoning-effort
variants. The gateway prints each model's point rate as a suffix on its
display name (`DeepSeek V4 Flash 0731 (x3.0)`); the plugin splits that off and
keeps it out of the name.

The live list is the source of truth. The built-in table below is only a
fallback — a guide from the first install until the live list answers. Without
a session, on an empty answer or a failed ask, it stands in, and the live list
overwrites it the moment it answers.

| Model | Display name | Point rate |
|---|---|---|
| `deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | x3.0 |
| `GLM-5.3-Flash` | GLM 5.3 Flash | x0.8 |
| `spark-x` | Spark X2.5 (thinking) | x0.1 |
| `MiniMax-M3` | — | — |
| `Kimi-k2.6` | — | — |
| `qwen-3.8-max` | — | — |
| `qwen3.8-flash` | — | — |
| `doubao-seed-2.0-mini` | — | — |
| `mimo-v2.5` | — | — |
| `qwen3.5-flash` | — | — |

## Usage

The usage card shows the two wallets Loomy keeps:

- the balance line: permanent + daily grant, added together (the answer's
  own total when it names one);
- a daily-grant window: the grant's consumed share as its percentage, with
  what is left over the limit beside it. `dailyBalance` is the grant's
  *remaining* (`dailyQuota` − `dailyConsumed`), so the percentage needs the
  grant's size: the pair the answer carries when it carries one, else the
  `dailyQuota` the check-in notes per account — a small `.loomy-quota.json`
  beside the plugin keeps the note across restarts, and it takes a check-in
  to write it (the **Daily check-in** switch, off by default, or the manual
  **Check in now** button): until the first one the card shows the remaining
  alone; no share is invented and no quota is assumed;
- the permanent row set aside: the permanent balance, which has no window.

Loomy has no dedicated balance or check-in endpoint: the summary rides on the
points-records call, and the "check-in" is the first-login call the Loomy
client itself makes on every login. The server renews the daily grant once a
day, and the answer's `alreadyProcessed` tells the day's renewal from a
repeat: a repeat reports *done* ("今日已刷新", with what is left of the grant),
and the day's first reports *claimed* — with the gain as its credit when the
answer carries the whole arithmetic (`dailyQuota` − `dailyConsumed`), and the
remaining in the message otherwise.

## Check-in

The automatic daily run is magpie's, not the plugin's: the **Daily check-in**
switch lives in Settings → Usage → Plugins, ships with **magpie ≥ v0.1.1083**
and is **off by default** — turn it on and magpie runs the refresh once a day
per account (only a failed outcome retries that day). The **Check in now**
button runs it then and there. OpenCode doesn't call this hook.

## Environment overrides

All of them are read when a call is made, not when the plugin loads, so tests
can point them at a fake of their own.

| Variable | Default | What it replaces |
|---|---|---|
| `LOOMY_XFYUN_BASE_URL` | `https://account.xfinfr.com` | the account host (send / check code) |
| `LOOMY_POINTS_BASE_URL` | `https://loomyad.xunfei.cn` | the integration host — points, first-login, and `/api/v1` (models and chat) |
| `LOOMY_XFYUN_ACCESS_KEY_ID` | `2thryby66wxi53sk` | the signing pair's id |
| `LOOMY_XFYUN_ACCESS_KEY_SECRET` | `zsak6eadrbawz683wf5r3m2snrwj868r` | the signing pair's secret |
| `LOOMY_XFYUN_APP_ID` | `GM3LOOMY` | the request envelope's appid |
| `LOOMY_QUOTA_CACHE_FILE` | `.loomy-quota.json` beside the plugin | where the check-in's noted daily quota persists across restarts |

## Known limits

- **The session is fourteen days, with no refresh.** When it ends the only way
  on is a new SMS sign-in.
- **The point rate exists only as the display name's suffix.** Loomy ships no
  structured rate field; the plugin splits the suffix off but cannot verify
  any amount against the catalog.
- **Image input differs per model family.** The deepseek models read only the
  gateway's private `<image_base64>…</image_base64>` marker (a standard
  `image_url` is cut off as text); the GLM models are the opposite — only
  `image_url`, and the marker breaks them. The rewrite is a planned second
  iteration; until it lands, image input is reliable on the GLM family alone.
- **`reasoning_effort` is ignored on non-thinking models.** Every model
  carries the low/medium/high variants the way the client hangs them; the
  upstream drops the field on the models that don't think — a known behavior.
  The client's own catalog flags `spark-x` as the thinking one.
- **Streaming tool calls are not yet verified on a real account.** The
  desktop gateway's tool_calls streaming has no recorded real-machine run
  behind it; it is the first thing to check with your agent's tool loop. If
  it fails, the toolcall bit gets turned down in a future release.
- **Onboarding newcomer tasks are not claimed.** The eight one-off tasks
  (10000 points in all) on Loomy's onboarding board are left to the Loomy
  client; only the daily first-login is here. Claiming them is a possible
  second iteration.

## Disclaimer

This is an unofficial community package. It has nothing to do with iFlytek or
Loomy. The implementation is reverse-engineered from the desktop client's own
behavior and measured against it, for personal study and research. The
signing pair is a client fingerprint, not a credential: every request to
Loomy's account host is HMAC-SHA1 signed with a key pair that ships inside
Loomy's own installer to every client — public by design. This package
replicates it for compatibility, the way it replicates the request envelope.
Your phone number, your code and your session go only to Loomy's own hosts.
The points are for Loomy's own services; Loomy's terms decide where else they
may be used, and iFlytek hasn't approved that. The risk to the account is
yours. An upstream protocol change can break the package at any time.

## Development

```sh
node --test .                    # the unit tests (node:test, a local fake upstream, no network)
node scripts/check.node.mjs      # the shape check, the same logic the community CI runs
```

The plugin itself is one `index.mjs` with no runtime dependencies — only
`node:crypto` and the standard `fetch` — and loads in Bun and Node ≥ 20.11
alike.
