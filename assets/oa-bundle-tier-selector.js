// assets/oa-bundle-tier-selector.js
import { Component } from '@theme/component';
import { ThemeEvents } from '@theme/events';
import { fetchConfig } from '@theme/utilities';

/**
 * Bundle tier selector for OklejAuto PDPs.
 *
 * Radio tap-tiles: tile 1 ("Sam element") is the current element product,
 * tiles 2+ are "Pakiet" bundle products referenced by the `oa.pakiety`
 * metafield (list.product_reference).
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
 *
 * On variant:update the captured state is stale (the theme rewrote the input
 * and re-rendered the price), so captures are dropped and the selected pakiet
 * is re-applied in a microtask — guaranteed to run after every synchronous
 * section listener (product-form, product-price) of the same event,
 * regardless of listener registration order.
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
   * After the theme finishes a variant update: product-form has rewritten the
   * hidden variant input, product-price has re-rendered the native price, and
   * a full-section morph may have re-rendered the radios. Drop the now-stale
   * captures, refresh tile 1's mini price, then re-assert the selected tier.
   * @param {CustomEvent} event
   */
  #onVariantUpdate = (event) => {
    queueMicrotask(() => {
      this.#nativeVariantId = null;
      this.#nativePriceNodes = null;

      this.#updateCurrentTilePrice(event);

      const selected = this.#selectedInput;
      if (!selected) return;
      if (!selected.checked) selected.checked = true;
      if (selected.dataset.tier === 'pakiet') this.#applyPakiet(selected);
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
