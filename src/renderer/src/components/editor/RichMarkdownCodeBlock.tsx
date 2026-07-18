import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeViewContent, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { Copy, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import MermaidBlock from './MermaidBlock'
import { translate } from '@/i18n/i18n'

/**
 * Common languages shown in the selector. The user can also type a language
 * name directly in the markdown fence (```rust) and it will be preserved —
 * this list is just for quick picking in the UI.
 */
const LANGUAGES = [
  {
    value: '',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.13822cdfda', 'Plain text')
    }
  },
  {
    value: 'bash',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.4227cf50fe', 'Bash')
    }
  },
  { value: 'c', label: 'C' },
  {
    value: 'cpp',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.4daed43ae3', 'C++')
    }
  },
  {
    value: 'css',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.026653f21f', 'CSS')
    }
  },
  {
    value: 'diff',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.bf6ee5caaa', 'Diff')
    }
  },
  {
    value: 'go',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.edfcc64182', 'Go')
    }
  },
  {
    value: 'graphql',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.706fd85738', 'GraphQL')
    }
  },
  {
    value: 'html',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.8c4a3fa02d', 'HTML')
    }
  },
  {
    value: 'java',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.36536ad539', 'Java')
    }
  },
  {
    value: 'javascript',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.a209c57063', 'JavaScript')
    }
  },
  {
    value: 'json',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.78eba32de4', 'JSON')
    }
  },
  {
    value: 'kotlin',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.bcb236e2d8', 'Kotlin')
    }
  },
  {
    value: 'markdown',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.983b9576b4', 'Markdown')
    }
  },
  {
    value: 'mermaid',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.89d6cc14fb', 'Mermaid')
    }
  },
  {
    value: 'python',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.2391f9cda9', 'Python')
    }
  },
  {
    value: 'ruby',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.96182a2f64', 'Ruby')
    }
  },
  {
    value: 'rust',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.e72e6b03f4', 'Rust')
    }
  },
  {
    value: 'scss',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.5af8251002', 'SCSS')
    }
  },
  {
    value: 'shell',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.d01f55be57', 'Shell')
    }
  },
  {
    value: 'sql',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.3009f722b9', 'SQL')
    }
  },
  {
    value: 'swift',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.9e384d48dc', 'Swift')
    }
  },
  {
    value: 'typescript',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.88d777bc07', 'TypeScript')
    }
  },
  {
    value: 'xml',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.5ef5605cb7', 'XML')
    }
  },
  {
    value: 'yaml',
    get label() {
      return translate('auto.components.editor.RichMarkdownCodeBlock.74eab1d9b2', 'YAML')
    }
  }
]

