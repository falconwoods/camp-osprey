export type ReservePass = 'any'

export function reservePasses(): ReservePass[] {
  return ['any']
}

export function extractCampsiteName(text: string): string {
  return text.match(/Campsite\s*([A-Za-z0-9-]+)/i)?.[1] ?? '?'
}

export function extractSelectedCampsiteName(panelText: string, headerText: string): string {
  const panel = extractCampsiteName(panelText)
  if (panel !== '?') return panel
  return extractCampsiteName(headerText)
}
