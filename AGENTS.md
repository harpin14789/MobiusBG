<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project context

Read [PROJECT_HANDOFF.md](PROJECT_HANDOFF.md) for the product workflows, roles, setup, deployment, and links to detailed documentation before making project changes.

## Shared development handoff

For every development change, update `CHANGELOG.md` with a concise description of the change and update `PROJECT_HANDOFF.md` to reflect any changes to current functionality, workflows, architecture, setup, deployment, tests, known limitations, or outstanding work. If the current-state handoff does not need a substantive change, add a brief entry to its recent development handoff section instead. Keep the handoff accurate and remove or revise stale statements. Record verification performed and any remaining deployment or follow-up steps when relevant. Never add credentials, secrets, or private member data. Include these documentation updates in the same commit or pull request as the development work whenever possible.
