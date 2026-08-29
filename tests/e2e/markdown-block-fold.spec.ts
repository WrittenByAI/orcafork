import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'

const FIXTURE_DIRECTORY = '.orca-e2e-markdown-block-fold'

const OUTLINE_MARKDOWN = [
  '# One',
  '',
  'alpha',
  '',
  '## Two',
  '',
  'beta',
  '',
  '# Three',
  '',
  'gamma',
  ''
].join('\n')

const BULLET_MARKDOWN = ['- parent item', '  - child item', '- sibling item', ''].join('\n')

test.describe('Rich markdown block fold', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
  })

  test('folds a heading section and leaves the markdown untouched', async ({
    orcaPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'block-fold',
        testInfo.workerIndex,
        OUTLINE_MARKDOWN
      )
      await openMarkdownFixture(orcaPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)

      const firstHeading = editor.locator('h1').first()
      const nestedHeading = editor.locator('h2', { hasText: 'Two' })
      const ownParagraph = editor.locator('p', { hasText: 'alpha' })
      const otherParagraph = editor.locator('p', { hasText: 'gamma' })

      await expect(ownParagraph).toBeVisible()
      await firstHeading.locator('.rich-markdown-fold-toggle').click({ force: true })

      // The section the heading owns disappears, including its nested heading;
      // the next top-level section stays put.
      await expect(ownParagraph).toBeHidden()
      await expect(nestedHeading).toBeHidden()
      await expect(otherParagraph).toBeVisible()
      await expect(firstHeading).toHaveClass(/rich-markdown-fold-collapsed/)

      // Folding is a view state: the blocks stay in the document, just unpainted.
      await expect(ownParagraph).toBeAttached()
      await expect(nestedHeading).toBeAttached()

      await firstHeading.locator('.rich-markdown-fold-toggle').click({ force: true })
      await expect(ownParagraph).toBeVisible()
      await expect(nestedHeading).toBeVisible()
      await expect(firstHeading).not.toHaveClass(/rich-markdown-fold-collapsed/)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('folds a bullet down to its own line', async ({ orcaPage }, testInfo) => {
    const context = await getActiveWorktreeContext(orcaPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        FIXTURE_DIRECTORY,
        'bullet-fold',
        testInfo.workerIndex,
        BULLET_MARKDOWN
      )
      await openMarkdownFixture(orcaPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(orcaPage)

      // hasText matches the parent too (it contains the child's text), so lean on
      // the nesting: the outer items are ul > li, the nested one is li li.
      const parentItem = editor.locator('ul > li').first()
      const childItem = editor.locator('li li')
      const siblingItem = editor.locator('ul > li').last()

      await expect(childItem).toBeVisible()
      await parentItem.locator('.rich-markdown-fold-toggle').first().click({ force: true })

      await expect(childItem).toBeHidden()
      await expect(siblingItem).toBeVisible()

      // The collapsed dots are the way back open.
      await parentItem.locator('.rich-markdown-fold-ellipsis').click({ force: true })
      await expect(childItem).toBeVisible()
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
