import Color from 'color';

/** Shared ink treatment for capacity arcs and bars; preserve hue, lightness and alpha. */
export function resolveCapacityColor(color: string): string {
    const hsl = Color(color).hsl();
    return hsl.saturationl(Math.min(100, hsl.saturationl() * 1.25)).rgb().string();
}
