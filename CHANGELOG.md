# Changelog

## 0.1.4 — 2026-10-28

### Fixed

- The noted daily quota no longer dies with the plugin directory: the note
  now lives on the credential itself — the host's own user data, carried
  across plugin upgrades and scoped to the account — with the small file
  beside the plugin kept as the fallback (a host without that store) and
  as the read-behind (an upgrade from a release that noted only there). An
  upgrade-installed plugin no longer needs a fresh check-in before the
  percentage comes back.

### Added

- The card speaks the interface language: a window name, unit and the check-in wording follow the lang in the host settings.json (zh keeps 每日赠送/永久积分, anything else takes English strings); the unit rides the host dictionary either way.
- A usage card that finds no quota note anywhere — a fresh install, an
  upgrade that wiped the file, a credential that lost its fields — asks
  the first-login answer itself, once per run: the call is idempotent for
  the day (the client makes it on every login), so the percentage heals
  on the first render instead of waiting for the next check-in. A refusal
  is remembered for the run, never retried on every render.
- The daily window carries `resetsAt` — the next Beijing midnight of the
  cycle date the first-login answer names — so the card counts down to
  the real refill; the consumed share rides as `amount` with `limit`/`unit`
  beside the display (the host renders `limit − amount` as what is left),
  and the display reads `2659 / 5000 积分`.
- A model the upstream itself declares free (the words 免费, or a rate of
  exactly `x0.0`) carries a `free` bit; no rate at all is not free. Rows
  that aren't chat models — the image generators — are left off the list.
- A Chinese README (`README.zh.md`), translating the English one; the
  English `README.md` stays the default.

## 0.1.3 — 2026-10-28

### Added

- The newcomer tasks (onboarding): the eight one-off tasks worth 10000
  points in all are claimed by the check-in — serially, highest value
  first, idempotent on the upstream's `alreadyCompleted`; a refusal among
  them never touches the daily claim's own result. The usage card carries
  an aside row with the still-claimable sum while any of it stands (one
  read per session per run; the check-in's round clears it).

### Changed

- Docs: the README's model table records the catalog the gateway served on
  2026-10-28, and the docs' wording is tightened throughout.

## 0.1.2 — 2026-10-28

### Changed

- The package moves to `@roadkid/opencode-loomy-auth` (from
  `@magpie-community/opencode-loomy-auth`, a name under the community npm
  organization this plugin has not joined — its scope cannot be published
  under from this account). Same code as 0.1.1.

## 0.1.1 — 2026-10-28

### Fixed

- The usage card's percentage was forever 0%. The pair it computed from
  (`dailyRemainingPoints`/`dailyLimitPoints`) never comes back from the live
  upstream, and the `dailyBalance` the card fell back to showing alone is
  the grant's *remaining*, not its size. The consumed share now reads
  `(quota − remaining) / quota` off the remaining, with the quota taken
  from the answer when it carries one (`dailyQuota`, or the older pair) or
  from the size the check-in notes per account — kept in memory for the run
  and in a `.loomy-quota.json` beside the plugin across restarts, so it
  takes a check-in (the Daily check-in switch, or Check in now) to write
  the first note. Without a quota the card shows the remaining alone; no
  share is invented and no quota is assumed. (#1)
- The check-in reported *claimed* for every success. The answer's
  `alreadyProcessed` tells the day's renewal from a repeat: a repeat now
  reports *done* (「今日已刷新」, with what is left of the grant), and the
  day's first reports *claimed* — with the gain as its credit when the
  answer carries the whole arithmetic (`dailyQuota` − `dailyConsumed`).
  (#1)

### Added

- `LOOMY_QUOTA_CACHE_FILE` moves the quota cache file.
- This changelog.

## 0.1.0 — 2026-10-28

- The first release: phone-code sign-in (SMS, fourteen-day session), the
  OpenAI-compatible model gateway with the live model list, the dual point
  wallets on the Usage card, and the daily first-login refresh.
