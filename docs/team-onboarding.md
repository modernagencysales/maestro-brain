# Team onboarding

Everyone uses the live **Apero Company Brain** workspace (`apero`) at
`https://maestro-brain-staging.tim-bb0.workers.dev/apero/inbox`. A workspace
admin first opens `Settings -> Members` in the web app and invites each
teammate. The teammate receives the invitation email when outbound email is
configured. The app also copies each new invitation link so the admin can send
it directly. The teammate logs in with the invited email, accepts the
invitation, and then links a terminal.

## Connect a terminal

Requires Node 22. Run these commands from the project where the agent will work:

```bash
npm install --global https://github.com/modernagencysales/maestro-brain/releases/download/brain-cli-v0.1.6/maestro-brain.tgz
maestro-brain setup
maestro-brain doctor
maestro-brain run -- codex
```

For setup without a global install, the web app's `Terminal & MCP` settings
screen copies this equivalent one-command path:

```bash
npx --yes https://github.com/modernagencysales/maestro-brain/releases/download/brain-cli-v0.1.6/maestro-brain.tgz setup
```

`setup` opens the staging app, asks the teammate to choose **Apero Company
Brain**, and links an individual 90-day credential. It writes key-free project
descriptors for Codex, Claude Code, Claude Cowork, HTTP MCP, and the Ask Apero
skill. These descriptors are safe to review and share with that project; the
credential itself stays outside Git in the user's local Maestro Brain config.
Setup merges supported shared config files and upgrades older CLI-managed Ask
Apero skills without overwriting an unrecognized custom skill. If no browser
opens, copy the fallback URL printed in the terminal. Restart the agent after
setup so it loads the new configuration.

The linked API key stays in the user's local Maestro Brain config; it is not
committed to the repository. `maestro-brain run -- codex` (or `-- claude`)
injects it only into the launched agent process. Users who prefer to start their
agent normally can instead run `eval "$(maestro-brain env)"` once in that shell.

## Confirm it works

```bash
maestro-brain status
maestro-brain ask "What is our ICP?"
maestro-brain evidence search "What is our ICP?"
maestro-brain evidence health
maestro-brain page list
```

For evidence-sensitive work, reopen a search result before citing it:

```bash
maestro-brain evidence open <source-key> --revision <revision-key>
```

`evidence source-get <source-key> <revision-key>` remains available for older
scripts.

These evidence commands use the same read-only HTTP MCP surface available to
Codex, Claude Code, and Cowork. Search results are candidates; the exact source
revision is the citation authority. Health reports bounded facts about provider
evidence and connector runs; it does not claim that the available company
context is complete or ready.

Claude Cowork users can add the generated `.cowork/maestro-brain.json`
descriptor through Cowork's connector UI if it is not discovered automatically.

## Add company context

Create one Markdown file or import a directory of Markdown files:

```bash
maestro-brain page create ./company-context/icp.md --slug icp --title "ICP"
maestro-brain import ./company-context
```

Pages are immediately available to the web Brain, CLI, Ask Apero, and HTTP MCP
inside the linked workspace. Connected Slack channels and Drive documents are
ingested as cited Brain evidence; provider structures do not become Page
folders.

The workspace knowledge owner can turn current evidence into reviewed company
truth entirely from the terminal:

```bash
maestro-brain knowledge extract --limit 10
maestro-brain knowledge candidates --state unreviewed --limit 5
maestro-brain knowledge review <candidate-key> --accept --expected-revision 0
```

Use `--body "edited claim"` with `--accept` to edit before acceptance, or use
`--review-horizon-days 180` to change the default 90-day recheck. Use
`--reject --reason "not durable company context"` to reject. The CLI generates a
stable idempotency key unless one is supplied explicitly. Extraction is bounded
and asynchronous, so list candidates again after scheduled jobs finish.

Directory import is safe to repeat. Each relative Markdown path maps to a stable
page slug and persisted CLI-import identity: new files are created, changed
files update only their owned page with an optimistic revision check, and
unchanged files are skipped. Manual, archived, or duplicate page collisions fail
before any import writes. The command reports `created`, `updated`, and
`unchanged` counts. If another user edits or creates the page during the import,
the backend rejects the conflicting write; rerun the same command to resume from
the current workspace state. Removing a local file does not archive its Brain
page, so use the web app for intentional archival.

If this folder was previously imported with CLI `0.1.1`, inspect the conflicting
pages in the web app once, then attach the new provenance identity explicitly:

```bash
maestro-brain import ./company-context --adopt-existing
```

Adoption works only for an active, currently unowned page with the same slug and
is revision-fenced. Normal imports never adopt existing pages.

## Report or fix a bug

Install the GitHub CLI and authenticate once before cloning:

```bash
gh auth login
maestro-brain bug-bundle --output maestro-brain-bug.json
```

Teammates with write access to the repository can use the direct path:

```bash
gh repo clone modernagencysales/maestro-brain
cd maestro-brain
node scripts/maestro-bootstrap.mjs
corepack pnpm@10.12.1 install --frozen-lockfile
git switch -c fix/short-description
git push -u origin fix/short-description
gh pr create --base main
```

Teammates without write access should fork first:

```bash
gh repo fork modernagencysales/maestro-brain --clone
cd maestro-brain
node scripts/maestro-bootstrap.mjs
corepack pnpm@10.12.1 install --frozen-lockfile
git switch -c fix/short-description
git push -u origin fix/short-description
gh pr create \
  --repo modernagencysales/maestro-brain \
  --base main \
  --head YOUR_GITHUB_LOGIN:fix/short-description
```

The bug bundle is allowlisted and omits the API key. Attach it to an issue, or
make the change and run the focused tests plus `pnpm acceptance:required` before
pushing. Use a full clone; shallow clones do not contain the ancestry needed by
the acceptance gate.

To open an issue directly from the terminal:

```bash
gh issue create --repo modernagencysales/maestro-brain \
  --title "bug: short description" \
  --body-file maestro-brain-bug.json
```
