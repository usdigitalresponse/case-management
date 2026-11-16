// How the guide points at and fills the real page: through each control's
// own events, so the page behaves exactly as if the visitor had done it.
import type { Target } from './missions';

const visible = (element: Element) => (element as HTMLElement).offsetParent !== null || element.getClientRects().length > 0;

export function findTarget(target: Target, root: ParentNode = document): HTMLElement | null {
  if ('selector' in target) {
    return ([...root.querySelectorAll(target.selector)].find(visible) as HTMLElement | undefined) ?? null;
  }
  const wanted = target.text.toLowerCase();
  // The name a screen reader hears: a short label's aria-label, else its text.
  const name = (element: Element) => (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().toLowerCase();
  const candidates = [...root.querySelectorAll('a, button, label, summary, [role="button"], .notice__heading')].filter(
    (element) => !element.closest('.guide') && visible(element),
  );
  return (
    (candidates.find((element) => name(element) === wanted) as HTMLElement | undefined) ??
    (candidates.find((element) => name(element).includes(wanted)) as HTMLElement | undefined) ??
    null
  );
}

export function showTarget(element: HTMLElement): void {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.add('tour-highlight');
  window.setTimeout(() => element.classList.remove('tour-highlight'), 3000);
}

// React listens for the native input event, so set the value as the browser would.
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype = Object.getPrototypeOf(element) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
}

// For a select, the value may be an option's value or a word in its label.
export function fillField(selector: string, value: string, root: ParentNode = document): boolean {
  const element = [...root.querySelectorAll(selector)].find(
    (candidate) => visible(candidate) && /^(INPUT|TEXTAREA|SELECT)$/.test(candidate.tagName),
  ) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | undefined;
  if (!element) return false;
  let next = value;
  if (element instanceof HTMLSelectElement) {
    const options = [...element.options].filter((candidate) => candidate.value);
    const words = value.toLowerCase().split(/\W+/).filter(Boolean);
    const optionWords = (text: string) => text.toLowerCase().split(/\W+/);
    // Exact first, so "Mail" isn't taken for "Email"; then every word, in any order ("Last, First").
    const option =
      options.find((candidate) => candidate.value === value || candidate.text.toLowerCase() === value.toLowerCase()) ??
      options.find((candidate) => words.every((word) => optionWords(candidate.text).includes(word)));
    if (!option) return false;
    next = option.value;
  }
  setNativeValue(element, next);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.focus();
  return true;
}

// Hands a file to the page's own file input, as choosing it would.
export function chooseFile(file: File): boolean {
  const input = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')].find((candidate) => !candidate.disabled);
  if (!input) return false;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
