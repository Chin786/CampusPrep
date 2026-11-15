import type { State, Item } from '../types'
export const names: Record<State, string> = {
  not_visited: 'Not visited',
  not_answered: 'Not answered',
  answered: 'Answered',
  marked: 'Marked for review',
  answered_marked: 'Answered & marked',
}
export function PaletteLegend({ items }: { items?: Item[] }) {
  return (
    <div className="legend">
      {(Object.keys(names) as State[]).map((k) => (
        <span key={k}>
          <i className={'token ' + k}>
            {items ? items.filter((q) => q.status === k).length : ''}
          </i>
          {names[k]}
        </span>
      ))}
    </div>
  )
}
