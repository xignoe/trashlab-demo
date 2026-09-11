import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ServiceCatalog, ServiceCategory } from '../../../types'
import { useStore } from '../../../store/useStore'
import { withDrafts } from '../lib/rateVersions'
import { LOB_NAME, dimensionLabel, pricedByOf, serviceUsage, servicesByCategory, type CategoryGroup } from '../lib/config'
import { unitText } from '../lib/sheet'
import { BUTTON_LINK, BUTTON_PRIMARY, BUTTON_SECONDARY, Card, SectionHeader } from '../components/form'
import Pill from '../components/Pill'
import { CategoryDrawer, ServiceDrawer, UNIT_LABEL } from './ServiceForms'

type Editing =
  | { kind: 'service'; service?: ServiceCatalog; categoryId?: string }
  | { kind: 'category'; category?: ServiceCategory }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * The Services section of the Ratebook (DECISIONS.md entry 65): one card per category (uncategorized last) with a
 * table of its services, what each is priced by, and how much it is used (active lines, containers in inventory, rate
 * versions with drafts counted). Add category and Add service open drawers that save through the pricing slice; a
 * saved service leaves a note pointing at Rates, where its prices are set.
 */
export default function ServicesSection({ today }: { today: string }) {
  const db = useStore(s => s.db)
  const drafts = useStore(s => s.pricingDrafts)
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const view = useMemo(() => withDrafts(db, drafts), [db, drafts])
  const groups = useMemo(() => servicesByCategory(db), [db])

  const openRates = () => {
    const next = new URLSearchParams(params)
    next.delete('section')
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Services"
        description="Everything you sell, grouped in categories you define. A category's line of business decides how billing treats its services: recurring carts, recurring containers, or roll-off hauls. Each service says what its rates are keyed by."
        actions={
          <>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing({ kind: 'category' })}>Add category</button>
            <button type="button" className={BUTTON_PRIMARY} onClick={() => setEditing({ kind: 'service' })}>Add service</button>
          </>
        }
      />

      {note && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-success/40 bg-success-soft px-4 py-3">
          <p className="text-body font-semibold text-success">{note}</p>
          <div className="flex gap-1">
            <button type="button" className={BUTTON_LINK} onClick={openRates}>Open Rates</button>
            <button type="button" className={BUTTON_LINK} onClick={() => setNote(null)}>Dismiss</button>
          </div>
        </div>
      )}

      {groups.length === 0 && (
        <Card className="p-6">
          <p className="text-body text-muted">No categories yet. Add a category, then the services in it.</p>
        </Card>
      )}

      {groups.map(group => (
        <CategoryCard
          key={group.category?.id ?? '__uncategorized'}
          group={group}
          view={view}
          today={today}
          onEditCategory={category => setEditing({ kind: 'category', category })}
          onAddService={categoryId => setEditing({ kind: 'service', categoryId })}
          onEditService={service => setEditing({ kind: 'service', service })}
        />
      ))}

      {editing?.kind === 'service' && (
        <ServiceDrawer
          {...(editing.service ? { service: editing.service } : {})}
          {...(editing.categoryId ? { initialCategoryId: editing.categoryId } : {})}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setEditing(null)
            setNote(`Saved ${saved.name}. Add its prices under Rates.`)
          }}
        />
      )}
      {editing?.kind === 'category' && (
        <CategoryDrawer
          {...(editing.category ? { category: editing.category } : {})}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setEditing(null)
            setNote(`Saved category ${saved.name}.`)
          }}
        />
      )}
    </div>
  )
}

/** One category: its name, LOB, description, and a table of its services with usage. */
function CategoryCard({
  group, view, today, onEditCategory, onAddService, onEditService,
}: {
  group: CategoryGroup
  view: ReturnType<typeof withDrafts>
  today: string
  onEditCategory: (c: ServiceCategory) => void
  onAddService: (categoryId: string) => void
  onEditService: (s: ServiceCatalog) => void
}) {
  const { category, items } = group
  const title = category?.name ?? 'Uncategorized'
  return (
    <Card label={title}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-h2 font-bold">{title}</h3>
            {category && <Pill tone="accent">{LOB_NAME[category.lob]}</Pill>}
            <span className="text-small text-muted">{plural(items.length, 'service')}</span>
          </div>
          <p className="mt-0.5 text-body text-muted">
            {category ? category.description ?? 'No description.' : 'Services with no category. Edit one to put it in a category.'}
          </p>
        </div>
        {category && (
          <div className="flex flex-wrap gap-1">
            <button type="button" className={BUTTON_LINK} aria-label={`Add service to ${category.name}`} onClick={() => onAddService(category.id)}>Add service</button>
            <button type="button" className={BUTTON_LINK} aria-label={`Edit category ${category.name}`} onClick={() => onEditCategory(category)}>Edit category</button>
          </div>
        )}
      </header>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-body text-muted">No services in this category yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-body">
            <thead>
              <tr className="border-b border-line text-eyebrow font-bold uppercase tracking-[0.08em] text-muted">
                <th className="px-5 py-2 font-bold">Service</th>
                <th className="px-3 py-2 font-bold">Size</th>
                <th className="px-3 py-2 font-bold">Container</th>
                <th className="px-3 py-2 font-bold">Price unit</th>
                <th className="px-3 py-2 font-bold">Priced by</th>
                <th className="px-3 py-2 font-bold">Public</th>
                <th className="px-3 py-2 font-bold">Usage</th>
                <th className="px-5 py-2 font-bold"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const usage = serviceUsage(view, item.id)
                const scheduled = view.rateVersions.filter(rv => rv.catalogId === item.id && rv.effectiveFrom > today).length
                return (
                  <tr key={item.id} data-service={item.id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-5 py-3">
                      <span className="block font-semibold text-ink">{item.name}</span>
                      <span className="block font-mono text-mono text-muted">{item.id}</span>
                    </td>
                    <td className="px-3 py-3">{item.sizeLabel}</td>
                    <td className="px-3 py-3">{UNIT_LABEL[item.unit]}</td>
                    <td className="px-3 py-3">{unitText(view, item)}</td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {pricedByOf(item).map(d => <Pill key={d}>{dimensionLabel(view, d)}</Pill>)}
                      </div>
                    </td>
                    <td className="px-3 py-3">{item.public ? <Pill tone="success">Public</Pill> : <Pill>Private</Pill>}</td>
                    <td className="px-3 py-3 text-small text-muted">
                      <span className="block">{plural(usage.activeLines, 'active line')}</span>
                      <span className="block">{plural(usage.containers, 'container')} in inventory</span>
                      <span className="block">{plural(usage.rates, 'rate version')}{scheduled ? `, ${scheduled} scheduled` : ''}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button type="button" className={BUTTON_LINK} aria-label={`Edit ${item.name}`} onClick={() => onEditService(item)}>Edit</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
