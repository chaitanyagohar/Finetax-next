# Batch 9: midnight and coral theme, Geist font, motion and artwork

Code only. No database migration in this batch.

## What changes for users

- **Colours.** Midnight navy (#0f172a) with a coral accent (#f2613f) on a warm off-white background. The owner console uses near-black with an amber accent, so it is obvious when you are in the platform workspace rather than a firm.
- **Font.** Geist replaces Inter. Weights are calmer: bold and extra-bold are now semibold, and large page titles are one size smaller. Geist includes the ₹ sign, which the old Inter file did not (₹ was falling back to another font).
- **Motion.** Every button, link and input fades its colour and border smoothly (0.18s) and buttons press in slightly when clicked. Menus (notifications, profile, client picker, @mentions) pop in from where they open. Switching tabs on Tasks and Reviewer queue fades the new content in. Everyone with "reduce motion" turned on in their device settings gets no animation.
- **Artwork.** The sign-in screen has a drawn illustration (orbit rings, floating cards, a ₹ amount). The dashboard greeting and page headers have a soft coral glow with rings in the corner. Empty lists show a small drawing in place of a plain icon.
- **Wording.** Buttons and dialog titles use sentence case ("Add client", "Save changes", "Sign in" in place of "Secure Sign In").
- **Fix.** The owner's sidebar now labels the owner console entry "Firms".

## Files

| File | Status | Why |
|---|---|---|
| src/app/globals.css | MODIFIED | New colour tokens (accent, platform, background, border, text); Geist font tokens; base transitions for buttons, links and inputs; pop-in and content fade animations; hero-card glow, sidebar glow, floating and spinning decor classes |
| src/app/layout.tsx | MODIFIED | Loads Geist and Geist Mono from local files in place of Inter; browser theme colour #0f172a |
| src/fonts/geist-variable.woff2 | NEW | Geist variable font (includes ₹) |
| src/fonts/geist-mono-variable.woff2 | NEW | Geist Mono for numbers and codes |
| src/fonts/OFL-Geist.txt | NEW | Font licence (SIL Open Font License, free for commercial use) |
| src/fonts/inter-latin-variable.woff2 | DELETED | Replaced by Geist |
| src/fonts/OFL-Inter.txt | DELETED | Licence for the removed font |
| src/components/ui/Decor.tsx | NEW | SVG artwork: sign-in illustration, header corner decor, empty-state drawing |
| src/components/auth/AuthLayout.tsx | MODIFIED | Uses the sign-in illustration; headline moved to the bottom of the panel |
| src/components/layout/Sidebar.tsx | MODIFIED | Platform colours for the owner workspace, soft glow background, "Firms" label fix |
| src/components/layout/Topbar.tsx | MODIFIED | Menus pop in |
| src/components/ui/Combobox.tsx | MODIFIED | Dropdown pops in |
| src/components/chat/ChatComposer.tsx | MODIFIED | @mention list pops in |
| src/app/page.tsx | MODIFIED | Greeting card decor; calmer weights; sentence case |
| src/app/tasks/page.tsx, src/app/reviewer-queue/page.tsx | MODIFIED | Tab content fades in on switch; header glow; empty-state drawing; weights; sentence case |
| src/app/clients, invoices, quotations, leads, documents, client-discussions, time-tracking/page.tsx | MODIFIED | Header glow, empty-state drawing, weights, sentence case |
| src/app/login/page.tsx | MODIFIED | "Sign in" button text; weights |
| src/app/engagement/[token]/page.tsx, AcceptForm.tsx, src/app/api/proposals/send/route.ts, src/app/onboarding.css, src/app/setup/page.tsx | MODIFIED | Old navy #10233f replaced with the new midnight #0f172a |
| All other files listed under src/app and src/components in the zip | MODIFIED | Font weights only (bold/extra-bold → semibold, oversized titles one step smaller), plus header glow on page headers |

PDF invoice and quotation layouts are unchanged.

## Checks run

- `npx tsc --noEmit`: passed
- `npm run build`: passed
- `npx eslint src`: 0 errors (490 warnings, same as before)
- Playwright: 11 passed, 1 skipped (inbox, no mailbox on the test setup)
