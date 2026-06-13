// assets/oa-cart-rewards.js
import { ThemeEvents, CartUpdateEvent } from '@theme/events';
import { formatMoney } from '@theme/money-formatting';

/**
 * OklejAuto cart-drawer REWARD BAR.
 *
 * A progress bar toward tiered rewards (free shipping / gift / discount).
 * Built once by oa-cart-rewards.liquid, which renders the TIERS JSON and the
 * node markup; this element only reads state and paints it.
 *
 * State source of truth: cart.original_total_price (the TRUE pre-discount
 * product value, in grosze). NOT items_subtotal_price — that field is POST
 * line-level discount, and this store's automatic discounts (2+/4+ elements)
 * are line-level, so items_subtotal shrinks once a discount applies and would
 * push a shopper BELOW a tier they already earned. original_total_price is the
 * intended threshold basis. Tiers are thresholds in grosze. The bar fills
 * toward the highest threshold; each node flips to .is-reached once the value
 * clears it.
 *
 * Gift manager: gift tiers add their configured variant to the cart as a line
 * with property _gift="1" (and _gift_tier="<threshold>"). The manager runs an
 * idempotent diff against the live cart — adds missing reached gifts, removes
 * gifts whose tier is no longer reached. Mutations are wrapped in a re-entrancy
 * lock so the cart:update they trigger does not recurse; after mutating we fetch
 * /cart.js and dispatch a CartUpdateEvent (source "oa-cart-rewards") so the cart
 * drawer + cart icon refresh exactly like a native cart change. Our own
 * cart:update listener ignores that source as a second guard alongside the lock.
 *
 * Money is formatted client-side with the theme's money-formatting module;
 * shop.money_format + ISO currency ride in as data attributes (contract).
 */

/** Source tag on cart:update events this element dispatches, so it can ignore its own mutations. */
const SELF_SOURCE = 'oa-cart-rewards';

class OaCartRewards extends HTMLElement {
  /** @type {AbortController | undefined} */
  #abortController;

  /**
   * Tiers ascending by threshold (grosze).
   * @type {Array<{ t: number, type: string, label: string, gift: number | null }>}
   */
  #tiers = [];

  /** @type {number} Highest tier threshold (grosze); 0 when no tiers. */
  #maxThreshold = 0;

  /** @type {boolean} Re-entrancy guard for the gift-manager mutations. */
  #mutating = false;

  connectedCallback() {
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    this.#tiers = this.#parseTiers();
    this.#maxThreshold = this.#tiers.reduce((max, tier) => Math.max(max, tier.t), 0);

    // CartAddEvent and CartUpdateEvent both fire ThemeEvents.cartUpdate ('cart:update')
    // and bubble to the document — one listener covers adds and updates.
    document.addEventListener(ThemeEvents.cartUpdate, this.#onCartUpdate, { signal });

    // Paint-on-connect: a freshly loaded page with an already-populated cart
    // fires no cart:update, so the bar must paint itself from /cart.js now.
    // Fire-and-forget (connectedCallback can't be async); #refresh awaits the
    // fetch internally, then renders. Errors are logged, never swallow render.
    void this.#refresh();
  }

  disconnectedCallback() {
    this.#abortController?.abort();
  }

  /**
   * Parses the TIERS JSON embedded by the Liquid. Returns [] on any failure so
   * the bar degrades to "nothing reachable" rather than throwing on connect.
   * @returns {Array<{ t: number, type: string, label: string, gift: number | null }>}
   */
  #parseTiers() {
    const script = this.querySelector('.oa-cart-rewards__data');
    if (!script?.textContent) return [];

    try {
      const parsed = JSON.parse(script.textContent);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((tier) => tier && typeof tier.t === 'number' && tier.t > 0)
        .sort((a, b) => a.t - b.t);
    } catch (error) {
      console.error('[oa-cart-rewards] Failed to parse tiers JSON', error);
      return [];
    }
  }

