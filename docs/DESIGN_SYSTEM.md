# Haven interface system

Reusable primitives live in `src/components`: `Button`, `Card`, `StatusPill`, `VisuallyHidden`, and `PageHeader`. CSS custom properties in `src/styles.css` are the source of truth for color, spacing, borders, and typography. Critical meaning is never color-only; care actions use text, icon, state, and confirmation together. Touch targets should be at least 44 by 44 CSS pixels, focus must remain visible, dialogs trap focus, and live regions announce synchronization state.

Feature modules live in `src/features` and are loaded by route. Validate desktop, caregiver tablet, keyboard-only, zoom, Persian RTL, reduced motion, and screen reader paths before approving a component change.
