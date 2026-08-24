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

    expect(editor.getMarkdown()).toBe(
      '# Company context\n\n- Shared truth\n- Current decisions',
    )
    editor.destroy()
  })

  it('detects legacy HTML drafts for one-time import', () => {
    expect(
      resolveEditorContentType(
        '<h2>Positioning</h2><p><strong>Clear</strong> and current.</p>',
        'markdown',
      ),
    ).toBe('html')

    expect(resolveEditorContentType('# Positioning', 'markdown')).toBe(
      'markdown',
    )
  })
})
