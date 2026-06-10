// assets/oa-bundle-tier-selector.js
import { Component } from '@theme/component';
import { ThemeEvents, CartAddEvent, CartErrorEvent } from '@theme/events';
import { fetchConfig } from '@theme/utilities';
import { formatMoney } from '@theme/money-formatting';
import { cartPerformance } from '@theme/performance';

// Mirror product-form.js timings so the error/success UX is indistinguishable
// from the theme's native add-to-cart flow.
const ERROR_MESSAGE_DISPLAY_DURATION = 10000;
const SUCCESS_MESSAGE_DISPLAY_DURATION = 5000;

/**
 * Choose-your-own bundle tier selector for OklejAuto PDPs.
 *
 * Three radio tap-tiles: "1 element" (the current product, native form flow),
 * "2 elementy" and "4 elementy" (bundle tiers). Bundle tiers open a single
 * fold-out panel with checkbox chips — one per product of the configured
 * collection — where the shopper picks EXACTLY 2 or 4 elements. The price
 * shown (panel summary, main price block, ATC button label) is
 * sum(checked chip prices) × (1 − tier discount%). The discount itself is
 * applied in the cart by Shopify automatic discounts (min 2 / min 4 items
 * from the collection) — the PDP only displays the expected outcome.
 *
 * Tile 1 never interferes with the theme: the form's hidden input[name="id"]
 * stays theme-owned at ALL times (unlike v1, no variant id is ever swapped —
 * bundle adds bypass the single-variant form payload entirely).
 *
 * Bundle mode takes over three presentation concerns, each lazily capturing
 * the native state so tile 1 can restore it:
 *
 * 1. Main price block — children of the live `product-price
 *    [ref="priceContainer"]` are replaced with a server-rendered skeleton
 *    (<template data-bundle-price>, contains NO [ref="priceContainer"] of its
 *    own) whose amount slots are filled via formatMoney. Exactly one
 *    [ref="priceContainer"] exists in the DOM at all times — a nested
 *    duplicate would hijack ProductPrice.refs (last-write-wins in
 *    Component#updateRefs).
 * 2. ATC button label — "current" tier appends the server-rendered
 *    <template data-button-price-for="current"> fragment (v1 pattern);
 *    bundle tiers fill the <template data-bundle-atc-price> skeleton.
 *    Idempotent: previous fragments removed first.
 * 3. ATC disabled state — disabled while checked count ≠ required count.
 *    Native disabled state (e.g. sold-out current variant) is captured on
 *    entry and restored on exit; in bundle mode availability is per-chip,
 *    not per-current-variant.
 *
 * Money is formatted client-side with the theme's own money-formatting
 * module (shop.money_format + ISO currency ride in as data attributes) —
 * bundle sums are combinatorial, so server-rendered fragments can't cover
 * them like v1's fixed pakiet prices could.
 *
 * Submit interception: the theme dispatches `on:submit` handlers from a
 * document-level CAPTURE listener (component.js#registerEventListeners), so
 * a listener on the form itself would run too late. We listen on `window`
 * in capture phase — window precedes document on the capture path — and for
 * bundle tiers preventDefault + stopImmediatePropagation before the theme's
 * ProductFormComponent.handleSubmit ever sees the event. The multi-line add
 * then mirrors the theme's own batch pattern
 * (ProductFormComponent.#processBatchAddToCart): POST cart_add_url with
 * {items, sections}, error UI via [ref="addToCartTextError"] + live region,
 * CartErrorEvent/CartAddEvent dispatched FROM the product-form-component
 * element so every downstream consumer (cart drawer, cart icon, this
 * component's own vehicle mirror) sees an identical event. Vehicle line-item
 * properties (name^="properties[") are copied onto every items[] entry.
 *
 * Native submits only fire after browser validation (no `novalidate`), so
 * required vehicle fields block bundle adds exactly like native ones;
 * reportValidity() stays as a guard for exotic submit paths.
 *
 * Morph survival: selection state lives on the elements as
 * `data-current-checked` (tier radios AND chips) — one of the attributes
 * morph.js explicitly preserves (MORPH_OPTIONS.onBeforeUpdate) while the
 * `checked` property itself is reset. On variant:update all captures are
 * dropped (the theme re-rendered/rewrote them), tile 1's mini price and the
 * "current" button template are refreshed from the new section render, and
 * the selected tier + chips are re-asserted in a microtask — guaranteed to
 * run after every synchronous section listener of the same event.
 *
 * After a successful add, vehicle fields are mirrored into a cart attribute
 * (attributes[vehicle]) — unchanged from v1.
 */
