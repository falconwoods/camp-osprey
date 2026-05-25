export const EMPTY_DEBUG_LOG_MESSAGE = 'No log entries yet — waiting for next scan cycle.'

export function formatDebugLog(entries: string[]): string {
  return entries.length === 0 ? EMPTY_DEBUG_LOG_MESSAGE : entries.join('\n')
}
