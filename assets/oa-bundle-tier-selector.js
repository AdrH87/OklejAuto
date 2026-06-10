// assets/oa-bundle-tier-selector.js
import { Component } from '@theme/component';
import { ThemeEvents } from '@theme/events';
import { fetchConfig } from '@theme/utilities';

/**
 * Bundle tier selector for OklejAuto PDPs.
 *
 * Horizontal radio tap-tiles: tile 1 ("Sam element") is the current element
 * product, tiles 2+ are "Pakiet" bundle products referenced by the
 * `oklejauto.pakiety` metafield (list.product_reference).
 *
 * Tile 1 never owns a variant id. The theme's native variant flow
 * (variant-picker + product-form + product-price) keeps ownership of the
 * form's hidden input[name="id"] and of the displayed price. Selecting a
 * pakiet tile captures that native state, then overrides the input value and
 * the children of the live price container with the pakiet's server-rendered
 * price markup (kept in a <template> per pakiet). Only the children of the
 * template's price wrapper are cloned, so exactly one [ref="priceContainer"]
 * exists in the DOM at all times — a nested duplicate would hijack
 * ProductPrice.refs (last-write-wins in Component#updateRefs). Selecting
 * tile 1 hands control back by restoring the captured state.
 * (If the merchant removes the standalone price block, the live container is
 * simply absent and the swap is skipped — the count never exceeds one.)
 *
 * Two presentation concerns ride on the same selection state:
 *
 * 1. Fold-open value stack — one server-rendered panel per pakiet
 *    ([data-tier-panel], keyed by variant id, hidden via grid-rows 0fr).
 *    #syncPanels only toggles `data-open`/`aria-hidden`; no fetches.
 * 2. Button price label — the add-to-cart button carries the active tier's
 *    price ("Dodaj do koszyka — <s>compare</s> price"). #updateButtonPrice
 *    appends a server-rendered <template data-button-price-for> fragment
 *    (money formatted in Liquid, never in JS) into the button label,
 *    idempotently (previous fragment removed first).
 *
 * On variant:update the captured state is stale (the theme rewrote the input
 * and re-rendered the price), so captures are dropped, the "current" tile
 * price + "current" button-price template are refreshed from the new section
 * render, and the selected pakiet is re-applied in a microtask — guaranteed
 * to run after every synchronous section listener (product-form,
 * product-price) of the same event, regardless of listener registration
 * order. The microtask also re-syncs the panels and the button label, which
 * a full-section morph resets to their server-rendered defaults.
 *
 * Selection survives full-section morphs (e.g. the variant-picker 'main'
 * path) by mirroring the theme's variant-picker pattern: the selected radio
 * carries `data-current-checked`, one of the attributes morph.js explicitly
 * preserves (MORPH_OPTIONS.onBeforeUpdate), while the radios' `checked`
 * state itself is reset by the morph.
 *
 * Vehicle line-item properties live in the same form, so they ride along no
 * matter which product is added. After a successful add to cart, the vehicle
 * fields are mirrored into a cart attribute (attributes[vehicle] = "Marka
 * Model Rocznik Wersja") for future bundle logic.
 */
class OaBundleTierSelector extends Component {
  #abortController = new AbortController();

  /** @type {string | null} Theme-owned variant id, captured before a pakiet overwrites it. */
  #nativeVariantId = null;

  /** @type {Node[] | null} Clones of the theme-owned price markup, captured before a pakiet swap. */
  #nativePriceNodes = null;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const section = this.closest('.shopify-section');

