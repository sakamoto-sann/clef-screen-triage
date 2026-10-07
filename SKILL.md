---
name: clef-screen-triage
description: Classify approved public UI screenshots as loading, error, content visible, or unclear with Clef-flash when only basic screen readiness is needed. Prefer direct DOM checks and retain Codex for detailed visual QA.
---

# Clef screen triage

For repeated basic screen-state checks, prefer a deterministic DOM check when it answers the question. Otherwise classify an approved public or synthetic PNG before opening its pixels in Codex:

```sh
python3 <skill-directory>/scripts/triage.py --image /absolute/screenshot.png --public-image
```

Configure `CLOUDFLARE_ACCOUNT_ID` and either `CLOUDFLARE_API_TOKEN` in the process environment or an existing PATH-accessible Wrangler login. `WRANGLER_PROFILE` selects an optional named profile. Never put credentials in chat, CLI arguments or tracked files. If authentication is unavailable, use the normal Codex workflow rather than setting up a paid fallback.

`--public-image` asserts caller approval to export this particular image to Cloudflare; it does not detect privacy. Keep private desktops, authenticated pages, credentials and private financial screenshots in the existing workflow unless their export is separately authorized. Capture public pages in a separate browser profile using the user's authorized browser tooling. Input: one PNG, at most 4 MiB and one megapixel.

Interpret `route`:

- `continue_visual_check`: skip only the readiness question and continue the user's actual verification.
- `bounded_wait`: briefly wait and capture again. Pass cumulative wait time using `--elapsed-wait-ms`; once wait plus this call's processing time reaches two seconds, use Codex. Cache hits never reset the clock.
- `codex`: inspect the original pixels and relevant DOM/API evidence. Errors, access challenges, unclear completion, low confidence and provider failures take this route.

The helper does not sleep, capture screenshots or execute actions. It does not establish correct data, successful deployment, completed operations, security clearance or user authorization. Preserve the original completion criteria.

Successful responses are cached for 24 hours without image or credential storage. Each cache directory has a UTC-day cap of 20 uncached calls and estimated 900 neurons, with no automatic retries. These limits exclude other account usage and do not guarantee free operation. Check the user's permitted cost and account plan before uncached inference when not already established.

This is a small pilot, not a general QA replacement. See [evaluation and limits](references/evaluation.md); configuration and usage are documented in the repository's README.
