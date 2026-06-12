import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/button'

type ConfirmDialogVariant = 'default' | 'destructive'

export interface ConfirmDialogOptions {
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string | null
  variant?: ConfirmDialogVariant
}

interface PendingDialog extends Required<Pick<ConfirmDialogOptions, 'title' | 'message' | 'variant'>> {
  confirmLabel: string
  cancelLabel: string | null
  resolve: (confirmed: boolean) => void
}

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingDialog | null>(null)

  function confirm(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise(resolve => {
      setPending({
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? 'Continue',
        cancelLabel: options.cancelLabel === undefined ? 'Cancel' : options.cancelLabel,
        variant: options.variant ?? 'default',
        resolve,
      })
    })
  }

  function close(confirmed: boolean) {
    if (!pending) return
    pending.resolve(confirmed)
    setPending(null)
  }

  const dialog = pending ? (
    <ConfirmDialog
      open
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      variant={pending.variant}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  ) : null

  return { confirm, dialog }
}

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant,
  onCancel,
  onConfirm,
}: ConfirmDialogOptions & {
  open: boolean
  confirmLabel: string
  variant: ConfirmDialogVariant
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const messageId = useId()
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return undefined
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previousActiveElement?.focus()
    }
  }, [onCancel, open])

  if (!open) return null

  return (
    <div className="confirm-dialog-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onCancel()
    }}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
        <button className="confirm-dialog-close" type="button" aria-label="Close dialog" onClick={onCancel}>
          <X size={17} />
        </button>
        <div className="confirm-dialog-content">
          <h2 id={titleId}>{title}</h2>
          <div id={messageId} className="confirm-dialog-message">{message}</div>
          <div className="confirm-dialog-actions">
            {cancelLabel ? <Button variant="secondary" type="button" onClick={onCancel}>{cancelLabel}</Button> : null}
            <Button
              ref={confirmButtonRef}
              variant={variant === 'destructive' ? 'destructive' : 'default'}
              type="button"
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
