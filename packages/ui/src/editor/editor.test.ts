// @vitest-environment jsdom
import { Editor as TipTapEditor } from '@tiptap/core'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { resolveEditorContentType } from './editor'

describe('Tiptap Markdown document contract', () => {
  it('loads and serializes Brain Markdown without storing HTML', () => {
    const editor = new TipTapEditor({
      extensions: [StarterKit, Markdown],
      content: '# Company context\n\n- Shared truth\n- Current decisions',
      contentType: 'markdown',
    })

    expect(editor.getHTML()).toContain('<h1>Company context</h1>')
    expect(editor.getMarkdown()).toBe(
      '# Company context\n\n- Shared truth\n- Current decisions',
    )
    editor.destroy()
  })

  it('converts legacy HTML drafts to Markdown on the next edit', () => {
    expect(
      resolveEditorContentType(
        '<h2>Positioning</h2><p><strong>Clear</strong> and current.</p>',
        'markdown',
      ),
    ).toBe('html')

    const editor = new TipTapEditor({
      extensions: [StarterKit, Markdown],
      content: '<h2>Positioning</h2><p><strong>Clear</strong> and current.</p>',
      contentType: 'html',
    })

    expect(editor.getMarkdown()).toBe(
      '## Positioning\n\n**Clear** and current.',
    )
    editor.destroy()
  })
})
