/** Minimal DOM helpers. No framework; the app is small enough not to need one. */

export type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;
export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  apply(el, attrs);
  add(el, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    else el.setAttribute(k, String(v));
  }
  add(el, children);
  return el;
}

function apply(el: HTMLElement, attrs: Attrs): void {
  for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (typeof v === 'function') {
      el.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      el.className = String(v);
    } else if (k === 'text') {
      el.textContent = String(v);
    } else if (k === 'html') {
      el.innerHTML = String(v);
    } else if (k.startsWith('data-') || k.startsWith('aria-') || k === 'role') {
      el.setAttribute(k, String(v));
    } else if (k in el) {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

function add(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function on<K extends keyof HTMLElementEventMap>(
  el: Element,
  type: K,
  fn: (e: HTMLElementEventMap[K]) => void,
): () => void {
  el.addEventListener(type, fn as EventListener);
  return () => el.removeEventListener(type, fn as EventListener);
}

/** Copy to clipboard, falling back to a hidden textarea on older browsers. */
export async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
