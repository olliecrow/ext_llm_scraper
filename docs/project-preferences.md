# Project Preferences (Going Forward)

These preferences define how `ext_llm_scraper` should be maintained as an open-source-ready extension project.

## Quality and Scope

- Keep extraction behavior predictable and easy to test.
- Prefer small, focused changes over broad refactors.
- Keep popup UX and output format stable unless changes are intentional and documented.

## Security and Confidentiality

- Never commit secrets, credentials, tokens, API keys, or private key material.
- Never commit private or sensitive machine paths. Use placeholders like `/path/to/project` when examples are needed.
- Keep local build and runtime artifacts untracked (`dist/`, `coverage/`, temp files).

## Documentation Expectations

- Keep `README.md` aligned with real behavior and options.
- Keep quick-start and manual test guidance current when feature behavior changes.

## Verification Expectations

- Run `npm test` and `npm run build` for meaningful code changes.
- Run manual smoke checks in Chrome for popup flow and markdown output when scraping behavior changes.

## Collaboration Preferences

- Preserve accurate author and committer attribution for each contributor.
- Avoid destructive history rewrites unless needed for confidentiality remediation.

## Language and Naming

- Use plain English in chat, docs, notes, comments, reports, commit messages, issue text, and review text.
- Prefer short words, short sentences, and direct statements.
- If a technical term is needed, explain it in simple words the first time.
- In code, prefer clear descriptive names over clever or vague names.
- Rename confusing names when the change is low risk and clearly improves readability.
