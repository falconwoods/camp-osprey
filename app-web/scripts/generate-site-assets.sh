#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLIC_DIR="$ROOT_DIR/public"
SOURCE_IMAGE="${1:-}"

if ! command -v sips >/dev/null 2>&1; then
  echo "Error: sips is required to generate site assets on macOS." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required to generate the favicon.ico asset." >&2
  exit 1
fi

if [[ -z "$SOURCE_IMAGE" ]]; then
  echo "Error: source image path is required." >&2
  echo "Usage: npm run generate:assets -- /path/to/source-image.png" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_IMAGE" ]]; then
  echo "Error: source image not found: $SOURCE_IMAGE" >&2
  echo "Usage: npm run generate:assets -- /path/to/source-image.png" >&2
  exit 1
fi

mkdir -p "$PUBLIC_DIR"

source_abs="$(cd "$(dirname "$SOURCE_IMAGE")" && pwd)/$(basename "$SOURCE_IMAGE")"
asset_source="$SOURCE_IMAGE"

generate_png() {
  local size="$1"
  local output="$2"
  sips -z "$size" "$size" "$asset_source" --out "$output" >/dev/null
}

generate_png 16 "$PUBLIC_DIR/favicon-16x16.png"
generate_png 32 "$PUBLIC_DIR/favicon-32x32.png"
generate_png 48 "$PUBLIC_DIR/favicon-48x48.png"
generate_png 64 "$PUBLIC_DIR/favicon-64x64.png"
generate_png 180 "$PUBLIC_DIR/apple-touch-icon.png"
generate_png 192 "$PUBLIC_DIR/icon-192.png"
generate_png 512 "$PUBLIC_DIR/icon-512.png"

node --input-type=module - "$PUBLIC_DIR" <<'NODE'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const publicDir = process.argv[2]
const specs = [
  ['favicon-16x16.png', 16],
  ['favicon-32x32.png', 32],
  ['favicon-48x48.png', 48],
  ['favicon-64x64.png', 64],
]

const images = []
for (const [fileName, size] of specs) {
  const data = await readFile(join(publicDir, fileName))
  images.push({ size, data })
}

const headerSize = 6
const dirEntrySize = 16
let offset = headerSize + dirEntrySize * images.length
const dir = Buffer.alloc(headerSize + dirEntrySize * images.length)
dir.writeUInt16LE(0, 0)
dir.writeUInt16LE(1, 2)
dir.writeUInt16LE(images.length, 4)

const blobs = []
images.forEach((image, index) => {
  const { size, data } = image
  const entryOffset = headerSize + index * dirEntrySize
  dir.writeUInt8(size === 256 ? 0 : size, entryOffset + 0)
  dir.writeUInt8(size === 256 ? 0 : size, entryOffset + 1)
  dir.writeUInt8(0, entryOffset + 2)
  dir.writeUInt8(0, entryOffset + 3)
  dir.writeUInt16LE(1, entryOffset + 4)
  dir.writeUInt16LE(32, entryOffset + 6)
  dir.writeUInt32LE(data.length, entryOffset + 8)
  dir.writeUInt32LE(offset, entryOffset + 12)
  blobs.push(data)
  offset += data.length
})

await writeFile(join(publicDir, 'favicon.ico'), Buffer.concat([dir, ...blobs]))
NODE

tmp_og="$(mktemp "${TMPDIR:-/tmp}/campsoon-og.XXXXXX.png")"
cp "$asset_source" "$tmp_og"

# Build a 1200x630 Open Graph image. The default crop is tuned for the current
# CampSoon source artwork; override OG_CROP_OFFSET_Y if future art needs it.
og_crop_offset_y="${OG_CROP_OFFSET_Y:-170}"
sips --resampleWidth 1200 "$tmp_og" >/dev/null
sips --cropToHeightWidth 630 1200 --cropOffset "$og_crop_offset_y" 0 "$tmp_og" >/dev/null
sips -s format jpeg -s formatOptions 85 "$tmp_og" --out "$PUBLIC_DIR/og-image.jpg" >/dev/null
rm -f "$tmp_og"

cat > "$PUBLIC_DIR/manifest.webmanifest" <<'JSON'
{
  "name": "CampSoon",
  "short_name": "CampSoon",
  "description": "Campsite availability monitoring and alerts.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#ffffff",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
JSON

echo "Generated site assets from $source_abs:"
echo "  public/favicon.ico"
echo "  public/favicon-16x16.png"
echo "  public/favicon-32x32.png"
echo "  public/favicon-48x48.png"
echo "  public/favicon-64x64.png"
echo "  public/apple-touch-icon.png"
echo "  public/icon-192.png"
echo "  public/icon-512.png"
echo "  public/og-image.jpg"
echo "  public/manifest.webmanifest"
