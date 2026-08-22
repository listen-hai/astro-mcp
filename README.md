# Astro MCP (`@lhk714/astro-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%7C%20Node-black.svg)]()

> Deterministic modern Western astrology natal-chart Model Context Protocol (MCP) server: an `astronomy-engine` ephemeris verified against JPL Horizons, honest degradation when the birth time is unknown, and Chinese-first output.

[中文文档 (Chinese)](README_zh.md) | [English](README.md)

---

## 0. Scope: this is MODERN astrology

**This project implements modern Western astrology, not traditional / Hellenistic astrology.** That decision drives most of the defaults below, so it needs to be stated before anything else:

| Choice | Belongs to |
|---|---|
| Uranus, Neptune, Pluto | Modern (classical astrology uses only the seven visible bodies) |
| Chiron, Lilith | Modern |
| Orbs keyed to **aspect type** | Modern (classical astrology keys orbs to each body's own light — moiety) |
| Placidus houses by default | Modern mainstream |
| Kept: whole-sign as an option, day/night (sect) for the Part of Fortune | Classical elements this project still keeps |

**Explicitly out of scope:** triplicity/term/face (the finer three layers of essential dignity), classical moiety orbs, Arabic parts other than the Part of Fortune, antiscia, and rulership-based (七曜/命主) interpretation. If you need traditional technique, this is not the tool — better that than a silent, wrong approximation.

---

## 🌟 Overview

Western astrology's ephemeris ecosystem has two real engines: Swiss Ephemeris (AGPL, incompatible with an MIT-licensed npm package unless every consumer also open-sources) and [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT, but with no built-in asteroid ephemeris, no true lunar node, and no Lilith). [`auseklis`](https://github.com/igmizo/auseklis) wraps `astronomy-engine` but ships several defects (hard-coded zero latitude/declination for nodes and Lilith, a naive Ascendant formula that returns the Descendant above the polar circle, a small-body integration that drifts 100+ degrees over decades).

This project keeps what `auseklis` gets right (its house solvers and ayanamsa tables — see Credits) and rebuilds what it doesn't: real small-body ephemerides via `GravitySimulator` seeded from JPL state vectors, a true lunar node derived from the Moon's actual orbital angular momentum, a real (non-zero) Lilith latitude, and an east-horizon-corrected Ascendant that stays valid inside the polar circle.

```
Birth Wall Clock + IANA Timezone  (1990-06-15 20:00 America/Los_Angeles)
                          │
                          ▼
              wall-clock → UTC instant
        (DST-safe: spring gap errors, fall fold via dstFold)
                          │
                          ▼
        Sidereal time + geographic location
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     Ascendant / Midheaven      Body ephemerides
    (east-horizon corrected,   (astronomy-engine majors,
     valid past the polar        GravitySimulator small
     circle)                     bodies, true node, Lilith)
              │                       │
              ▼                       ▼
         House cusps            Signs / houses / aspects /
      (Placidus, falls back      essential dignity
       to Porphyry above the
       polar circle)
```

Unlike Zi Wei Dou Shu or Bazi, Western astrology's clock does **not** need a true-solar-time correction: house cusps are driven by sidereal time, which already bakes in longitude. Applying a second longitude correction on top would double-count it — the single largest and easiest-to-miss difference from this project's sibling servers (see [Sibling servers](#-sibling-servers-ziwei-mcp--bazi-mcp) below).

---

## 🎯 The core promise: never fake a birth time

A large share of real users do not know their exact birth time. Most tools either refuse outright or silently assume 12:00 noon — producing an Ascendant that looks completely normal and is almost certainly wrong (the Ascendant moves about 1 degree every 4 minutes; a wrong guess of even 20 minutes can move it into the wrong sign). This project never does that. Instead there are three input modes, selected by whether `clockTime` / `clockTimeRange` is present:

| Mode | Trigger | Behaviour |
|---|---|---|
| **A — exact** | `clockTime` given | Full chart, no degradation. |
| **B — window** | `clockTimeRange: { from, to }` given | The Ascendant/Midheaven/houses/Part of Fortune reduce to **candidate sign segments** with sub-range timestamps, found by bisection (`diagnostics.method: "bisect"`) where the Ascendant is provably monotonic (measured: strictly monotonic up to \|latitude\| ≈ 66°), or by dense (≤30s) sampling (`"scan"`) beyond it, where it is measurably non-monotonic (132 reversals/day at 70°N) and bisection would silently return the wrong candidate. `diagnostics.ascendantMonotonic` reports which regime applied. `from > to` means the window crosses midnight. |
| **C — date only** | Neither given | `angles`, `houses`, `positions[].house`, and `partOfFortune` are **omitted fields**, not `null` placeholders — check `diagnostics.omitted` for why each one is missing. The Sun gets two sign candidates on the ~12 days/year it crosses a sign boundary during the day; every body reports a `degreeRange` across the full local calendar day instead of a single value; aspects are only reported if they hold at **both** ends of the day, with an `orbRange` instead of a single orb; `applying`/`separating` is never reported (it needs an exact relative speed). |

`partOfFortune` deserves a special callout: it is neither "an angle" nor "a house" field, so it is the one most likely to be forgotten and returned anyway with a fabricated Ascendant baked in. Its day/night (sect) determination and its starting point both depend on the Ascendant, so it is omitted in modes B and C without exception.

---

## 🚀 Quickstart

```bash
bunx @lhk714/astro-mcp@latest
```

```bash
npx -y @lhk714/astro-mcp@latest
```

## ⚙️ MCP Client Configuration

```json
{
  "mcpServers": {
    "astro": {
      "command": "npx",
      "args": ["-y", "@lhk714/astro-mcp@latest"]
    }
  }
}
```

---

## 🛠️ Tools

### 1. `calculate_natal`

Requires `solarDate` and a location (`place`, or `longitude` + `latitude` + `timezone`). `clockTime` and `clockTimeRange` are optional and mutually exclusive (see the three modes above); `dstFold` (`0`/`1`) disambiguates a DST fall-back repeated hour.

**Conventions** — every default below is a specific school's choice, not a neutral one, and is echoed back in `diagnostics`:

| Parameter | Default | Alternative(s) | Belongs to |
|---|---|---|---|
| `houseSystem` | `placidus` | `whole-sign`, `equal`, `porphyry` | Modern mainstream, and specifically the convention used by the dominant Chinese-language astrology tools (占星之门/测测/爱星盘) — not `auseklis`'s own whole-sign default. Measured on one chart: 9 of 10 planets land in a different house, and the Midheaven itself moves from house 10 to house 11, switching from Placidus to whole-sign — a **conventions** difference, not an accuracy one. |
| `zodiac` | `tropical` | `sidereal-lahiri`, `sidereal-fagan-bradley` | Tropical is the Western mainstream; the two ayanamsas are exposed for Vedic-adjacent use. |
| `node` | `"true"` (osculating) | `"mean"` | Modern preference — `auseklis` only ever had the mean node. True and mean can differ by up to ~1.6°, enough to cross a sign boundary. |
| `lilith` | `"mean"` (mean lunar apogee) | `"true"` (osculating apogee) | Popular astrology's convention; `"true"` is a minority choice. |
| `minorAspects` | `false` | `true` | Only the five majors (conjunction/sextile/square/trine/opposition) by default. |
| `declinationAspects` | `false` | `true` | Minority convention — and the exact spot where `auseklis` fabricated results from a hard-coded zero declination. Enabling it uses real ecliptic-latitude-derived declination. |
| Orbs | conjunction/opposition 8°, square/trine 7°, sextile 6°, minors 2–3° | — (not currently an input override) | Modern convention: orbs keyed to **aspect type**, not to each body's own light (classical moiety). Not exposed as a parameter yet — see Known limitations. |
| `chiron` | `true` | `false` | On by default: standard in modern psychological astrology, with real usage in Chinese social media. |
| `asteroids` | `false` | `true` (adds Ceres/Pallas/Juno/Vesta) | Off by default: low mainstream usage; kept behind one flag since it shares Chiron's own code path. |
| Essential dignity | domicile/exaltation/detriment/fall only | — | The four dignities modern astrology kept from classical technique. Triplicity/term/face are **not** implemented (out of scope, see §0). Outer-planet rulerships (Uranus→Aquarius, Neptune→Pisces, Pluto→Scorpio) are a modern convention with no classical consensus, and are marked `modern: true` in the output so a caller can tell them apart from the classical seven-planet assignments. |
| `lang` | `"zh"` | `"en"` | Chinese-first output (signs, bodies, aspects, dignities, diagnostic prose), matching `ziwei-mcp`/`bazi-mcp`. |

**Not supported:** a default of `clockTime: 12:00` when the birth time is unknown — see [The core promise](#-the-core-promise-never-fake-a-birth-time). There is no such default; omit `clockTime`/`clockTimeRange` entirely to get the honestly-degraded chart instead.

### 2. `lookup_location`

Resolves an English city name to longitude, latitude, and IANA timezone across 7,329 cities in 227 countries — the same database `ziwei-mcp`/`bazi-mcp` use. Same-named cities in different timezones (e.g. Springfield, or Cambridge UK vs Cambridge MA) are refused with the candidate list rather than guessed — **except** when one candidate's population dominates the other by 10x or more (e.g. "Los Angeles" resolves straight to the ~8.1M-population California city over a same-named ~135k-population town in Chile's Bío-Bío region); that dominance is reported in `mixedWarning` rather than applied silently.

---

## 🚢 Releasing

Publishing is automated and runs on a tag:

```bash
# bump the version in package.json first, then
git tag -a v0.1.2 -m "v0.1.2" && git push origin v0.1.2
```

The workflow refuses to publish unless the tag matches `package.json`'s
version, and refuses `workflow_dispatch` runs outright — a manual run has no
tag, so it would publish whatever happens to sit on the branch. It authenticates
through npm's OIDC trusted publishing rather than a long-lived `NPM_TOKEN`, so
there is no secret to rotate or leak, and provenance is attached automatically.

## 📏 Accuracy

Measured against JPL Horizons (`QUANTITIES=31`, light-time-corrected), across 1900–2050–2100:

- **Major bodies (Sun–Pluto) and lunar nodes:** ≤ 1 arcminute across the whole range. The Moon specifically needed `SetDeltaTFunction(DeltaT_JplHorizons)` instead of `astronomy-engine`'s default Delta-T model to hold that bound at 2100 (0.02′ vs 1.31′ with the default model).
- **Small bodies** (Chiron + the four asteroids, via `GravitySimulator` seeded from JPL state vectors): **≤ 0.4 arcminutes**, comfortably inside the 1.5′ budget the tests enforce. Chiron uses a 4-day integration step; the four inner asteroids (much faster, much closer orbits) need a 0.25-day step to hold that bound — a 4-day step was measured up to 2° off for them, an entire wrong sign.
- **Seeds are stored at 11 epochs** (every 20 years, 1900–2100) rather than at J2000 alone, so no integration ever runs more than ~10 years. That was originally a performance fix — a 1900 chart with asteroids took 4.7 s and risked tripping an MCP client timeout, and now takes ~450 ms — but a shorter integration also drifts less, which is why the figures below improved along with the speed. `scripts/pull-seeds.ts` regenerates the whole table from JPL.

| Body | 1900 | 1950 | 1990 | 2026 | 2050 | 2100 | Step |
|---|---|---|---|---|---|---|---|
| Chiron | 0.33′ | 0.32′ | 0.32′ | 0.15′ | 0.28′ | 0.26′ | 4 days |
| Ceres | 0.35′ | 0.26′ | 0.26′ | 0.16′ | 0.37′ | 0.15′ | 0.25 days |
| Pallas | 0.37′ | 0.16′ | 0.39′ | 0.22′ | 0.05′ | 0.22′ | 0.25 days |
| Juno | 0.35′ | 0.04′ | 0.28′ | 0.30′ | 0.27′ | 0.33′ | 0.25 days |
| Vesta | 0.04′ | 0.33′ | 0.20′ | 0.16′ | 0.12′ | 0.28′ | 0.25 days |

The true lunar node is independently self-checked against `astronomy-engine`'s own node-crossing events (`SearchMoonNode`/`NextMoonNode`): the Moon's ecliptic longitude at a crossing must equal the true node's longitude (or its antipode) to within 1 arcsecond — measured max deviation 0.01″.

---

## 🧭 Sibling servers: `ziwei-mcp` / `bazi-mcp`

This project does not calculate Zi Wei Dou Shu or Bazi (四柱/八字) — use [`@lhk714/ziwei-mcp`](https://github.com/listen-hai/ziwei-mcp) or [`@lhk714/bazi-mcp`](https://github.com/listen-hai/bazi-mcp) for those.

The shared birth-input fields (`place`, `longitude`, `timezone`, `dstFold`, `solarDate`, `clockTime`) and the geographic-resolution layer (`lookup_location`) are deliberately identical across all three servers, so a request built from the same birth data resolves to the same UTC instant and the same location in every one of them — a Western, Zi Wei, and Bazi chart for one person stay aligned. `latitude` is the one field this project adds beyond the shared contract: Western astrology's Ascendant and houses need it, and neither sibling does.

What is **not** shared, on purpose: this project drops the true-solar-time correction those two apply to the clock (see [Overview](#-overview) above) — Western house cusps are driven by sidereal time, which already accounts for longitude, so re-applying a longitude correction here would double-count it, not refine it.

---

## 🙏 Credits

- [`astronomy-engine`](https://github.com/cosinekitty/astronomy) (MIT) — the ephemeris engine for every body position, `GravitySimulator` for small bodies, and sidereal time / obliquity / nutation for the angles and house cusps.
- [`auseklis`](https://github.com/igmizo/auseklis) (MIT) — `src/ephemeris/vendor/houses.ts` (the Placidus/Porphyry/Equal/Whole-Sign house solvers, including the polar-circle fallback) and `src/ephemeris/vendor/sidereal.ts` (Lahiri/Fagan-Bradley ayanamsa) are adapted from it, logic unchanged. Full attribution and MIT license text in [NOTICE](NOTICE). Its Ascendant formula and small-body/node/Lilith handling are **not** reused — see §0 and the Overview above for why.

## Known limitations

- No support for births before 1900 (aligned with `ziwei-mcp`/`bazi-mcp`; pre-1883 civil time zones are not well-defined either).
- Five small bodies only (Chiron + Ceres/Pallas/Juno/Vesta), not the full minor-planet catalogue — the same code path, so more could be added.
- No fixed stars, no Arabic parts beyond the Part of Fortune, no antiscia.
- Two ayanamsas only (Lahiri, Fagan-Bradley) — Krishnamurti and others are not implemented.
- Orbs are not yet an input parameter (the defaults in the Conventions table above are fixed).

## 📜 License

MIT.
