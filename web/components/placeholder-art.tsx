/**
 * Styled placeholder artwork for the lamps (Vision.md open item 6: own stock
 * photography is pending, styled placeholders are the accepted interim).
 *
 * Pure presentation: no images, no client JS, server-renderable as-is. The
 * silhouette is simple SVG geometry (dome + trumpet base for Panthella-style
 * lamps, stacked shades + stem for PH-style lamps) and its glow colour derives
 * from the SKU's `placeholder.hue` (lib/catalog.ts).
 *
 * Design rules respected here (docs/designs/havn-opening-drop.md):
 * - The glow is the only saturated colour on the site; it is layered as flat
 *   translucent fills. No gradients anywhere.
 * - Motion is transition only (opacity / fill), with a reduced-motion opt-out.
 *
 * Two states: `lit` (glow on) and unlit. components/lights-toggle.tsx is the
 * only client component that flips the state on product pages; elsewhere the
 * state is fixed at render time.
 */

interface PlaceholderArtProps {
  /** Hue of this SKU's glow, from `CatalogProduct.placeholder.hue`. */
  hue: number;
  lit: boolean;
  /** Lamp family silhouette. */
  variant?: "dome" | "shades";
  /**
   * Localized accessible name (role="img"). Omit for decorative art, which
   * is then hidden from assistive technology.
   */
  label?: string;
}

/* Flat fills mirroring app/globals.css tokens (kept as hex/hsl here because
   dynamic hue values must reach the `fill` CSS property to transition). */
const SAND = "#e3d8c6";
const LINEN = "#cfc2ab";

export default function PlaceholderArt({
  hue,
  lit,
  variant = "dome",
  label,
}: PlaceholderArtProps) {
  const glow = `hsl(${hue} 72% 62%)`;
  const shadeLit = `hsl(${hue} 62% 80%)`;

  return (
    <div className="bg-ecru">
      <svg
        viewBox="0 0 480 480"
        className="block h-auto w-full"
        role={label ? "img" : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {/* Glow: flat translucent layers, opacity transition only. */}
        <g
          aria-hidden="true"
          className="transition-opacity duration-700 motion-reduce:transition-none"
          style={{ opacity: lit ? 1 : 0 }}
        >
          <circle cx="240" cy="230" r="168" style={{ fill: glow, opacity: 0.1 }} />
          <circle cx="240" cy="230" r="118" style={{ fill: glow, opacity: 0.16 }} />
          <circle cx="240" cy="230" r="76" style={{ fill: glow, opacity: 0.22 }} />
          <ellipse
            cx="240"
            cy="376"
            rx="150"
            ry="26"
            style={{ fill: glow, opacity: 0.14 }}
          />
        </g>

        {variant === "dome" ? (
          <g aria-hidden="true">
            {/* Trumpet base + neck */}
            <path
              d="M 224 250 C 224 306 210 324 206 362 L 274 362 C 270 324 256 306 256 250 Z"
              style={{ fill: LINEN }}
            />
            <ellipse cx="240" cy="363" rx="92" ry="11" style={{ fill: LINEN }} />
            {/* Domed shade */}
            <path
              d="M 138 252 A 102 102 0 0 1 342 252 Z"
              className="transition-colors duration-700 motion-reduce:transition-none"
              style={{ fill: lit ? shadeLit : SAND }}
            />
          </g>
        ) : (
          <g aria-hidden="true">
            {/* Stem + base */}
            <rect x="230" y="258" width="20" height="92" style={{ fill: LINEN }} />
            <ellipse cx="240" cy="352" rx="96" ry="12" style={{ fill: LINEN }} />
            {/* Three stacked shades */}
            <path
              d="M 118 258 A 122 56 0 0 1 362 258 Z"
              className="transition-colors duration-700 motion-reduce:transition-none"
              style={{ fill: lit ? shadeLit : SAND }}
            />
            <path
              d="M 152 214 A 88 46 0 0 1 328 214 Z"
              className="transition-colors duration-700 motion-reduce:transition-none"
              style={{ fill: lit ? shadeLit : SAND }}
            />
            <path
              d="M 186 172 A 54 34 0 0 1 294 172 Z"
              className="transition-colors duration-700 motion-reduce:transition-none"
              style={{ fill: lit ? shadeLit : SAND }}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
