# OklejAuto — Design Contract

Source of truth for design + structure decisions. Grilled & locked with Adrian 2026-06-10.
Reference: https://luxxcar.framer.website/ (tokens extracted from computed styles, desktop 1440 + mobile 375).

## Business model

PPF pre-cut protection kits for high-wear car detail zones. PL market, copy **po polsku**.
Fulfillment cuts on demand for **any car** — vehicle captured at purchase as line item properties (free text, no fitment catalog).
All Meta ads traffic lands on **Home** (landing page) → element carousel → PDP → cart. Mobile-first.

## Catalog (10 products)

**7 elementów** (browsable):
1. Wnęki klamek
2. Próg bagażnika
3. Progi drzwi
4. Słupki drzwi (piano black)
5. Lampy przednie
6. Krawędzie drzwi
7. Ekran multimediów (antypaluch)

**3 pakiety** (Pakiet 1/2/3) — tiered bundles of elements, priced below sum of parts.
**Not browsable at launch**: excluded from collections, carousel, nav. Sold exclusively through the PDP bundle presenter. Later phase: separate "Pakiety" grid for direct selection.

**Per-element pakiet mapping:** each element product carries a metafield referencing which pakiety contain it — the PDP tier selector shows only valid upgrades. Compositions + pricing: pending from client.

## Pages (3)

### Home — the landing page (all ad traffic)
1. **Video hero** — bg video (application process + finished car), text overlay H1 + CTA. Short muted loop, compressed, poster fallback, LCP-safe.
2. **Authority + social proof** — reviews (quote + name), IG reels, photos from client's detailing shop. Angle: realny warsztat detailingowy.
3. **Pain education** — "te miejsca niszczą się pierwsze" (klamki, progi, piano black); photo-led; may embed before/after comparison slider.
4. **Element carousel** — 7 elementów, fleet-card pattern → PDP. No pakiety.
5. **FAQ** — accordion, krótkie.

### Collection
Grid of 7 elementów only. Fleet-card style, 2-col mobile / 3-col desktop. No filters.

### PDP — mobile stack (locked order)
1. Product image (gallery; optional before/after slide)
2. Product title
3. Social proof — stars + review count
4. Reviews + selling points icon row (samoregeneracja, niewidoczna, montaż DIY, gwarancja)
5. **Vehicle inputs** — Marka, Model, Rocznik (required), Wersja/nadwozie (placeholder "np. M-pakiet, kombi, facelift") — free text → `properties[...]`
6. **Bundle presenter + ATC** — tier tap-tiles: [Sam element] [Pakiet X −Y%] [Pakiet Z −W%] with savings badges; selection swaps product added; vehicle properties ride along; ATC = white pill full-width
7. Payment icons + trust badges
8. Delivery information
9. FAQ accordion
10. Extended features + expanded social proof

Optional (decide on preview): sticky bottom ATC bar — default off.

Accelerated checkout ukryty na PDP — wymusza przejście przez wymagane pola pojazdu (express checkout pozostaje dostępny w koszyku/checkout).

## Design tokens (LuxxCar → Savor)

| Token | Value |
|---|---|
| Base bg | `#111111` |
| Card surface | `#1F1F1F` |
| Glass surface | `rgba(255,255,255,0.05)` + 1px border `rgba(255,255,255,0.1)` |
| Text | white; muted `rgba(255,255,255,0.55)` |
| Accent | gold `#F7BE18` — SPARINGLY (icons, outline buttons, micro-details) |
| Primary CTA | white pill, dark text, radius 99px |
| Secondary CTA | gold outline pill, gold text, radius 99px |
| Badges/spec pills | white-5% bg, pill radius |
| Cards/images | radius 12–16px |
| Font | Golos Text 400/500/600/700, tight heading tracking (−0.01em), H1 500 weight |
| Photography | dark, moody automotive |

## Hard rules
- Zero `!important` — CSS vars + specificity only
- Every visual change verified at 375px AND 1440px before approval
- Touch targets ≥44px mobile
- Git is the write path (GitHub-connected theme); never `shopify theme push` to OklejAuto/main
- Settings-driven first; custom CSS only for what settings can't do
