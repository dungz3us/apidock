---
version: 1
slug: "packages-ui"
primary_target: "packages/ui"
related_targets: []
---

# ApiDock devtools UI (`/apidock/`)

Mode: Operate. Users: backend, frontend/mobile and QA on one team (see PRODUCT.md). Task: read an operation, compose and send a request, inspect the response, revisit history. Frequent, short loops beside an editor. Constraints: English, WCAG 2.2 AA, keyboard-first (Cmd/Ctrl+Enter sends), served under an arbitrary mount path.

## Direction contract

THESIS: The API contract reads like an IETF RFC: a numbered, citable specification you can execute. Refuses the Postman arrangement of floating cards, colored method pills and a giant URL bar.

OWN-WORLD: White sheet, near-black ink, 1px grey rules, one RFC-editor link blue for actions and selection. JetBrains Mono for every spec artifact (paths, HTTP messages, JSON, section numbers); system sans only for prose and controls. Status in ink colour (green/amber/red), never pills. REQUIRED / OPTIONAL in small caps like BCP 14.

STORY: Find the operation by section number, see exactly what it requires, fill the request in place, send, compare the answer to the contract.

FIRST VIEWPORT: RFC front-matter header (two columns: API title/version left, server/target/spec state right), table of contents rail on the left numbered by tag, the selected section on the right: request composed as a literal HTTP message with inline inputs in the request line, response below as an HTTP message.

FORM: IETF RFC document; pick card, rank 1 of the grounded list; seed f9f1c62a.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
