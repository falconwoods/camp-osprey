import { type ReactNode } from 'react'
import { ArrowRight, CircleX, Info, TriangleAlert } from 'lucide-react'

export type AppAlertVariant = 'info' | 'warning' | 'error'

export interface AppAlertProps {
  variant: AppAlertVariant
  title: string
  message: ReactNode
  action?: {
    label: string
    onClick: () => void
  }
}

export function AppAlert({ variant, title, message, action }: AppAlertProps) {
  const Icon = variant === 'info' ? Info : variant === 'warning' ? TriangleAlert : CircleX

  return (
    <div className={`app-alert app-alert-${variant}`} role={variant === 'info' ? 'status' : 'alert'}>
      <div className="app-alert-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={2.3} />
      </div>
      <div className="app-alert-copy">
        <strong>{title}</strong>
        <div className="app-alert-message">{message}</div>
      </div>
      {action ? (
        <button className="app-alert-action" type="button" onClick={action.onClick}>
          {action.label}
          <ArrowRight size={14} strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  )
}
