// Pure color conversions for the color picker (HEX ↔ HSV).
export type Hsv = { h: number; s: number; v: number } // h: 0..360, s/v: 0..1

export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s) || /^[0-9a-fA-F]{4}$/.test(s)) {
    s = s.split('').map((c) => c + c).join('')
  }
  if (/^[0-9a-fA-F]{6}$/.test(s) || /^[0-9a-fA-F]{8}$/.test(s)) return '#' + s.toLowerCase()
  return null
}

/** Split a hex color into its RGB color (#rrggbb) + alpha (0..1). */
export function splitAlpha(hex: string): { rgb: string; alpha: number } {
  const h = normalizeHex(hex) ?? '#000000'
  if (h.length === 9) return { rgb: h.slice(0, 7), alpha: Number.parseInt(h.slice(7, 9), 16) / 255 }
  return { rgb: h, alpha: 1 }
}

/** Combine an RGB color and an alpha into hex (#rrggbb if opaque, otherwise #rrggbbaa). */
export function withAlpha(rgbHex: string, alpha: number): string {
  const rgb = (normalizeHex(rgbHex) ?? '#000000').slice(0, 7)
  if (alpha >= 1) return rgb
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
  return rgb + a
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = normalizeHex(hex) ?? '#000000'
  return {
    r: Number.parseInt(h.slice(1, 3), 16),
    g: Number.parseInt(h.slice(3, 5), 16),
    b: Number.parseInt(h.slice(5, 7), 16),
  }
}

const toHex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + toHex2(r) + toHex2(g) + toHex2(b)
}

export function hexToHsv(hex: string): Hsv {
  const { r, g, b } = hexToRgb(hex)
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** Composite `fg` (with possible alpha) over `bg` (opaque) → opaque RGB color. */
export function compositeOver(fg: string, bg: string): string {
  const { rgb, alpha } = splitAlpha(fg)
  const f = hexToRgb(rgb)
  const b = hexToRgb(splitAlpha(bg).rgb)
  const mix = (x: number, y: number) => x * alpha + y * (1 - alpha)
  return rgbToHex(mix(f.r, b.r), mix(f.g, b.g), mix(f.b, b.b))
}

/** Interpolate two hex colors (RGB + alpha) at `t` ∈ [0,1]. Pure, no dependency. */
export function lerpColor(a: string, b: string, t: number): string {
  const A = splitAlpha(a)
  const B = splitAlpha(b)
  const ca = hexToRgb(A.rgb)
  const cb = hexToRgb(B.rgb)
  const mix = (x: number, y: number) => x + (y - x) * t
  const rgb = rgbToHex(mix(ca.r, cb.r), mix(ca.g, cb.g), mix(ca.b, cb.b))
  return withAlpha(rgb, mix(A.alpha, B.alpha))
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r: number, g: number, b: number
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}
