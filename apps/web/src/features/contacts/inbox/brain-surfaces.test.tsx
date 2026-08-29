import { SuiProvider } from '@saas-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { system } from '#theme/preset'

import { BrainPagesPanel } from './brain-pages-panel'
import { BrainEvidenceProvenanceRail } from './brain-evidence-provenance-rail'
import { BrainProvenanceRail } from './brain-provenance-rail'
import { brainEvidenceRouteId } from './brain-inbox-adapter'

vi.mock('#features/common/hooks/use-current-workspace', () => ({
  useCurrentWorkspace: () => [{ id: 'workspace-1', slug: 'agency' }],
}))
vi.mock('@convex-dev/react-query', () => ({ useConvexQuery: () => [] }))
vi.mock('#lib/auth/route-auth', () => ({
  isFixtureAuthRuntime: () => true,
  isIsolatedContractsRuntime: () => false,
}))

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<SuiProvider value={system}>{node}</SuiProvider>)

describe('Brain workspace surfaces', () => {
  it('renders page navigation for every supported source kind', () => {
    const html = render(
      <BrainPagesPanel
        activePageId="page-markdown"
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        evidence={[
          {
            entryKey: 'slack:C01:message:1',
            sourceKey: 'slack:C01:message:1',
            revisionKey: '1',
            provider: 'slack',
            title: 'Slack · #company-context · U01',
            excerpt: 'Approved positioning',
            sourceModifiedAt: 1_782_924_800_000,
            observedAt: 1_782_924_800_000,
          },
        ]}
        rows={[
          {
            depth: 0,
            page: {
              _id: 'page-markdown',
              favorite: true,
              sourceKind: 'markdown',
              title: 'Company overview',
              updatedAt: 1_782_924_800_000,
            },
          },
          {
            depth: 1,
            page: {
              _id: 'page-note',
              sourceKind: 'note',
              title: 'ICP notes',
              updatedAt: 1_782_924_800_000,
            },
          },
          {
            depth: 0,
            page: {
              _id: 'page-link',
              sourceKind: 'link',
              title: 'Source link',
              updatedAt: 1_782_924_800_000,
            },
          },
        ]}
      />,
    )

    expect(html).toContain('3 pages · 1 synced sources')
    expect(html).toContain('Company overview')
    expect(html).toContain('ICP notes')
    expect(html).toContain('Source link')
    expect(html).toContain('Synced sources')
    expect(html).toContain('Slack · #company-context · U01')
  })

  it('renders provenance, revision history, and source context', () => {
    const html = render(
      <BrainProvenanceRail
        page={{
          _id: 'page-1',
          sourceKind: 'markdown',
          updatedAt: 1_782_924_800_000,
        }}
        revisions={[
          {
            _id: 'revision-1',
            causation: 'manual edit',
            title: 'Company overview',
            updatedAt: 1_782_924_800_000,
          },
        ]}
      />,
    )

    expect(html).toContain('Page context')
    expect(html).toContain('Current revision')
    expect(html).toContain('manual edit')
    expect(html).toContain('markdown')
  })

  it('renders the empty synced-source state', () => {
    const html = render(
      <BrainPagesPanel
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        evidence={[]}
        rows={[]}
      />,
    )

    expect(html).toContain('No synced sources yet')
    expect(html).toContain('Connect Slack')
    expect(html).toContain('Connect Drive')
    expect(html).not.toContain('HubSpot')
  })

  it('selects non-Slack evidence and renders optional provenance', () => {
    const entryKey = 'google-drive:file:1:revision:2'
    const panel = render(
      <BrainPagesPanel
        activePageId={brainEvidenceRouteId(entryKey)}
        onCreate={vi.fn()}
        onSelect={vi.fn()}
        evidence={[
          {
            entryKey,
            sourceKey: 'google-drive:file:1',
            revisionKey: '2',
            provider: 'google_drive',
            title: 'Drive · ICP document',
            excerpt: 'Ideal customer profile',
            sourceModifiedAt: 1_782_924_800_000,
            observedAt: 1_782_924_800_000,
          },
        ]}
        rows={[]}
      />,
    )
    const provenance = render(
      <BrainEvidenceProvenanceRail
        evidence={{
          sourceKey: 'google-drive:file:1',
          revisionKey: '2',
          provider: 'google_drive',
          scopeKey: 'google-drive:apero',
          title: 'Drive · ICP document',
          markdown: '# ICP',
          sourceModifiedAt: 1_782_924_800_000,
          observedAt: 1_782_924_800_000,
          tombstone: false,
        }}
      />,
    )

    expect(panel).toContain('aria-current="page"')
    expect(panel).toContain('google drive')
    expect(provenance).toContain('Synced source')
    expect(provenance).not.toContain('Open original source')
  })

  it('links synced evidence back to its original source', () => {
    const html = render(
      <BrainEvidenceProvenanceRail
        evidence={{
          sourceKey: 'slack:C01:message:1',
          revisionKey: '1',
          provider: 'slack',
          scopeKey: 'slack:apero',
          title: 'Slack evidence',
          markdown: 'Approved positioning',
          locator: 'https://app.slack.com/client/T01/C01/thread-1',
          sourceModifiedAt: 1_782_924_800_000,
          observedAt: 1_782_924_800_000,
          tombstone: false,
        }}
      />,
    )

    expect(html).toContain('Open original source')
    expect(html).toContain('https://app.slack.com/client/T01/C01/thread-1')
  })
})
