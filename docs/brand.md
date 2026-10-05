# Gravity identity

Gravity uses an orbital G with a central core. The band suggests continuity;
the core represents the relationship and its context. The identity belongs
to the same blue family as Orbit, without reusing Orbit's symbol or a generic
sparkle icon.

## Files

- `packages/brand/identity.ts`: shared orbital G geometry and color constants.
- `public/brand/gravity-mark.svg` and `gravity-mark-dark.svg`: scalable marks, transparent background.
- `public/brand/gravity-wordmark.svg`: mark and dark wordmark for light backgrounds.
- `public/brand/gravity-wordmark-dark.svg`: light wordmark for dark backgrounds.
- `public/brand/gravity-social.png`: 1200×630 share artwork exported from the native image route.
- `public/brand/gravity-concept.png`: original generated artwork, transparent background.
- `src/components/gravity-logo.tsx`: native inline vector used throughout the UI.
- `src/app/icon.svg`: adaptive browser icon with light/dark support.
- `src/app/favicon.ico`: 16/32/48/64px transparent fallback icon.
- `src/app/apple-icon.tsx`: 180px Apple touch icon.
- `public/brand/gravity-app-192.png` and `gravity-app-512.png`: manifest icons.
- `src/app/manifest.ts`: app name, action-queue start URL and icon metadata.
- `src/app/opengraph-image.tsx`: 1200×630 share image, rendered as PNG. Use
  the deployed `/opengraph-image` endpoint to download artwork for repository
  social previews. The public site inherits this image through Next metadata.

Use the native vector in applications, documentation and small icons. Keep at
least a quarter of the mark's width clear on every side. Use a minimum interface
size of 20px; the dedicated favicon export also includes a 16px rendition. Never stretch, rotate, add shadows or enclose it in another symbol.
The wordmark exports use Arial/Helvetica fallbacks; the app uses its existing
system font stack. No external font request or new runtime dependency is needed.

## Color and interface

Use Orbit's existing theme tokens: `#4d57bd` for the light accent and `#7b83eb`
for the dark accent. Dark export artwork uses a lighter blue for contrast.
The mark inherits the active accent in the application. Phone/home-screen icons use a white mark on the blue app tile, with clear padding. Neutral surfaces,
thin borders and generous spacing do the rest; blue indicates primary actions.
Authentication, onboarding, the workspace and public pages share the same mark.

## Generation record

The original concept was generated with the built-in imagegen tool. The final
application logo is a deterministic native SVG interpretation of that concept,
so it remains crisp without shipping a large bitmap for every UI icon.

Prompt: "Create a single professional logo symbol for Gravity, an open-source
CRM by Noveum. Icon only, no words, no lettering, no mockup. Minimal Swiss
geometric identity: an abstract gravitational orbit forming a strong, nearly
circular G-shaped blue band, clean flat vector-style curves, one purposeful
opening on the upper right and a small solid central blue core. Architectural,
precise, serious enterprise software aesthetic, inspired by orbital mechanics.
Royal blue #4968ee and deep cobalt #2544c8, prefer a single uniform royal blue
color; no gradients, no shadows, no tiny dots or fine strokes. Centered isolated
mark filling about 78 percent of a square canvas. Actual transparent background.
Visually balanced, recognizable silhouette at 24px. No mascot, sparkle, stars,
emoji, planet illustration, Saturn rings, glossy 3D, or purple."

These assets ship with this repository's Apache 2.0 license. This design work
does not establish trademark clearance or reserve a registered name.

## Asset regeneration

Run `bun run brand:generate` with the pinned dependencies to regenerate the adaptive SVG, standalone light/dark marks, multi-size ICO and app PNGs from the shared geometry. Apple/social image routes use the same React mark. No extra runtime image or font dependency is required.
