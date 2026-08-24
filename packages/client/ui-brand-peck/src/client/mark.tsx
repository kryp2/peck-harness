// Peck bird mark (shared artwork with the peck.to favicon). Native 24x24,
// drawn in a 24x24 viewBox; color rides currentColor so the mark inks the same
// as adjacent wordmark text. Kept private to this package so the generic
// primitives package stays upstream-neutral brand art.

import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Render the peck bird mark.
 * @param props.size - width/height in px (default 24; the mark is square).
 * @param props.className - extra class for layout placement.
 * @returns the logo svg (aria-hidden decorative brand art).
 */
export function PeckMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="15" cy="6" r="2.5" />
        <circle cx="15.8" cy="5.5" r="0.5" fill="currentColor" stroke="none" />
        <path d="M17.2 7 L19 9.5 L16.5 8.5" />
        <path d="M12.5 8 C9 9, 7 12, 7.5 15 C8 17, 10 18, 12 17.5 L15 16 C17 15, 17.5 12, 16.5 9" />
        <path d="M10 11 C8 10.5, 5.5 11, 4 13 C5.5 12.5, 7.5 12.5, 9 13" />
        <path d="M7.5 15 C5 15.5, 3.5 14.5, 2 15" />
        <path d="M7.5 15.5 C5.5 16.5, 4 16, 2.5 16.5" />
        <path d="M11 17.5 L10.5 21" />
        <path d="M13.5 16.5 L13.5 21" />
        <path d="M9 21 L10.5 21 L12 21" />
        <path d="M12 21 L13.5 21 L15 21" />
      </g>
    </svg>
  )
}
