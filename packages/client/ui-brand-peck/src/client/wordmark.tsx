// Peck Harness brand wordmark: the peck bird + "Peck Harness" in one svg. Ink
// rides currentColor; the bird matches the favicon so the mark reads
// identically at every size. Kept private to this package so the generic
// primitives package keeps its upstream-neutral wordmark.

import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'

/** Display options for the Peck Harness brand wordmark. */
export interface PeckWordmarkProps extends IconProps {
  /** Whether to include the leading peck-bird mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the mark's fixed ratio).
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading peck-bird mark.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function PeckWordmark({ size = 24, className, includeMark = true }: PeckWordmarkProps) {
  const width = includeMark ? 160 : 136
  return (
    <svg
      width={(size * width) / 24}
      height={size}
      className={className}
      viewBox={includeMark ? '0 0 160 24' : '24 0 136 24'}
      fill="none"
      aria-hidden="true"
    >
      {includeMark && (
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
      )}
      {/* "Peck Harness" text node keeps the name crisp and theme-adaptive on
          currentColor. */}
      <text
        x="27"
        y="17"
        fill="currentColor"
        fontSize="16"
        fontWeight="600"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
      >
        Peck Harness
      </text>
    </svg>
  )
}
