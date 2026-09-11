import { Outlet } from 'react-router-dom'
import { PersonaBar } from './PersonaBar'

/** Persona bar over whichever surface the route mounts. */
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
