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
    const pages = source('./brain-pages-panel.tsx')
    expect(pages).toContain('<GridList.Root')
    expect(pages).toContain('<GridList.Item')
    expect(pages).toContain('<IconBadge')
    expect(pages).toContain('aria-current={selected')
  })

  it('keeps Tiptap central and moves page context into a rail and drawer', () => {
    const page = source('./brain-inbox-view-page.tsx')
    expect(page).toContain('<Editor')
    expect(page).toContain('as="aside"')
    expect(page).toContain('<Drawer.Root')
    expect(page).toContain('<BrainProvenanceRail')
    expect(brainRailSectionLabels).toEqual([
      'Provenance',
      'History',
      'Source',
    ])
  })
})
