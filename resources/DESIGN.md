# Design guide

Every AI in Caret Agent reads this file before it builds any interface.
Edit it to match your taste — the AI follows what is written here.

## The goal

Interfaces should look like a careful person designed them for one specific
product, not like a template. If a screen could belong to any startup, it is
not done.

## Never do this (the "AI look")

- Purple-to-blue or pink-to-orange gradients on backgrounds, buttons or text.
- Gradient text on headings.
- Glassmorphism, frosted cards and glowing blurred blobs behind content.
- Emoji used as icons or bullet points.
- Every section centred, every card the same size, three-column "feature grid"
  with an icon, a bold title and one line of grey text.
- Huge hero with a vague slogan ("Unlock your potential") and two buttons.
- Drop shadows on everything, or large soft shadows that float cards.
- Rounded corners above 12px on cards and above 8px on buttons.
- Placeholder copy: "Lorem ipsum", "Feature one", "Amazing", "Seamless",
  "Revolutionary", "Empower", "Elevate".
- More than one accent colour fighting for attention.
- Decorative animations that run forever.

## Colour

- Start from neutrals. Pick one background, one surface (slightly lighter or
  darker), one border colour and two text colours (primary and muted).
- Add exactly one accent colour, used only for the main action, links,
  focus rings and the current selection. Everything else stays neutral.
- Status colours (success, warning, danger) appear only when they carry
  meaning, never as decoration.
- Check contrast: body text at least 4.5:1 against its background, large text
  and icons at least 3:1.
- Define colours once as CSS variables on `:root` and support dark mode with
  `@media (prefers-color-scheme: dark)`. Never hard-code a colour twice.

Example neutral set (light):

```css
:root {
  --bg: #fbfbfa; --surface: #ffffff; --border: #e6e4df;
  --text: #1d1c1a; --muted: #6b6862; --accent: #2f6fdb;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --surface: #1e1e1c; --border: #2e2d2a;
          --text: #ecebe8; --muted: #9b988f; --accent: #6d9cf0; }
}
```

## Type

- One typeface family for the interface (system UI stack is fine), one
  monospace for code and numbers.
- A small, deliberate scale: 12, 13/14 body, 16, 20, 28. Do not invent sizes.
- Headings are short and specific. Body line length 60–75 characters.
- Use weight (500/600) and colour for hierarchy before size.

## Layout and spacing

- 4px spacing grid: 4, 8, 12, 16, 24, 32, 48. Nothing else.
- Left-align text and content by default. Centre only short, standalone items.
- Group related things tightly, separate groups clearly. Spacing does the work
  that borders and boxes usually do.
- Content decides the layout: a table for tabular data, a list for lists, a
  form for input. Do not force everything into cards.
- Work at 360px wide (phones) up to wide desktops. No horizontal scrolling.

## Components

- Buttons: one primary per view, the rest secondary or plain text.
  Clear verb labels ("Save changes", not "Submit").
- Every interactive element has visible hover, focus (keyboard) and disabled
  states.
- Empty states say what is missing and give the one action that fixes it.
- Icons: a single consistent line-icon style (SVG), 16–20px, never mixed sets.

## Every HTML page must have

- `<!doctype html>`, `<html lang="…">`, `<meta charset="utf-8">` and
  `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- A real `<title>`.
- A logo: an inline SVG favicon in `<head>`
  (`<link rel="icon" href="data:image/svg+xml,…">`) and the same mark shown
  in the page header. Design a simple mark for the product — a letter or
  shape in the accent colour — not an emoji.
- Semantic structure: `header`, `main`, `nav`, `footer`, real `button`s and
  `label`s for inputs.

## Before you finish

Look at the result as a stranger would. Remove anything that is only there to
look "designed". If two things compete for attention, quiet one of them.
