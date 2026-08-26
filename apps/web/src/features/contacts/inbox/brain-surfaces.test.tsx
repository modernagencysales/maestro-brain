import { SuiProvider } from '@saas-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { system } from '#theme/preset'

import { BrainPagesPanel } from './brain-pages-panel'
import { BrainProvenanceRail } from './brain-provenance-rail'

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<SuiProvider value={system}>{node}</SuiProvider>)

describe('Brain workspace surfaces', () => {
  it('renders page navigation for every supported source kind', () => {
    const html = render(
      <BrainPagesPanel
        activePageId="page-markdown"
        onCreate={vi.fn()}
        onSelect={vi.fn()}
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

    expect(html).toContain('3 company context pages')
    expect(html).toContain('Company overview')
    expect(html).toContain('ICP notes')
    expect(html).toContain('Source link')
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
})
