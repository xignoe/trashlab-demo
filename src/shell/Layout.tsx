import { Outlet } from 'react-router-dom'
import { PersonaBar } from './PersonaBar'

/**
 * Persona bar over whichever surface the route mounts.
 *
 * Every hauler gets the same TrashLab colors: signing in as a different tenant swaps the data, never the palette, so
 * the shell sets no per-tenant styling here.
 */
export function Layout() {
  return (
    <div className="pb-shell">
      <PersonaBar />
      <div className="shell-outlet">
        <Outlet />
      </div>
    </div>
  )
}
