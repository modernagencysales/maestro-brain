import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { brainRailSectionLabels } from './brain-provenance-rail'

const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Brain workspace visual structure', () => {
  it('keeps the pinned Pro resizable and responsive SplitPage composition', () => {
    const layout = source('./inbox-layout.tsx')
    expect(layout).toContain('<SplitPage')
    expect(layout).toContain('<Resizer')
    expect(layout).toContain('<ResizeHandle')
    expect(layout).toContain('breakpoint="lg"')
    expect(layout).toContain('enabled={isMobile === false}')
  })

  it('uses the FilesListCard row hierarchy for the Brain page tree', () => {
    const layout = source('./inbox-layout.tsx')
    const pages = source('./brain-pages-panel.tsx')
    expect(layout).toContain('<BrainPagesPanel')
    expect(layout).not.toContain('rows.length > 0')
    expect(pages).toContain('<GridList.Root')
    expect(pages).toContain('<GridList.Item')
    expect(pages).toContain('<IconBadge')
    expect(pages).toContain('aria-current={selected')
    expect(pages).toContain('Synced sources')
  })

  it('fills an empty Brain detail pane with actionable onboarding', () => {
    const onboarding = source('./brain-onboarding-empty-state.tsx')
    expect(onboarding).toContain('Connect Slack')
    expect(onboarding).toContain('Connect Drive')
    expect(onboarding).toContain('Create Brain page')
    expect(onboarding).toContain('Connect Terminal &amp; MCP')
  })

  it('keeps Tiptap central and moves page context into a rail and drawer', () => {
    const page = source('./brain-inbox-view-page.tsx')
    expect(page).toContain('<Editor')
    expect(page).toContain('as="aside"')
    expect(page).toContain('<Drawer.Root')
    expect(page).toContain('<BrainProvenanceRail')
    expect(page).toContain('<BrainEvidenceProvenanceRail')
    expect(brainRailSectionLabels).toEqual([
      'Provenance',
      'History',
      'Source',
    ])
  })

  it('keeps knowledge review bounded and supports editing and bulk rejection', () => {
    const review = source('./brain-knowledge-review-dialog.tsx')
    expect(review).toContain('limit: 5')
    expect(review).toContain("'edit_and_accept'")
    expect(review).toContain('Reject visible candidates')
    expect(review).toContain('candidate.evidence[0]?.quote')
  })
})
