/**
 * Peck brand occupants with their host-supplied presentation props.
 * @module @deepseek-ai/dsh-client-ui-brand-peck/brand
 */

import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PeckMark } from './mark.tsx'
import { PeckWordmark } from './wordmark.tsx'

type PeckBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the peck-bird mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the peck-bird mark.
 */
export function PeckBrandMark({ size, className }: PeckBrandMarkProps) {
  return <PeckMark size={size} className={className} />
}

/**
 * Render the brand name artwork without its independently slotted mark.
 * @returns the "Peck Harness" wordmark.
 */
export function PeckBrandName() {
  return <PeckWordmark includeMark={false} />
}
