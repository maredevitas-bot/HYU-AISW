import { Database } from 'lucide-react'

type DataSourceBadgeProps = {
  label: string
  tone?: 'public' | 'community' | 'manual'
}

export default function DataSourceBadge({ label, tone = 'public' }: DataSourceBadgeProps) {
  return (
    <span className={`source-badge ${tone}`}>
      <Database aria-hidden="true" size={14} strokeWidth={2.2} />
      <span>{label}</span>
    </span>
  )
}