    // Mirror vehicle fields into cart attributes after a successful add from this section's form.
    section?.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate, { signal });

    // The theme's variant flow rewrites the form's hidden variant input (and may
    // morph this whole block). Re-assert the selected tier after it runs.
    section?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, { signal });

    // Sync the form with the initially checked tile (also covers back/forward
    // navigation, where the browser restores radio state into fresh markup).
    this.#applyTier(this.#checkedInput);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  /** @returns {HTMLFormElement | null} The section's product form. */
  get #form() {
    const form = document.getElementById(this.dataset.productFormId ?? '');
    return form instanceof HTMLFormElement ? form : null;
  }

  /** @returns {HTMLInputElement | null} The product form's hidden variant id input. */
  get #variantInput() {
    const input = this.#form?.querySelector('input[name="id"]');
    return input instanceof HTMLInputElement ? input : null;
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

  /**
   * Declarative handler for the tier radios (on:change).
   * @param {Event & { target: HTMLInputElement }} event
   */
  handleTierChange(event) {
    this.#applyTier(event.target);
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

    if (input.dataset.tier === 'pakiet') {
      this.#applyPakiet(input);
    } else {
      this.#restoreNativeTier();
    }

    this.#syncPanels(input);
    this.#updateButtonPrice(input);
  }

  /**
   * Points the form at the pakiet product and swaps the displayed price,
   * capturing the theme-owned state first so tile 1 can restore it.
   * @param {HTMLInputElement} input - The pakiet tier radio.
   */
  #applyPakiet(input) {
    const variantInput = this.#variantInput;
    if (variantInput) {
      if (this.#nativeVariantId === null) this.#nativeVariantId = variantInput.value;
      variantInput.value = input.value;
    }

    const priceContainer = this.#priceContainer;
    const template = this.querySelector(`template[data-variant-id="${input.value}"]`);
    const pakietPrice =
      template instanceof HTMLTemplateElement ? template.content.querySelector('[ref="priceContainer"]') : null;

    if (!priceContainer || !pakietPrice) return;

    if (this.#nativePriceNodes === null) {
      this.#nativePriceNodes = Array.from(priceContainer.childNodes, (node) => node.cloneNode(true));
    }

    // Clone only the wrapper's children — never insert a second [ref="priceContainer"].
    const clone = pakietPrice.cloneNode(true);
    priceContainer.replaceChildren(...clone.childNodes);
  }

  /**
   * Hands the variant id and price back to the theme's native flow ("Sam element").
   */
  #restoreNativeTier() {
    if (this.#nativeVariantId !== null) {
      const variantInput = this.#variantInput;
      if (variantInput) variantInput.value = this.#nativeVariantId;
      this.#nativeVariantId = null;
    }

    if (this.#nativePriceNodes !== null) {
      this.#priceContainer?.replaceChildren(...this.#nativePriceNodes);
      this.#nativePriceNodes = null;
    }
  }

  /**
   * Opens the value-stack panel of the selected pakiet, closes the rest.
   * Panels are server-rendered and keyed by variant id; "Sam element" keeps
   * everything collapsed. Pure attribute toggling — no fetches.
   * @param {HTMLInputElement | null} input - The selected tier radio.
   */
  #syncPanels(input) {
    const openId = input?.dataset.tier === 'pakiet' ? input.value : null;

    for (const panel of this.querySelectorAll('[data-tier-panel]')) {
      if (!(panel instanceof HTMLElement)) continue;
      const isOpen = openId !== null && panel.dataset.variantId === openId;

      if (isOpen) {
        panel.dataset.open = 'true';
        panel.setAttribute('aria-hidden', 'false');
      } else {
        delete panel.dataset.open;
        panel.setAttribute('aria-hidden', 'true');
      }
    }
  }

  /**
   * Appends the selected tier's server-rendered price fragment to every
   * add-to-cart button label in the form ("Dodaj do koszyka — <s>compare</s>
   * price") — there can be more than one (e.g. sticky ATC). Idempotent: all
   * previous fragments are removed first, so morphs and repeated calls never
   * stack fragments.
   * @param {HTMLInputElement | null} input - The selected tier radio.
   */
  #updateButtonPrice(input) {
    const form = this.#form;
    if (!form) return;

    for (const fragment of form.querySelectorAll('.oa-atc-price')) {
      fragment.remove();
    }

    if (!input) return;

    const key = input.dataset.tier === 'pakiet' ? input.value : 'current';
    const template = this.querySelector(`template[data-button-price-for="${key}"]`);

    if (!(template instanceof HTMLTemplateElement)) return;

    for (const target of form.querySelectorAll('.add-to-cart-text__content')) {
      target.append(template.content.cloneNode(true));
    }
  }

  /**
   * After the theme finishes a variant update: product-form has rewritten the
   * hidden variant input, product-price has re-rendered the native price, and
   * a full-section morph may have re-rendered the radios, panels and button.
   * Drop the now-stale captures, refresh tile 1's mini price and the
   * "current" button-price fragment, then re-assert the selected tier.
   * @param {CustomEvent} event
   */
  #onVariantUpdate = (event) => {
    queueMicrotask(() => {
      this.#nativeVariantId = null;
      this.#nativePriceNodes = null;

      this.#updateCurrentTilePrice(event);
      this.#updateCurrentButtonPriceTemplate(event);

      const selected = this.#selectedInput;
      if (!selected) return;
      if (!selected.checked) selected.checked = true;
      if (selected.dataset.tier === 'pakiet') this.#applyPakiet(selected);

      this.#syncPanels(selected);
      this.#updateButtonPrice(selected);
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
   * render, so the button label tracks the theme-selected variant. Pakiet
   * fragments are static per variant id and never need refreshing.
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