export function RichMarkdownCodeBlock({
  node,
  updateAttributes,
  editor,
  getPos
}: NodeViewProps): React.JSX.Element {
  useTranslation()
  const language = (node.attrs.language as string) || ''
  const [copied, setCopied] = useState(false)
  const copiedResetTimerRef = useRef<number | null>(null)
  // Why: clipboard IPC can resolve after the node view unmounts; avoid
  // starting a reset timer that will outlive the component.
  const isMountedRef = useRef(false)
  const settings = useAppStore((s) => s.settings)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const isMermaid = language === 'mermaid'
  const hasContent = node.textContent.trim().length > 0
  // Why: a rendered mermaid block collapses its source to a compact "Mermaid"
  // chip so the rich view isn't dominated by raw diagram code. The source stays
  // in the document (it's the ProseMirror contentDOM) and is revealed on demand
  // for editing. It only makes sense once there's syntax to render — an empty
  // block stays open so the user can type the diagram.
  const [expanded, setExpanded] = useState(false)
  const collapsed = isMermaid && hasContent && !expanded

  // Why: once expanded for editing, fold the source back into the chip as soon
  // as the selection leaves the block, so the collapsed presentation is the
  // resting state without the user having to explicitly close it.
  useEffect(() => {
    if (!isMermaid || !expanded) {
      return
    }
    const foldWhenSelectionLeaves = (): void => {
      const pos = typeof getPos === 'function' ? getPos() : undefined
      if (typeof pos !== 'number') {
        return
      }
      const { from, to } = editor.state.selection
      // Inside the editable source means strictly between the node's open and
      // close tokens (pos .. pos + nodeSize).
      const insideSource = from >= pos + 1 && to <= pos + node.nodeSize - 1
      if (!insideSource) {
        setExpanded(false)
      }
    }
    editor.on('selectionUpdate', foldWhenSelectionLeaves)
    return () => {
      editor.off('selectionUpdate', foldWhenSelectionLeaves)
    }
  }, [editor, expanded, getPos, isMermaid, node])

  // Why: clicking the chip keeps the diagram collapsed but selects the whole
  // source *text* as a plain TextSelection. That drives the review annotation
  // "+" to target the entire diagram source (its rect falls back to the chip
  // since the source stays hidden), so one click adds a note over the whole
  // block. The source itself is not revealed — double-click does that.
  const handleChipClick = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') {
      return
    }
    const from = pos + 1
    const to = pos + node.nodeSize - 1
    editor.chain().focus().setTextSelection({ from, to }).run()
  }, [editor, getPos, node])

  // Double-click reveals the source and drops the cursor into it for editing.
  // Why: the selection is placed on the next frame so React has already made
  // the <pre> visible — ProseMirror can't render a caret into a display:none
  // contentDOM, so setting it in the same tick would drop the cursor.
  const handleChipReveal = useCallback(() => {
    const pos = typeof getPos === 'function' ? getPos() : undefined
    if (typeof pos !== 'number') {
      return
    }
    setExpanded(true)
    requestAnimationFrame(() => {
      editor
        .chain()
        .focus()
        .setTextSelection(pos + 1)
        .run()
    })
  }, [editor, getPos])

  const clearCopiedResetTimer = useCallback((): void => {
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
      copiedResetTimerRef.current = null
    }
  }, [])

  const setCopyButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      isMountedRef.current = node !== null
      if (node === null) {
        clearCopiedResetTimer()
      }
    },
    [clearCopiedResetTimer]
  )

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateAttributes({ language: e.target.value })
    },
    [updateAttributes]
  )

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const text = node.textContent
      void window.api.ui
        .writeClipboardText(text)
        .then(() => {
          if (!isMountedRef.current) {
            return
          }
          clearCopiedResetTimer()
          setCopied(true)
          copiedResetTimerRef.current = window.setTimeout(() => {
            copiedResetTimerRef.current = null
            setCopied(false)
          }, 1500)
        })
        .catch(() => {
          // Silently swallow clipboard write failures (e.g. permission denied).
        })
    },
    [clearCopiedResetTimer, node]
  )

  return (
    <NodeViewWrapper
      className={`rich-markdown-code-block-wrapper${isMermaid ? ' is-mermaid' : ''}${
        collapsed ? ' is-mermaid-collapsed' : ''
      }`}
    >
      {collapsed ? (
        // Why: the chip replaces the raw source in the resting state. Single
        // click selects the whole source so a review note can target the entire
        // diagram; double click reveals the source to edit it.
        <div
          className="mermaid-collapsed-chip"
          contentEditable={false}
          role="button"
          tabIndex={0}
          onClick={handleChipClick}
          onDoubleClick={handleChipReveal}
          title={translate(
            'auto.components.editor.RichMarkdownCodeBlock.mermaid-chip-hint',
            'Click to add a note, double-click to edit'
          )}
        >
          {translate('auto.components.editor.RichMarkdownCodeBlock.89d6cc14fb', 'Mermaid')}
        </div>
      ) : (
        <>
          <select
            className="rich-markdown-code-block-lang"
            contentEditable={false}
            value={language}
            onChange={onChange}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.value} value={lang.value}>
                {lang.label}
              </option>
            ))}
            {/* If the document has a language not in our list, show it as-is */}
            {language && !LANGUAGES.some((l) => l.value === language) ? (
              <option value={language}>{language}</option>
            ) : null}
          </select>
          <button
            ref={setCopyButtonRef}
            type="button"
            className="code-block-copy-btn"
            contentEditable={false}
            onClick={handleCopy}
            aria-label={translate(
              'auto.components.editor.RichMarkdownCodeBlock.c72beafc0f',
              'Copy code'
            )}
            title={translate(
              'auto.components.editor.RichMarkdownCodeBlock.c72beafc0f',
              'Copy code'
            )}
          >
            {copied ? (
              <>
                <Check size={14} />
                <span className="code-block-copy-label">
                  {translate('auto.components.editor.RichMarkdownCodeBlock.232d9ed853', 'Copied')}
                </span>
              </>
            ) : (
              <Copy size={14} />
            )}
          </button>
        </>
      )}
      <NodeViewContent<'pre'> as="pre" />
      {/* Why: mermaid diagrams render as a live SVG preview below the editable
          source so users can see the result while editing. The code block stays
          editable — the diagram is read-only output. This preview also goes
          through MermaidBlock's sanitized SVG path, so it must opt out of
          Mermaid HTML labels just like markdown preview to keep labels visible. */}
      {isMermaid && node.textContent.trim() && (
        <div contentEditable={false} className="mermaid-preview">
          <MermaidBlock content={node.textContent.trim()} isDark={isDark} htmlLabels={false} />
        </div>
      )}
    </NodeViewWrapper>
  )
}
