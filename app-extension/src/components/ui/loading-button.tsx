import * as React from 'react'
import { Button, type ButtonProps } from './button'

export type LoadingButtonProps = ButtonProps & {
  loading?: boolean
  loadingText?: React.ReactNode
}

export const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ children, disabled, loading = false, loadingText, ...props }, ref) => (
    <Button ref={ref} disabled={disabled || loading} {...props}>
      {loading ? <span className="button-loading-spinner" aria-hidden="true" /> : null}
      {loading ? loadingText ?? children : children}
    </Button>
  ),
)
LoadingButton.displayName = 'LoadingButton'
