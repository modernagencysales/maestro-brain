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
npm install --global https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz
maestro-brain setup
maestro-brain doctor
maestro-brain run -- codex
```

For setup without a global install, the web app's `Terminal & MCP` settings
screen copies this equivalent one-command path:

```bash
npx --yes https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz setup
```

`setup` opens the staging app, asks the teammate to choose **Apero Company
Brain**, and links an individual 90-day credential. It writes key-free local
project descriptors for Codex, Claude Code, Claude Cowork, HTTP MCP, and the Ask
Apero skill. Repository policy intentionally keeps those generated runtime files
out of Git; setup verifies or merges them in each teammate's chosen project and
stores the credential outside Git. If no browser opens, copy the fallback URL
printed in the terminal. Restart the agent after setup so it loads the new
configuration.

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
maestro-brain evidence source-get <source-key> <revision-key>
```

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
inside the linked workspace. Connected Slack channels are ingested from the web
app's Slack integration and appear as Brain pages with source provenance.

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
pnpm install --frozen-lockfile
git switch -c fix/short-description
git push -u origin fix/short-description
gh pr create --base main
```

Teammates without write access should fork first:

```bash
gh repo fork modernagencysales/maestro-brain --clone
cd maestro-brain
pnpm install --frozen-lockfile
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
