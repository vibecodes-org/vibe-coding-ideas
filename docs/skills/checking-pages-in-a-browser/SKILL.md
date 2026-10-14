---
name: checking-pages-in-a-browser
description: How pages are opened and checked on Nick's machine: previewing local pages and mocks with Playwright, and checking the live site, phone widths included, in his own signed-in Chrome. Use whenever a step opens a page, measures a layout or takes a screenshot.
---

# Checking pages in a browser

**Local pages and mocks: Playwright** (the `browser_*` tools).
- It refuses `file://` addresses. Serve the folder first, for example `python3 -m http.server 8123 -d <folder>`, and stop the server when you're done.
- It saves screenshots only inside `.playwright-mcp/` in the current folder. Move the ones you keep, and clear that folder before any commit.

**The live site: the Claude in Chrome tools.** That's Nick's own Chrome, where he is already signed in. Playwright's browser isn't signed in, and the sign-in page has a CAPTCHA: don't try to get past it.
- The Chrome window won't shrink to phone width. For 375px, open a page on the same site, add a same-origin iframe 375px wide showing the page you need, and measure inside it (element sizes, and `scrollWidth` against `clientWidth` for sideways scrolling). Screenshot the frame.
- Before trusting what's on screen, check the element is really in the page: a card's cover image can look exactly like a live dialog.
- After a release, check the new deploy is READY before you test it: find the production deploy for the merged commit with the Vercel tools (or `vercel ls`) and check its state, then reload the page. Don't look for a deploy id in the page's script addresses: vibecodes.co.uk's carry none.
