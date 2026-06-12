# Project Instructions

- `app-extension/` is the current Chrome extension frontend implementation.
- `extension/` is legacy and deprecated. Do not add features or make routine frontend changes there unless explicitly requested.
- Prefer changes that follow the existing app-extension architecture and styling conventions.
- When changing database tables, update the Drizzle schema only. Do not hand-write SQL migration files; the user will run the generate command to create migration SQL.