  /** @returns {HTMLElement | null} */
  get #message() {
    return this.querySelector('.oa-cart-rewards__message');
  }

  /** @returns {HTMLElement | null} */
  get #progress() {
    return this.querySelector('.oa-cart-rewards__progress');
  }

  /** @returns {HTMLElement[]} */
  get #nodes() {
    return /** @type {HTMLElement[]} */ ([...this.querySelectorAll('.oa-cart-rewards__node')]);
  }

  /** @param {number} grosze @returns {string} Money formatted like the `money` Liquid filter. */
  #money(grosze) {
    return formatMoney(grosze, this.dataset.moneyFormat || '{{amount}}', this.dataset.currency || 'PLN');
  }

  /**
   * Cart-update handler. Ignores updates this element itself dispatched (the
   * gift-manager mutation) — both via the lock and the source tag — then
   * re-renders from the fresh cart payload (or refetches if none rode along).
   * @param {CustomEvent} event
   */
  #onCartUpdate = (event) => {
    if (this.#mutating) return;
    if (event.detail?.data?.source === SELF_SOURCE) return;

    const cart = event.detail?.resource;
    if (cart && typeof cart.original_total_price === 'number' && Array.isArray(cart.items)) {
      this.#apply(cart);
    } else {
      // Some emitters (e.g. drawer quantity changes) fire without a full cart
      // payload — refetch to stay accurate.
      this.#refresh();
    }
  };

  /** Fetches the live cart and renders it. */
  async #refresh() {
    let cart;
    try {
      const response = await fetch('/cart.js', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`/cart.js responded ${response.status}`);
      cart = await response.json();
    } catch (error) {
      console.error('[oa-cart-rewards] /cart.js fetch failed', error);
      return;
    }
    this.#apply(cart);
  }

  /**
   * Renders the bar from a cart, then reconciles gift lines. Render runs first
   * so the bar reflects the user's action immediately; the gift diff (if any)
   * dispatches its own cart:update that re-renders once the cart settles.
   * @param {{ original_total_price?: number, items?: Array<any> }} cart
   */
  #apply(cart) {
    const value = this.#basis(cart);
    this.#render(value);
    this.#manageGifts(cart);
  }

  /**
   * The threshold basis from a cart: original_total_price (pre-discount product
   * value, grosze). Falls back to 0 when absent so the bar degrades to empty.
   * @param {{ original_total_price?: number }} cart
   * @returns {number}
   */
  #basis(cart) {
    return typeof cart?.original_total_price === 'number' ? cart.original_total_price : 0;
  }

  /**
   * Paints the progress fill, node states and message from the PRE-discount
   * cart value (grosze). Guards an empty/no-threshold tier set.
   * @param {number} value - cart.original_total_price in grosze.
   */
  #render(value) {
    // Progress fill toward the highest threshold.
    if (this.#progress) {
      const pct = this.#maxThreshold > 0 ? Math.min(100, (value / this.#maxThreshold) * 100) : 0;
      this.#progress.style.width = `${pct}%`;
    }

    // Node reached-states (read each node's own data-threshold, per contract).
    for (const node of this.#nodes) {
      const threshold = Number(node.dataset.threshold) || 0;
      node.classList.toggle('is-reached', value >= threshold);
    }

    this.#renderMessage(value);
  }

  /**
   * Sets the message: remaining amount + label of the next unreached tier, or
   * the all-unlocked text once every tier is cleared. Empty/zero cart shows the
   * first tier as the goal (next unreached == first tier).
   * @param {number} value - cart.original_total_price in grosze.
   */
  #renderMessage(value) {
    const message = this.#message;
    if (!message) return;

    if (this.#tiers.length === 0 || this.#maxThreshold <= 0) {
      message.textContent = '';
      return;
    }

    const next = this.#tiers.find((tier) => value < tier.t);

    if (!next) {
      message.textContent = this.dataset.allUnlocked || '';
      return;
    }

    const template = this.dataset.remainingTemplate || 'Jeszcze [amount] do: [reward]';
    message.textContent = template
      .replace('[amount]', this.#money(next.t - value))
      .replace('[reward]', next.label || '');
  }

  /**
   * Idempotent gift reconciliation. Desired = variant ids of every reached gift
   * tier (cumulative). Current = cart lines carrying property _gift. Adds the
   * missing, removes the extras (gift lines whose variant is no longer desired).
   * Wrapped in a lock so the resulting cart:update does not loop.
   * @param {{ original_total_price?: number, items?: Array<any> }} cart
   */
  async #manageGifts(cart) {
    if (this.#mutating) return;
    if (!Array.isArray(cart?.items)) return;

    const value = this.#basis(cart);

    // Desired gift variant ids: reached gift tiers with a configured gift variant.
    const desired = new Set(
      this.#tiers
        .filter((tier) => tier.type === 'gift' && tier.gift != null && value >= tier.t)
        .map((tier) => tier.gift)
    );

    // Current gift lines in the cart (property _gift truthy).
    const giftLines = cart.items.filter((item) => item?.properties && item.properties._gift);

    /** @type {Array<{ id: number, quantity: number, properties: Record<string, string> }>} */
    const toAdd = [];
    for (const tier of this.#tiers) {
      if (tier.type !== 'gift' || tier.gift == null) continue;
      if (value < tier.t) continue;
      const alreadyInCart = giftLines.some((line) => line.variant_id === tier.gift);
      if (!alreadyInCart) {
        toAdd.push({
          id: tier.gift,
          quantity: 1,
          properties: { _gift: '1', _gift_tier: String(tier.t) },
        });
      }
    }

    // Gift lines whose variant is no longer desired → remove (quantity 0 by line key).
    /** @type {string[]} */
    const toRemove = giftLines
      .filter((line) => !desired.has(line.variant_id))
      .map((line) => line.key)
      .filter(Boolean);

    if (toAdd.length === 0 && toRemove.length === 0) return;

    this.#mutating = true;
    try {
      // /cart/change.js + /cart/add.js (literal .js endpoints) return the JSON
      // cart. Theme.routes.cart_change_url is NOT .js-suffixed (only cart_add_url
      // is), so going through it would hit the HTML redirect endpoint instead.
      const JSON_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json' };

      // Removals first so an add never trips a higher tier's quantity expectations.
      for (const key of toRemove) {
        await fetch('/cart/change.js', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ id: key, quantity: 0 }),
        });
      }

      if (toAdd.length > 0) {
        await fetch('/cart/add.js', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ items: toAdd }),
        });
      }

      let nextCart;
      try {
        nextCart = await (await fetch('/cart.js')).json();
      } catch {
        nextCart = undefined;
      }

      // Refresh the drawer + cart icon like a native cart change. Tagged with
      // our own source so #onCartUpdate ignores it (lock already released below
      // only after dispatch, but the source guard is the durable one).
      document.dispatchEvent(new CartUpdateEvent(nextCart ?? {}, this.id || SELF_SOURCE, { source: SELF_SOURCE }));

      // Re-render directly from the settled cart (the self-tagged event won't).
      if (nextCart) this.#render(this.#basis(nextCart));
    } catch (error) {
      console.error('[oa-cart-rewards] Gift reconciliation failed', error);
    } finally {
      this.#mutating = false;
    }
  }
}

if (!customElements.get('oa-cart-rewards')) {
  customElements.define('oa-cart-rewards', OaCartRewards);
}
