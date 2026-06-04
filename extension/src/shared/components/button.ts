type ButtonVariant = 'primary' | 'secondary' | 'danger'

type ButtonHTMLInput = {
  id?: string
  label: string
  variant?: ButtonVariant
  className?: string
  type?: 'button' | 'submit' | 'reset'
  loadingLabel?: string
  disabled?: boolean
  attributes?: Record<string, string | number | boolean | null | undefined>
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] ?? char))
}

function attributesHTML(attributes: ButtonHTMLInput['attributes'] = {}): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([name, value]) => value === true ? ` ${escapeHtml(name)}` : ` ${escapeHtml(name)}="${escapeHtml(String(value))}"`)
    .join('')
}

export function buttonHTML(input: ButtonHTMLInput): string {
  const variant = input.variant ?? 'primary'
  const classes = [`btn-${variant}`, input.className].filter(Boolean).join(' ')
  return `<button${input.id ? ` id="${escapeHtml(input.id)}"` : ''} class="${escapeHtml(classes)}" type="${input.type ?? 'button'}"${input.disabled ? ' disabled' : ''}${input.loadingLabel ? ` data-loading-label="${escapeHtml(input.loadingLabel)}"` : ''}${attributesHTML(input.attributes)}>${escapeHtml(input.label)}</button>`
}

export function setButtonLoading(button: HTMLButtonElement, loading: boolean, loadingLabel?: string): void {
  if (loading) {
    if (!button.dataset['idleHtml']) button.dataset['idleHtml'] = button.innerHTML
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    button.dataset['loading'] = 'true'
    const label = loadingLabel ?? button.dataset['loadingLabel'] ?? 'Loading...'
    button.innerHTML = `<span class="button-loading-spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span>`
    return
  }

  button.disabled = false
  button.removeAttribute('aria-busy')
  delete button.dataset['loading']
  if (button.dataset['idleHtml']) {
    button.innerHTML = button.dataset['idleHtml']
    delete button.dataset['idleHtml']
  }
}

export async function withButtonLoading<T>(
  button: HTMLButtonElement,
  loadingLabel: string,
  action: () => Promise<T>,
): Promise<T | undefined> {
  if (button.disabled || button.dataset['loading'] === 'true') return undefined
  setButtonLoading(button, true, loadingLabel)
  try {
    return await action()
  } finally {
    setButtonLoading(button, false)
  }
}

export function bindAsyncButton<T>(
  button: HTMLButtonElement,
  loadingLabel: string,
  action: () => Promise<T>,
): void {
  button.dataset['loadingLabel'] = loadingLabel
  button.addEventListener('click', () => {
    void withButtonLoading(button, loadingLabel, action)
  })
}
