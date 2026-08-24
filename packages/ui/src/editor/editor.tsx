'use client'

import * as React from 'react'

import {
  ButtonGroup,
  HStack,
  IconButton,
  type HTMLChakraProps,
  type RecipeProps,
  chakra,
  useRecipe,
} from '@chakra-ui/react'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from '@tiptap/markdown'
import {
  EditorContent,
  EditorContentProps,
  Editor as TipTapEditor,
  useEditor,
  useEditorState,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react'

export type EditorFormat = 'html' | 'markdown'

export interface EditorProps
  extends
    Omit<EditorContentProps, 'editor' | 'size' | keyof HTMLChakraProps<'div'>>,
    RecipeProps<'textarea'>,
    Omit<HTMLChakraProps<'div'>, 'onChange' | 'value' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  /** Called with content serialized in the selected format whenever it changes. */
  onChange?: (value: string) => void
  placeholder?: string
  editorRef?: React.Ref<TipTapEditor | null>
  format?: EditorFormat
  toolbar?: boolean
  minHeight?: HTMLChakraProps<'div'>['minHeight']
}

const editorValue = (editor: TipTapEditor, format: EditorFormat) =>
  format === 'markdown' ? editor.getMarkdown() : editor.getHTML()

const legacyRichTextPattern =
  /<\/?(?:p|h[1-6]|ul|ol|li|blockquote|pre|code|strong|em|s|br)\b[^>]*>/i

export const resolveEditorContentType = (
  content: string,
  format: EditorFormat,
) =>
  format === 'markdown' && legacyRichTextPattern.test(content) ? 'html' : format

type ToolbarButtonProps = Readonly<{
  active?: boolean
  disabled?: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}>

function ToolbarButton(props: ToolbarButtonProps) {
  return (
    <IconButton
      type="button"
      size="xs"
      variant={props.active ? 'subtle' : 'ghost'}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon}
    </IconButton>
  )
}

function EditorToolbar({ editor }: { editor: TipTapEditor | null }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive('bold'),
            italic: current.isActive('italic'),
            strike: current.isActive('strike'),
            heading1: current.isActive('heading', { level: 1 }),
            heading2: current.isActive('heading', { level: 2 }),
            bulletList: current.isActive('bulletList'),
            orderedList: current.isActive('orderedList'),
            blockquote: current.isActive('blockquote'),
            codeBlock: current.isActive('codeBlock'),
            canUndo: current.can().chain().focus().undo().run(),
            canRedo: current.can().chain().focus().redo().run(),
          }
        : null,
  })
  if (!editor || !state) return null
  return (
    <HStack
      gap="1"
      px="2"
      py="1.5"
      borderBottomWidth="1px"
      overflowX="auto"
      bg="bg.subtle"
    >
      <ButtonGroup attached>
        <ToolbarButton
          label="Bold"
          icon={<Bold />}
          active={state.bold}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          icon={<Italic />}
          active={state.italic}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="Strikethrough"
          icon={<Strikethrough />}
          active={state.strike}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
      </ButtonGroup>
      <ButtonGroup attached>
        <ToolbarButton
          label="Heading 1"
          icon={<Heading1 />}
          active={state.heading1}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
        />
        <ToolbarButton
          label="Heading 2"
          icon={<Heading2 />}
          active={state.heading2}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 2 }).run()
          }
        />
      </ButtonGroup>
      <ButtonGroup attached>
        <ToolbarButton
          label="Bulleted list"
          icon={<List />}
          active={state.bulletList}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="Numbered list"
          icon={<ListOrdered />}
          active={state.orderedList}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="Blockquote"
          icon={<Quote />}
          active={state.blockquote}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton
          label="Code block"
          icon={<Code2 />}
          active={state.codeBlock}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </ButtonGroup>
      <ButtonGroup attached ms="auto">
        <ToolbarButton
          label="Undo"
          icon={<Undo2 />}
          disabled={!state.canUndo}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="Redo"
          icon={<Redo2 />}
          disabled={!state.canRedo}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </ButtonGroup>
    </HStack>
  )
}

export const Editor = React.forwardRef<HTMLDivElement, EditorProps>(
  function Editor(props, ref) {
    const {
      defaultValue,
      onChange,
      value,
      placeholder,
      editorRef,
      format = 'html',
      toolbar = false,
      minHeight = '60px',
      ...rest
    } = props

    const onChangeRef = React.useRef(onChange)
    onChangeRef.current = onChange

    const recipe = useRecipe({
      key: 'textarea',
    })

    const [variantProps, rootProps] = recipe.splitVariantProps(rest)

    const styles = recipe(variantProps)

    const initialContent = defaultValue ?? value ?? ''
    const editor = useEditor({
      immediatelyRender: false,
      extensions: [
        StarterKit,
        Markdown,
        Placeholder.configure(placeholder === undefined ? {} : { placeholder }),
      ],
      content: initialContent,
      contentType: resolveEditorContentType(initialContent, format),
      onUpdate: ({ editor }) => {
        onChangeRef.current?.(editorValue(editor, format))
      },
    })

    React.useImperativeHandle<TipTapEditor | null, TipTapEditor | null>(
      editorRef,
      () => editor,
      [editor],
    )

    React.useEffect(() => {
      if (!editor) return

      const nextValue = value ?? ''
      if (editorValue(editor, format) === nextValue) return
      editor.commands.setContent(nextValue, {
        emitUpdate: false,
        contentType: resolveEditorContentType(nextValue, format),
      })
    }, [editor, format, value])

    const editorStyles = {
      '& .ProseMirror': {
        outline: 0,
        width: '100%',
        minHeight: minHeight,
        px: '3',
        py: '2.5',
        lineHeight: '1.7',
        wordBreak: 'break-word',
      },
      '& .ProseMirror > * + *': {
        mt: '2.5',
      },
      '& .ProseMirror ul, & .ProseMirror ol': {
        ps: '6',
      },
      '& .ProseMirror blockquote': {
        borderInlineStartWidth: '3px',
        borderColor: 'border.emphasized',
        ps: '3',
        color: 'fg.muted',
      },
      '& .ProseMirror pre': {
        bg: 'bg.muted',
        borderRadius: 'md',
        px: '3',
        py: '2',
        overflowX: 'auto',
      },
      '& .ProseMirror p.is-editor-empty:first-of-type::before': {
        color: 'muted',
        content: 'attr(data-placeholder)',
        float: 'left',
        height: 0,
        pointerEvents: 'none',
      },
      ...styles,
      p: 0,
      overflow: 'hidden',
      height: 'auto',
    }

    return (
      <chakra.div ref={ref} {...rootProps} css={editorStyles}>
        {toolbar ? <EditorToolbar editor={editor} /> : null}
        <EditorContent editor={editor} />
      </chakra.div>
    )
  },
)