class OaBundleTierSelector extends Component {
  #abortController = new AbortController();

  /** @type {Node[] | null} Clones of the theme-owned price markup, captured before a bundle swap. */
  #nativePriceNodes = null;

  /** @type {boolean | null} Theme-owned ATC disabled state, captured before bundle mode overrides it. */
  #nativeButtonDisabled = null;

  /** @type {boolean} Re-entrancy guard for the multi-line add. */
  #adding = false;

  /** @type {ReturnType<typeof setTimeout> | undefined} */
  #errorTimeout;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const section = this.closest('.shopify-section');

    // Mirror vehicle fields into cart attributes after a successful add from this section's form.
    section?.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate, { signal });

    // The theme's variant flow re-renders prices and may morph this whole block.
    section?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, { signal });

    // window capture runs before component.js's document-level on:submit dispatcher.
    window.addEventListener('submit', this.#onSubmitCapture, { capture: true, signal });

    // Restore chip + tier state from morph-preserved markers (also covers
    // back/forward navigation restoring inputs into fresh markup).
    this.#syncChipsFromMarkers();
    this.#applyTier(this.#checkedInput);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
    clearTimeout(this.#errorTimeout);
  }

  /** @returns {HTMLFormElement | null} The section's product form. */
  get #form() {
    const form = document.getElementById(this.dataset.productFormId ?? '');
    return form instanceof HTMLFormElement ? form : null;
  }

  /** @returns {HTMLElement | null} The form's owning product-form-component (events + error UI host). */
  get #productFormComponent() {
    return this.#form?.closest('product-form-component') ?? null;
  }

  /** @returns {Element | null} The live price container rendered by the section's price block. */
  get #priceContainer() {
    return this.closest('.shopify-section')?.querySelector('product-price [ref="priceContainer"]') ?? null;
  }

  /** @returns {HTMLInputElement | null} The currently checked tier radio. */
  get #checkedInput() {
    return this.querySelector('.oa-tier__input:checked');
  }

  /**
   * The tier the shopper selected. Prefers the `data-current-checked` marker —
   * it survives morphs (see MORPH_OPTIONS.onBeforeUpdate), unlike `checked`.
   * @returns {HTMLInputElement | null}
   */
  get #selectedInput() {
    const marked = this.querySelector('.oa-tier__input[data-current-checked="true"]');
    if (marked instanceof HTMLInputElement && !marked.disabled) return marked;
    return this.#checkedInput;
  }

  /** @returns {HTMLInputElement[]} All element chips. */
  get #chips() {
    return /** @type {HTMLInputElement[]} */ ([...this.querySelectorAll('input[data-chip]')]);
  }

  /** @returns {HTMLButtonElement[]} All ATC buttons inside the product form component. */
  get #atcButtons() {
    return /** @type {HTMLButtonElement[]} */ ([
      ...(this.#productFormComponent?.querySelectorAll('button[ref="addToCartButton"]') ?? []),
    ]);
  }

  /** @param {number} cents @returns {string} Money formatted like the `money` Liquid filter. */
  #money(cents) {
    return formatMoney(cents, this.dataset.moneyFormat || '{{amount}}', this.dataset.currency || 'PLN');
  }

  /**
   * Declarative handler for the tier radios (on:change).
   * @param {Event & { target: HTMLInputElement }} event
   */
  handleTierChange(event) {
    this.#applyTier(event.target);
  }

  /**
   * Declarative handler for the element chips (on:change).
   * @param {Event & { target: HTMLInputElement }} event
   */
  handleChipChange(event) {
    const chip = event.target;
    chip.dataset.currentChecked = chip.checked ? 'true' : 'false';

    const selected = this.#selectedInput;
    if (selected?.dataset.tier === 'bundle') this.#refreshBundleUI(selected);
  }

  /** @param {HTMLInputElement | null} input - The selected tier radio. */
  #applyTier(input) {
    if (!input || input.disabled) return;

    // Mark the selection with a morph-preserved attribute (theme variant-picker pattern).
    for (const radio of this.querySelectorAll('.oa-tier__input')) {
      if (radio instanceof HTMLInputElement) {
        radio.dataset.currentChecked = radio === input ? 'true' : 'false';
      }
    }

    if (input.dataset.tier === 'bundle') {
      this.#applyBundleTier(input);
    } else {
      this.#restoreNativeTier();
    }
  }

  /**
   * Activates a bundle tier: trims over-selection from a higher tier, opens
   * the chips panel and recomputes all derived UI.
   * @param {HTMLInputElement} input - The bundle tier radio.
   */
  #applyBundleTier(input) {
    const required = Number(input.dataset.required) || 0;

    // Switching 4 -> 2 may leave too many chips checked; trim in document
    // order so the invariant "never more than required" holds.
    let kept = 0;
    for (const chip of this.#chips) {
      if (!chip.checked) continue;
      kept += 1;
      if (kept > required) {
        chip.checked = false;
        chip.dataset.currentChecked = 'false';
      }
    }

    this.#syncPanel(true);
    this.#refreshBundleUI(input);
  }

  /**
   * Recomputes everything derived from the chip selection: counter, chip
   * locking, panel sums, main price block, ATC label and disabled state.
   * @param {HTMLInputElement} input - The active bundle tier radio.
   */
  #refreshBundleUI(input) {
    const required = Number(input.dataset.required) || 0;
    const pct = Number(input.dataset.discountPct) || 0;
    const chips = this.#chips;
    const checked = chips.filter((chip) => chip.checked);

    // Cap: once the required count is reached, lock the remaining unchecked
    // chips (checked ones stay togglable; unavailable ones stay locked).
    for (const chip of chips) {
      if (chip.dataset.unavailable === 'true') {
        chip.disabled = true;
        continue;
      }
      chip.disabled = !chip.checked && checked.length >= required;
    }

    const separate = checked.reduce((sum, chip) => sum + (Number(chip.dataset.price) || 0), 0);
    const discounted = Math.round((separate * (100 - pct)) / 100);
    const separateText = this.#money(separate);
    const discountedText = this.#money(discounted);
    const showCompare = pct > 0 && discounted !== separate;

    const count = this.querySelector('[data-count]');
    if (count) count.textContent = String(checked.length);
    // [data-required-count] = the counter span only — plain [data-required]
    // would first match the tier-2 radio and send the update into a dead end.
    const requiredEl = this.querySelector('[data-required-count]');
    if (requiredEl) requiredEl.textContent = String(required);

    const separateLine = this.querySelector('[data-line-separate]');
    if (separateLine instanceof HTMLElement) separateLine.hidden = !showCompare;
    const separateSum = this.querySelector('[data-sum-separate]');
    if (separateSum) separateSum.textContent = separateText;
    const separateSr = this.querySelector('[data-sum-separate-sr]');
    if (separateSr) separateSr.textContent = separateText;

    const pctEl = this.querySelector('[data-discount-pct-text]');
    if (pctEl instanceof HTMLElement) {
      pctEl.textContent = `−${pct}%`;
      pctEl.hidden = pct <= 0;
    }
    const discountedSum = this.querySelector('[data-sum-discounted]');
    if (discountedSum) discountedSum.textContent = discountedText;

    this.#swapBundlePrice(separateText, discountedText, showCompare);
    this.#updateButtonPrice(input, { separateText, discountedText, showCompare });
    this.#setAtcDisabled(checked.length !== required);
  }

  /**
   * Hands price, button label and disabled state back to the theme's native
   * flow ("1 element").
   */
  #restoreNativeTier() {
    if (this.#nativePriceNodes !== null) {
      this.#priceContainer?.replaceChildren(...this.#nativePriceNodes);
      this.#nativePriceNodes = null;
    }

    if (this.#nativeButtonDisabled !== null) {
      for (const button of this.#atcButtons) button.disabled = this.#nativeButtonDisabled;
      this.#nativeButtonDisabled = null;
    }

    this.#syncPanel(false);
    this.#updateButtonPrice(this.#selectedInput, null);
  }

  /**
   * Opens/closes the single chips panel (grid-rows 0fr -> 1fr fold).
   * @param {boolean} open
   */
  #syncPanel(open) {
    const panel = this.querySelector('[data-tier-panel]');
    if (!(panel instanceof HTMLElement)) return;

    if (open) {
      panel.dataset.open = 'true';
      panel.setAttribute('aria-hidden', 'false');
    } else {
      delete panel.dataset.open;
      panel.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * Replaces the live price container's CHILDREN with the bundle price
   * skeleton and fills the computed amounts. Lazily captures the native
   * markup first so tile 1 can restore it. The skeleton holds no
   * [ref="priceContainer"], so the one-live-container invariant holds.
   * @param {string} separateText
   * @param {string} discountedText
   * @param {boolean} showCompare
   */
  #swapBundlePrice(separateText, discountedText, showCompare) {
    const container = this.#priceContainer;
    if (!container) return;

    if (this.#nativePriceNodes === null) {
      this.#nativePriceNodes = Array.from(container.childNodes, (node) => node.cloneNode(true));
    }

    if (!container.querySelector('[data-bundle-total]')) {
      const template = this.querySelector('template[data-bundle-price]');
      if (!(template instanceof HTMLTemplateElement)) return;
      container.replaceChildren(template.content.cloneNode(true));
    }

    const total = container.querySelector('[data-bundle-total]');
    if (total) total.textContent = discountedText;

    const compare = container.querySelector('[data-bundle-compare]');
    if (compare) compare.textContent = separateText;

    const compareGroup = container.querySelector('[data-bundle-compare-group]');
    if (compareGroup instanceof HTMLElement) compareGroup.hidden = !showCompare;
  }

  /**
   * Appends the active tier's price fragment to every add-to-cart button
   * label in the form. Idempotent: previous fragments removed first, so
   * morphs and repeated calls never stack fragments.
   * @param {HTMLInputElement | null} input - The selected tier radio.
   * @param {{separateText: string, discountedText: string, showCompare: boolean} | null} sums - Bundle sums, null for the native tier.
   */
  #updateButtonPrice(input, sums) {
    const form = this.#form;
    if (!form) return;

    for (const fragment of form.querySelectorAll('.oa-atc-price')) {
      fragment.remove();
    }

    if (!input) return;

    /** @type {DocumentFragment | null} */
    let content = null;

    if (input.dataset.tier === 'bundle' && sums) {
      const template = this.querySelector('template[data-bundle-atc-price]');
      if (!(template instanceof HTMLTemplateElement)) return;

      content = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
      const total = content.querySelector('[data-bundle-total]');
      if (total) total.textContent = sums.discountedText;
      const compare = content.querySelector('[data-bundle-compare]');
      if (compare) {
        if (sums.showCompare) compare.textContent = sums.separateText;
        else compare.remove();
      }
    } else if (input.dataset.tier !== 'bundle') {
      const template = this.querySelector('template[data-button-price-for="current"]');
      if (!(template instanceof HTMLTemplateElement)) return;
      content = /** @type {DocumentFragment} */ (template.content.cloneNode(true));
    }

    if (!content) return;

    for (const target of form.querySelectorAll('.add-to-cart-text__content')) {
      target.append(content.cloneNode(true));
    }
  }

  /**
   * Overrides the ATC disabled state in bundle mode, lazily capturing the
   * theme-owned state for the tile-1 restore.
   * @param {boolean} disabled
   */
  #setAtcDisabled(disabled) {
    const buttons = this.#atcButtons;
    if (buttons.length === 0) return;

    if (this.#nativeButtonDisabled === null) {
      this.#nativeButtonDisabled = buttons[0].disabled;
    }

    for (const button of buttons) button.disabled = disabled;
  }

  /** Restores chip `checked` properties from morph-preserved markers. */
  #syncChipsFromMarkers() {
    for (const chip of this.#chips) {
      const marker = chip.dataset.currentChecked;
      if (marker !== undefined) chip.checked = marker === 'true';
    }
  }

  /**
   * Intercepts bundle-tier submits before the theme's document-level
   * delegated handleSubmit (window capture precedes document capture).
   * Native single-product flow is untouched for tier 1.
   * @param {SubmitEvent} event
   */
  #onSubmitCapture = (event) => {
    const form = this.#form;
    if (!form || event.target !== form) return;

    const selected = this.#selectedInput;
    if (selected?.dataset.tier !== 'bundle') return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (this.#adding) return;
    // Browser validation already gates native submits; this guards
    // programmatic paths and keeps required vehicle fields blocking.
    if (!form.reportValidity()) return;

    const required = Number(selected.dataset.required) || 0;
    const checked = this.#chips.filter((chip) => chip.checked);
    if (checked.length !== required) return;

    const properties = this.#lineItemProperties(form);
    const items = checked.map((chip) => ({
      id: Number(chip.dataset.variantId),
      quantity: 1,
      properties,
    }));

    this.#adding = true;
    this.#addItemsToCart(items, event).finally(() => {
      this.#adding = false;
    });
  };

  /**
   * Collects line-item properties (vehicle fields etc.) from the product
   * form — every bundle line carries the same set.
   * @param {HTMLFormElement} form
   * @returns {Record<string, string>}
   */
  #lineItemProperties(form) {
    /** @type {Record<string, string>} */
    const properties = {};

    for (const [key, value] of new FormData(form)) {
      const match = key.match(/^properties\[(.+)\]$/);
      // Skip empty optional fields — unlike the urlencoded path, JSON
      // /cart/add.js keeps empty-string properties as junk on every line.
      if (match?.[1] && typeof value === 'string' && value.trim() !== '') properties[match[1]] = value;
    }

    return properties;
  }

  /**
   * Multi-line add mirroring ProductFormComponent.#processBatchAddToCart:
   * same payload shape, same error UI, same events from the same element —
   * cart drawer/icon refresh exactly like after a native add.
   * @param {Array<{id: number, quantity: number, properties: Record<string, string>}>} items
   * @param {Event} event - The intercepted submit event (performance marker).
   */
  async #addItemsToCart(items, event) {
    const pfc = this.#productFormComponent;

    const sectionIds = [];
    for (const element of document.querySelectorAll('cart-items-component')) {
      if (element instanceof HTMLElement && element.dataset.sectionId) {
        sectionIds.push(element.dataset.sectionId);
      }
    }

    try {
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, sections: sectionIds.join(',') }),
      });
      const result = await response.json();

      if (result.status) {
        // Shopify error payload (e.g. 422 sold out / cart limits).
        pfc?.dispatchEvent(
          new CartErrorEvent(this.#form?.getAttribute('id') || '', result.message, result.description, result.errors)
        );
        this.#showAddError(result.message || this.dataset.errorText || '');
        if (pfc) {
          pfc.dispatchEvent(
            new CartAddEvent({}, pfc.id, {
              didError: true,
              source: 'product-form-component',
              itemCount: items.length,
              productId: pfc.dataset.productId,
            })
          );
        }
        return;
      }

      this.#hideAddError();

      const addedText =
        pfc?.querySelector('.add-to-cart-text--added')?.textContent?.trim() || Theme.translations.added;
      this.#setLiveRegion(addedText);
      setTimeout(() => this.#setLiveRegion(''), SUCCESS_MESSAGE_DISPLAY_DURATION);

      let cart;
      try {
        cart = await (await fetch('/cart.js')).json();
      } catch {
        cart = undefined;
      }

      if (pfc) {
        pfc.dispatchEvent(
          new CartAddEvent(cart ?? undefined, pfc.id, {
            source: 'product-form-component',
            itemCount: items.length,
            productId: pfc.dataset.productId,
            sections: result.sections,
          })
        );
      }
    } catch (error) {
      console.error('[oa-bundle-tier-selector] Bundle add failed', error);
      this.#showAddError(this.dataset.errorText || '');
    } finally {
      cartPerformance.measureFromEvent('add:user-action', event);
    }
  }

  /**
   * Shows the theme's own inline ATC error (next to the button, no alert).
   * @param {string} message
   */
  #showAddError(message) {
    const errorElement = this.#productFormComponent?.querySelector('[ref="addToCartTextError"]');

    if (errorElement) {
      errorElement.classList.remove('hidden');
      // childNodes[2] = the text node after the svg wrapper (product-form.js reuse pattern).
      const textNode = errorElement.childNodes[2];
      if (textNode) {
        textNode.textContent = message;
      } else {
        errorElement.appendChild(document.createTextNode(message));
      }
    }

    this.#setLiveRegion(message);

    clearTimeout(this.#errorTimeout);
    this.#errorTimeout = setTimeout(() => {
      this.#hideAddError();
      this.#setLiveRegion('');
    }, ERROR_MESSAGE_DISPLAY_DURATION);
  }

  #hideAddError() {
    this.#productFormComponent?.querySelector('[ref="addToCartTextError"]')?.classList.add('hidden');
  }

  /** @param {string} text */
  #setLiveRegion(text) {
    const liveRegion = this.#productFormComponent?.querySelector('[ref="liveRegion"]');
    if (liveRegion) liveRegion.textContent = text;
  }

  /**
   * After the theme finishes a variant update: product-price re-rendered the
   * native price, the button may have been morphed, and a full-section morph
   * may have re-rendered radios/chips/templates. Drop the now-stale captures,
   * refresh tile 1's mini price and the "current" button-price template, then
   * re-assert the selected tier and chips.
   * @param {CustomEvent} event
   */
  #onVariantUpdate = (event) => {
    queueMicrotask(() => {
      this.#nativePriceNodes = null;
      this.#nativeButtonDisabled = null;

      this.#updateCurrentTilePrice(event);
      this.#updateCurrentButtonPriceTemplate(event);
      this.#syncChipsFromMarkers();

      const selected = this.#selectedInput;
      if (!selected) return;
      if (!selected.checked) selected.checked = true;

      this.#applyTier(selected);
    });
  };

  /**
   * Refreshes tile 1's mini price from the section render so it tracks the
   * theme-selected variant instead of staying baked at initial render.
   * @param {CustomEvent} event
   */
  #updateCurrentTilePrice(event) {
    const html = event.detail?.data?.html;
    if (!html) return;

    const newPrice = html.querySelector(
      `oa-bundle-tier-selector[data-block-id="${this.dataset.blockId}"] [data-tier-price="current"]`
    );
    const currentPrice = this.querySelector('[data-tier-price="current"]');

    if (newPrice && currentPrice && currentPrice.textContent !== newPrice.textContent) {
      currentPrice.textContent = newPrice.textContent;
    }
  }

  /**
   * Refreshes the "current" tier's button-price fragment from the section
   * render, so the button label tracks the theme-selected variant.
   * @param {CustomEvent} event
   */
  #updateCurrentButtonPriceTemplate(event) {
    const html = event.detail?.data?.html;
    if (!html) return;

    const newTemplate = html.querySelector(
      `oa-bundle-tier-selector[data-block-id="${this.dataset.blockId}"] template[data-button-price-for="current"]`
    );
    const currentTemplate = this.querySelector('template[data-button-price-for="current"]');

    if (newTemplate instanceof HTMLTemplateElement && currentTemplate instanceof HTMLTemplateElement) {
      currentTemplate.content.replaceChildren(...newTemplate.content.cloneNode(true).childNodes);
    }
  }

  /**
   * Mirrors the vehicle line-item properties into a cart attribute after a
   * successful add to cart from this section's product form.
   * @param {CustomEvent} event
   */
  #onCartUpdate = (event) => {
    const data = event.detail?.data;
    if (data?.source !== 'product-form-component' || data?.didError) return;

    const vehicle = this.#vehicleValue();
    if (!vehicle) return;

    const attributeKey = this.dataset.attributeKey || 'vehicle';
    const config = fetchConfig('json', {
      body: JSON.stringify({ attributes: { [attributeKey]: vehicle } }),
    });

    fetch(Theme.routes.cart_update_url, {
      ...config,
      signal: this.#abortController.signal,
    }).catch((error) => {
      if (error.name === 'AbortError') return;
      console.error('[oa-bundle-tier-selector] Cart attribute update failed', error);
    });
  };

  /** @returns {string} Space-joined vehicle field values, in configured key order. */
  #vehicleValue() {
    const form = this.#form;
    if (!form) return '';

    return (this.dataset.vehicleKeys ?? '')
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean)
      .map((key) => {
        const field = form.elements.namedItem(`properties[${key}]`);
        return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value.trim() : '';
      })
      .filter(Boolean)
      .join(' ');
  }
}

if (!customElements.get('oa-bundle-tier-selector')) {
  customElements.define('oa-bundle-tier-selector', OaBundleTierSelector);
}
