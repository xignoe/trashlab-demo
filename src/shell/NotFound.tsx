import { Link } from 'react-router-dom'
import { PERSONAS } from './routes'

/** Any path the persona map does not know. Lists every screen so nothing is a dead end. */
export function NotFound() {
  return (
    <main className="pb-notfound">
      <h1>No screen at this address</h1>
      <p>Pick a screen:</p>
      <ul>
        {PERSONAS.flatMap(p => p.screens.map(s => (
          <li key={s.to}><Link to={s.to}>{p.label}: {s.label}</Link></li>
        )))}
      </ul>
    </main>
  )
}
