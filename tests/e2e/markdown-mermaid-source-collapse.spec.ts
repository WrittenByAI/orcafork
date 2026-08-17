import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-ordered-list-exit'

const RENDERED_DIAGRAM_TIMEOUT_MS = 20_000

const VALID_DIAGRAM_MARKDOWN = [
  '# Diagram',
  '',
  '```mermaid',
  'flowchart TD',
  '  A --> B',
  '```',
  '',
  'Tail paragraph.',
  ''
].join('\n')

const BROKEN_DIAGRAM_MARKDOWN = ['```mermaid', 'not a diagram at all {{{', '```', ''].join('\n')

test.describe('Rich markdown mermaid source collapse', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('shows only the diagram, selects the whole fence on click, and reopens on double-click', async ({
    orcaPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        'mermaid-collapse',
        testInfo.workerIndex,
        VALID_DIAGRAM_MARKDOWN
      )
      await openMarkdownFixture(orcaPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)
      const wrapper = editor.locator('.rich-markdown-code-block-wrapper')
      const source = editor.locator('.rich-markdown-code-block-wrapper > pre')
      const diagram = wrapper.locator('.mermaid-preview')

      await expect(diagram.locator('svg')).toBeVisible({ timeout: RENDERED_DIAGRAM_TIMEOUT_MS })
      await expect(wrapper).toHaveClass(/is-mermaid-source-collapsed/)
      await expect(source).toBeHidden()

      // Clicking the diagram selects the whole fence, so a review note can be
      // anchored to it without exposing the collapsed source.
      // Why the shortcut instead of the hover "+" button: that button is placed
      // from a requestAnimationFrame callback, which a headless (hidden) Electron
      // window never fires. The chord resolves the same annotation target.
      await diagram.click({ force: true })
      await expect(wrapper).toHaveClass(/is-mermaid-selected/)
      await expect(source).toBeHidden()

      await orcaPage.keyboard.press('ControlOrMeta+Shift+A')
      const composer = orcaPage.getByPlaceholder('Add note for the AI')
      await expect(composer).toBeVisible({ timeout: 5_000 })
      await expect(source).toBeHidden()

      // Dismissing the composer must leave the fence collapsed, not sprung open.
      await orcaPage.getByRole('button', { name: 'Cancel' }).click({ force: true })
      await expect(composer).toBeHidden()
      await expect(source).toBeHidden()

      // Same after a note is actually submitted.
      await diagram.click({ force: true })
      await orcaPage.keyboard.press('ControlOrMeta+Shift+A')
      await expect(composer).toBeVisible({ timeout: 5_000 })
      await composer.fill('Check this flowchart')
      await orcaPage.getByRole('button', { name: 'Add note' }).click({ force: true })
      await expect(composer).toBeHidden()
      await expect(source).toBeHidden()

      // The note highlight paints on the hidden source, so the diagram carries it.
      // (The note card itself is positioned from a requestAnimationFrame callback,
      // which a headless window never fires — its click routing is unit-tested.)
      await expect(wrapper).toHaveClass(/is-mermaid-annotated/)
      await diagram.click({ force: true })
      await expect(source).toBeHidden()

      // Double-click is the way back into the source.
      await diagram.dblclick({ force: true })
      await expect(source).toBeVisible()
      await expect(wrapper).not.toHaveClass(/is-mermaid-source-collapsed/)

      await editor.locator('p', { hasText: 'Tail paragraph.' }).click({ force: true })
      await expect(wrapper).toHaveClass(/is-mermaid-source-collapsed/)
      await expect(source).toBeHidden()
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('keeps the source visible when the diagram fails to render', async ({
    orcaPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        'mermaid-collapse-invalid',
        testInfo.workerIndex,
        BROKEN_DIAGRAM_MARKDOWN
      )
      await openMarkdownFixture(orcaPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)
      const wrapper = editor.locator('.rich-markdown-code-block-wrapper')

      await expect(wrapper.locator('.mermaid-error')).toBeVisible({
        timeout: RENDERED_DIAGRAM_TIMEOUT_MS
      })
      await expect(editor.locator('.rich-markdown-code-block-wrapper > pre')).toBeVisible()
      await expect(wrapper).not.toHaveClass(/is-mermaid-source-collapsed/)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
