# Changelog

## 0.1.3 — 2026-10-28

### Changed

- Docs only: the README's model table records the catalog the gateway
  served on 2026-10-28, and the docs' wording is tightened throughout. The
  code is unchanged from 0.1.2.

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
