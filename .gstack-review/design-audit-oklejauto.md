# Design Audit — OklejAuto (iteration 2 + design-review pass)

Date: 2026-06-10 · Target: http://127.0.0.1:9292 (theme dev, working tree)
Reviewer: /design-review (gstack) · Contract: DESIGN-CONTRACT.md

## First Impression

The site communicates **dark premium automotive with a clear conversion intent**. I notice the gold accents stay disciplined (flags, icons, micro-details — never floods). The first 3 things my eye goes to: hero H1 → "Najpopularniejszy" gold flag on Pakiet 2 tile (PDP) → review cards. That ordering matches the funnel intent. One word: **spójny**.

Trunk test (home): PASS (logo/nav/sections/search all identifiable).
Classifier: HYBRID — landing-page rules for home, app-ui rules for buy box. No hard-rejection patterns. AI-slop scan: clean (no purple gradients, no icon-in-circle SaaS grids, no centered-everything, editorial mosaic ≠ uniform card grid; Golos Text ≠ default stack).

## Findings & fixes (all verified live)

| # | Impact | Finding | Fix | Commit |
|---|---|---|---|---|
| 001 | HIGH | Social proof desktop layout collapsed — marquee track (`width: max-content`, doubled set) blew the intro flex item out via default `min-width: auto`; reviews crushed to 152px | `min-width: 0` on `.oa-social__intro` + guards on marquee wrap. Verified: intro 480px / reviews 656px | c4d8651 |
| 002 | MEDIUM | FAQ centered (720px `margin-inline: auto`) while every other section sits hard-left — alignment rhythm break | `margin-inline: 0` | 7fab134 |
| 003 | POLISH | 4 tier tiles wrapped 3+1 at 375px (lonely Pakiet 3) | Fixed 2-col grid <480px → tidy 2×2, tiles 168px | 9135e39 |

## Verified clean (no action)

- Typography: single family (Golos), weights 400-700, no skipped heading levels, body ≥16px (PDP body 15px in muted FAQ answers — borderline, acceptable for secondary text)
- Color: disciplined palette, gold sparing per contract; dark scheme text off-white-ish via muted tokens
- Touch targets: tier tiles ≥64px, FAQ rows ≥44px, inputs ≥44px
- Reduced motion: marquee → static row; fold-open → instant; verified in code (media queries present)
- Tier selector E2E: 4 tiles, fold-open value stack (skład + Osobno przekreślone + −16%), price-on-button updates, properties ride to cart — tested live
- Benefit badge rail: lands on gallery edge (TryScent-style) at 1100-1440, no off-screen, no click-target conflict observed
- No horizontal scroll at 360/375; no console errors beyond dev-store noise (favicon, Shop widget)

## Deferred (content-dependent — not code)

- Gallery column dead space on desktop PDP — fills when real multi-photo sets land; optional: sticky media column (revisit after real photos)
- Recommendation card crops — placeholder art center-cropped by landscape ratio; fine with real photos
- Placeholder imagery throughout (hero video, pain zones, shop photos, logo files)
- EN strings from store config (nav menu, footer headings, "Add to cart" until store language → PL)

## Scores

Design Score: **B+** (placeholder content caps it — structure/typography/discipline are A-range; real assets should lift it)
AI Slop Score: **A** — no blacklist patterns; the editorial mosaic, metafield-driven value stack, and disciplined gold usage read as designed, not generated.

## Session learnings

- `shopify theme dev` (Windows): each in-place file edit during serving poisons the dev session (editor atomic-write tmp files synced as garbage → storefront 500). Protocol: stop server → edit → restart. (Logged to project memory.)
