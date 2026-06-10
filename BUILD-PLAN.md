# OklejAuto — PPF Store Theme Build (Savor → LuxxCar vibe)

## Context

Client store: PPF pre-cut protection kits for high-wear car detail zones, PL market, **all Meta traffic lands on Home** (landing page) → element carousel → PDP → cart. Fulfillment cuts on demand for any car — vehicle captured as **line item properties** (free text). Mobile-first.

Workbench (verified): local repo `c:\Users\adrwa\Documents\dev\OklejAuto` (Savor/Horizon) → GitHub `AdrH87/OklejAuto` main → auto-sync to theme `OklejAuto/main` (#203213701406) on `test-z4rrgor8`. **Git is the write path**; preview via `shopify theme dev`. Never `theme push` to connected theme.

Reference: https://luxxcar.framer.website/ — investigated desktop 1440 + mobile 375, tokens extracted from computed styles.

## Store structure (grilled & locked)

**Products (10):**
- 7 elementy: wnęki klamek, próg bagażnika, progi drzwi, słupki drzwi (piano black), lampy przednie, krawędzie drzwi, ekran multimediów (antypaluch)
- 3 pakiety: Pakiet 1/2/3 — tiered bundles of elements, priced below sum. **Not browsable at launch** (excluded from collections/carousel/nav) — sold exclusively through PDP bundle presenter. Later phase: separate "Pakiety" grid where people select pre-made bundles directly.

**Pages (3):** Home (landing), Collection (elements grid), PDP.

**Per-element pakiet mapping:** each element product gets a metafield referencing which pakiety contain it — tier selector shows only valid upgrades. (Compositions needed from client — open item.)

## Page structures (grilled & locked)

### Home — the Meta landing page
1. **Video hero** — bg video: slick application process + finished car, text overlay (H1 + CTA). Mobile-safe: short muted loop, compressed, poster image fallback, preload for LCP.
2. **Authority + social proof** — real assets exist: reviews (quote + name), IG reels, photos from client's detailing shop. Angle: realny warsztat detailingowy.
3. **Pain education** — "te miejsca niszczą się pierwsze": klamki, progi, piano black scratches; photo-led (can embed before/after comparison-slider block here).
4. **Element carousel** — 7 elementów, LuxxCar fleet-card pattern (surface #1F1F1F, photo, name, spec pills, price) → click → PDP. No pakiety here.
5. **FAQ** — accordion, krótkie.

### Collection
- Grid of 7 elementów only, LuxxCar card style, 2-col mobile / 3-col desktop. No filters. Pakiety excluded at launch (second pre-made-bundles grid added later).

### PDP — mobile stack (Adrian's order)
1. Product image (gallery; element photo, optional before/after slide)
2. Product title
3. Social proof — stars + review count
4. Reviews + selling points as icon row (samoregeneracja, niewidoczna, montaż DIY, gwarancja)
5. **Vehicle inputs** — Marka, Model, Rocznik (required), Wersja/nadwozie (placeholder "np. M-pakiet, kombi, facelift") — free text, `properties[...]`
6. **Bundle presenter + ATC** — tier selector tap-tiles: [Sam element] [Pakiet X −Y%] [Pakiet Z −W%] with savings badges; selection swaps the product/variant added; vehicle properties ride along; ATC = white pill full-width
7. Payment icons + trust badges
8. Delivery information
9. FAQ accordion
10. Extended features + expanded social proof (reels/photos)

Optional (decide on preview): sticky bottom ATC bar after scrolling past buy box — high-value for Meta mobile, not in Adrian's stack, default off.

## Design system (extracted from LuxxCar → Savor mapping)

| Token | Value | Savor mechanism |
|---|---|---|
| Base bg | `#111111` | duplicate scheme-5 as default scheme |
| Card surface | `#1F1F1F` | section/card color scheme |
| Glass surface | `rgba(255,255,255,0.05)` + border `rgba(255,255,255,0.1)` | `assets/custom-theme.css` |
| Text | white / muted `rgba(255,255,255,0.55)` | scheme foreground |
| Accent | **gold `#F7BE18`** — sparingly (icons, outline buttons, micro-details) | scheme `primary` |
| Primary CTA | white pill, dark text | primary button colors + `button_border_radius_primary: 99` |
| Secondary CTA | gold outline pill | secondary button colors, radius 99 |
| Badges/pills | white-5% bg, pill radius | `badge_corner_radius: 99`, `variant_button_radius: 99` |
| Cards/images | radius 12–16px | `card_corner_radius: 12` |
| Font | **Golos Text** 400/500/600/700, tight heading tracking | font picker if in Shopify library; else Google Fonts via custom CSS + family var override |
| Photography | dark moody automotive | client/stock assets |

All copy **Polish**. Zero `!important` — CSS vars + specificity.

## Build phases

**Phase 0 — Contract in repo:** write `DESIGN-CONTRACT.md` + `BUILD-PLAN.md` (this content) into OklejAuto repo.

**Phase 1 — Global design system:** `config/settings_data.json` (dark scheme default, radii, typography), `assets/custom-theme.css` (Golos Text load if needed, glass utilities) enqueued in `layout/theme.liquid`. Verify header/footer/cart drawer on dark scheme.

**Phase 2 — PDP** (conversion surface):
- Vehicle inputs: reuse built-in `blocks/product-custom-property.liquid` ×4 in `_product-details` group (`templates/product.json`)
- **Bundle presenter: new custom block** (`blocks/bundle-tier-selector.liquid` + JS) — radio tiles driven by pakiet metafield refs, swaps form variant id, computes savings badge from real prices; vehicle properties attach to whichever product is added; mirror vehicle to cart attribute for future use
- Icon selling-points row: `group` + `icon` + `text` blocks (custom block only if composition can't match design)
- Payment icons (`payment-icons` block), delivery info block, FAQ accordion (custom section or accordion-custom.js reuse), extended proof sections
- Dummy products (2 elementy + 1 pakiet) created via Shopify MCP for testing — **MCP must be switched from Aaroma to test-z4rrgor8 first** (flag to Adrian when we get there)

**Phase 3 — Home:** video hero (`hero.liquid` supports video; else custom), social proof section, pain education (media-with-content + comparison-slider block wrapped), element carousel (`product-list` carousel layout), FAQ. `templates/index.json`.

**Phase 4 — Collection:** elements grid via collection template + card styling to fleet-card pattern.

**Phase 5 — Mobile pass:** every visual change screenshot at **375px + 1440px** before approval; LCP audit (hero video poster, image sizes); touch targets ≥44px.

## Working rules
- `git pull` before each session (Shopify auto-commits editor changes).
- Visual flow: local render → screenshots both breakpoints → Adrian approves → commit+push (auto-syncs to store theme).
- Atomic commits per step.

## Verification
- `shopify theme dev` render of all 3 pages, both breakpoints, vs reference vibe.
- Functional: ATC with vehicle fields → `properties[Marka/Model/Rocznik/Wersja]` in cart + `/cart.js`; tier selector adds correct pakiet product with properties; required-field gate blocks empty ATC.
- `shopify theme check` — no new offenses.
- GitHub→store sync hash check after pushes (established method).

## Open items (client-side, not blockers)
- Pakiet 1/2/3 compositions + pricing (needed for tier selector metafields)
- Hero video asset (application process + finished car)
- Element photos, reviews export, IG reels selection
- Golos Text fallback approval if absent from Shopify library

---

## STATUS 2026-06-10 (resume-state)

**DONE (committed, pushed, synced to OklejAuto/main #203213701406 — hash-verified):**
- Phase 0-1: contract docs, dark design system (schemes/radii/typography + custom-theme.css + Golos Text latin-ext via Google Fonts)
- Phase 2 PDP: 4x vehicle inputs (properties[Marka/Model/Rocznik/Wersja]), oa-bundle-tier-selector (metafield oa.pakiety, savings z compare_at), oa-selling-points, FAQ, delivery line; accelerated checkout disabled na PDP
- Phase 3 Home: oa-video-hero / oa-social-proof / oa-pain-education / karuzela (collection: elementy) / oa-faq
- Phase 4 Collection: fleet-card skin (shared z karuzelą), spec pills z tagów, 2-col/3-col
- Review loop: integration clean + adversarial review (2 CRITICAL + 1 HIGH fixed, re-review APPROVED). Theme check 0 offenses.

**BLOCKED — Adrian:**
1. Storefront password (admin → Online Store → Preferences) → odblokowuje `shopify theme dev` + screenshoty 375/1440
2. `shopify store auth --store test-z4rrgor8.myshopify.com --scopes read_products,write_products` — kliknąć approve w przeglądarce → odblokowuje dummy products
3. Pakiet 1/2/3: skład + ceny (potrzebne do metafield oa.pakiety + compare_at = suma części)
4. Assety: hero video, zdjęcia elementów/stref, opinie, liczby do stat chips

**NEXT (po odblokowaniu):**
1. Dummy products (2 elementy + 1 pakiet) + metafield oa.pakiety + collection "elementy"
2. Render 375px + 1440px → screenshoty → approval Adriana (visual gate)
3. Verify na żywo: disabled accelerated-checkout faktycznie znika (platform-runtime caveat z review), tier selector E2E (properties w /cart.js)
4. Store language → PL (theme ma locales/pl.json), nav menu (Sklep), strona /collections/elementy
