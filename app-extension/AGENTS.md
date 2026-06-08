# App Extension Instructions

- Use `app-extension/src/styles/app.css` and existing semantic class names for page-level layouts, complex components, responsive behavior, themes, and repeated UI patterns.
- Prefer the installed shadcn/Radix UI primitives and existing components in `app-extension/src/components/ui` before building custom controls. Do not hand-roll common UI behavior that the library already provides.
- Use Tailwind utilities only as a small local aid when they make simple primitives clearer, such as skeleton sizing, spacing, or one-off dimensions.
- Avoid rewriting established CSS-driven components into Tailwind-first markup without an explicit request.
- Keep visual changes consistent with the existing app-extension design system, including CSS variables from `theme.css`, 8px radii, restrained cards, and dense task-focused layouts.
