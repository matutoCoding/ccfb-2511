import type { AppData, Scheme } from './types';

export interface Ctx {
  data: AppData;
  save(): void;
  scheme(): Scheme;
}

type Child = Node | string | null | undefined;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as (e: Event) => void);
    } else if (k === 'value') {
      (node as HTMLInputElement).value = String(v);
    } else if (v !== false && v !== null && v !== undefined) {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c as Node | string);
  }
  return node;
}

export function numInput(
  value: number,
  onChange: (v: number) => void,
  opts: { step?: number; min?: number; max?: number; width?: string } = {},
): HTMLInputElement {
  return el('input', {
    type: 'number', value: String(value),
    step: String(opts.step ?? 1),
    ...(opts.min !== undefined ? { min: String(opts.min) } : {}),
    ...(opts.max !== undefined ? { max: String(opts.max) } : {}),
    style: `width:${opts.width ?? '90px'}`,
    onchange: (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) onChange(v);
    },
  });
}

export function textInput(value: string, onChange: (v: string) => void, width = '140px'): HTMLInputElement {
  return el('input', {
    type: 'text', value, style: `width:${width}`,
    onchange: (e) => onChange((e.target as HTMLInputElement).value),
  });
}

export function selectInput<T extends string>(
  options: { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLSelectElement {
  const sel = el('select', {
    onchange: (e) => onChange((e.target as HTMLSelectElement).value as T),
  }, options.map((o) => el('option', { value: o.value, ...(o.value === value ? { selected: 'selected' } : {}) }, [o.label])));
  return sel;
}
