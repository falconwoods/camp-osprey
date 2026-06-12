# Campsoon App Extension

This is the current Chrome extension frontend implementation. The legacy `../extension` package is deprecated for routine frontend work.

## Common Commands

Run these commands from this directory:

```bash
cd /Users/eric/Workplace/campsoon/app-extension
```

Development build:

```bash
npm run dev
```

This is the normal local development mode. It is not obfuscated and is intended for debugging.

Production build without obfuscation:

```bash
npm run build:production
```

Use this only when you need a normal production build for debugging. Do not use this output for offline distribution.

## Testing The Obfuscated Extension Locally

To generate the obfuscated unpacked extension:

```bash
npm run build:secure
```

The obfuscated unpacked directory is:

```text
/Users/eric/Workplace/campsoon/app-extension/.output/chrome-mv3
```

To test it in Chrome:

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click Load unpacked
4. Select `/Users/eric/Workplace/campsoon/app-extension/.output/chrome-mv3`

Important: running `npm run build`, `npm run build:production`, or `npm run zip` can overwrite `.output/chrome-mv3` with a normal non-obfuscated build. Run `npm run build:secure` again before testing the protected version.

## Offline Distribution

To build and package the obfuscated extension for offline distribution:

```bash
npm run zip:secure
```

This command runs the full secure release flow:

```text
1. Clean the old .output/chrome-mv3 directory
2. Build the production extension
3. Obfuscate the JavaScript output
4. Zip the obfuscated .output/chrome-mv3 directory
```

The generated secure zip file is:

```text
/Users/eric/Workplace/campsoon/app-extension/.output/campsoon-app-extension-0.1.0-chrome-secure.zip
```

Do not use `npm run zip` for offline distribution. `npm run zip` rebuilds a normal non-obfuscated package.

## Website Channel Distribution

For the website channel secure package:

```bash
npm run zip:website:secure
```

This uses the same secure packaging flow, but builds with `VITE_EXTENSION_CHANNEL=website`.

## Security Notes

Chrome extension frontend code cannot be truly encrypted because Chrome must be able to execute it. The secure build increases reverse-engineering and modification cost by obfuscating JavaScript and removing source maps.

Critical protection should still live on the server side, including auth checks, payment or points checks, remote configuration, and any sensitive business logic or secrets.
