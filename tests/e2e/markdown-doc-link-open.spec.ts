import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'

// Not dot-prefixed: listMarkdownDocuments skips hidden directories, so a fixture
// inside one would never enter the doc index the link resolves against.
const FIXTURE_DIRECTORY = 'orca-e2e-markdown-doc-link'

async function activeEditorPath(page: Parameters<typeof waitForRichMarkdownEditor>[0]) {
  return page.evaluate(() => {
    const state = window.__store?.getState()
    return state?.openFiles.find((entry) => entry.id === state.activeFileId)?.filePath ?? null
  })
}

test.describe('Rich markdown doc link opening', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('opens a link the caret is still inside on mod-click', async ({ orcaPage }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let targetPath: string | null = null
    let sourcePath: string | null = null

    try {
      targetPath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'link-target',
        testInfo.workerIndex,
        '# Target note\n'
      )
      sourcePath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'link-source',
        testInfo.workerIndex,
        'intro\n'
      )
      const targetName = path.basename(targetPath, '.md')

      await openMarkdownFixture(orcaPage, context, sourcePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)

      // Type the link and stop — the caret stays inside the brackets, which is
      // exactly the state where the text has not become a doc-link node yet.
      const paragraph = editor.locator('p', { hasText: 'intro' })
      await paragraph.click({ force: true })
      await orcaPage.keyboard.press('End')
      await orcaPage.keyboard.type(` [[${targetName}]]`)
      await orcaPage.keyboard.press('Escape')

      const preview = editor.locator('.rich-markdown-doc-link-preview')
      await expect(preview).toBeVisible()
      // The link is still literal text: no atom node has been created.
      await expect(editor.locator('[data-doc-link-target]')).toHaveCount(0)

      await expect(preview).not.toHaveClass(/rich-markdown-doc-link-preview--missing/)

      await preview.click({ modifiers: ['ControlOrMeta'], force: true })

      await expect.poll(() => activeEditorPath(orcaPage), { timeout: 5_000 }).toBe(targetPath)
    } finally {
      await cleanupMarkdownFixture(sourcePath)
      await cleanupMarkdownFixture(targetPath)
    }
  })

  test('opens a rendered link clicked anywhere along its width', async ({ orcaPage }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let targetPath: string | null = null
    let sourcePath: string | null = null

    try {
      targetPath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'wide-target',
        testInfo.workerIndex,
        '# Target note\n'
      )
      const targetName = path.basename(targetPath, '.md')
      sourcePath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'wide-source',
        testInfo.workerIndex,
        `See [[${targetName}]] here.\n`
      )

      await openMarkdownFixture(orcaPage, context, sourcePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)
      const link = editor.locator('[data-doc-link-target]')
      await expect(link).toBeVisible()

      // Why the far edge: posAtCoords reports the position after the atom for
      // everything past its leading edge, which used to swallow the click.
      const box = await link.boundingBox()
      expect(box).not.toBeNull()
      await link.click({
        modifiers: ['ControlOrMeta'],
        force: true,
        position: { x: box!.width - 4, y: box!.height / 2 }
      })

      await expect.poll(() => activeEditorPath(orcaPage), { timeout: 5_000 }).toBe(targetPath)
    } finally {
      await cleanupMarkdownFixture(sourcePath)
      await cleanupMarkdownFixture(targetPath)
    }
  })
})
