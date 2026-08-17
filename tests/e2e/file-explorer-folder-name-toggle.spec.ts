import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { openFileExplorer } from './helpers/file-explorer'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

async function isDirExpanded(page: Page, relativeDir: string): Promise<boolean> {
  return page.evaluate((dir) => {
    const state = window.__store?.getState()
    const worktreeId = state?.activeWorktreeId
    if (!state || !worktreeId) {
      throw new Error('active worktree unavailable')
    }
    const worktree = Object.values(state.worktreesByRepo)
      .flat()
      .find((candidate) => candidate.id === worktreeId)
    if (!worktree) {
      throw new Error('active worktree path unavailable')
    }
    const separator = worktree.path.includes('\\') ? '\\' : '/'
    return state.expandedDirs[worktreeId]?.has(`${worktree.path}${separator}${dir}`) ?? false
  }, relativeDir)
}

test('clicking a folder name expands it instantly and a double-click rename does not flip it back', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const srcRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: /^src$/ })
  const srcName = srcRow.locator('[data-file-explorer-row-name]')
  const indexRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: /^index\.ts$/ })
  await expect(srcRow).toBeVisible({ timeout: 10_000 })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(false)

  // Why: the toggle must land in the same click dispatch — no double-click
  // window wait — so the store already reflects it once click() resolves.
  await srcName.click({ force: true })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(true)
  await expect(indexRow).toBeVisible({ timeout: 10_000 })

  // Collapse via the chevron so the double-click starts from a known state.
  await srcRow.locator('svg').first().click({ force: true })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(false)
  await expect(indexRow).toHaveCount(0, { timeout: 10_000 })

  // Why: the first click of the double-click expands; the second must not
  // collapse again under the rename input, so the folder stays expanded.
  await srcName.dblclick({ force: true })
  // Why: the inline rename input replaces the row inside the tree drop target;
  // `:focus` is unreliable in the hidden E2E window, so scope by container.
  const renameInput = orcaPage
    .locator('[data-native-file-drop-target="file-explorer"]')
    .getByRole('textbox')
  await expect(renameInput).toBeVisible({ timeout: 5_000 })
  await expect(renameInput).toHaveValue('src')
  expect(await isDirExpanded(orcaPage, 'src')).toBe(true)
  await expect(indexRow).toBeVisible({ timeout: 10_000 })

  await renameInput.press('Escape')
  await expect(renameInput).toHaveCount(0, { timeout: 5_000 })
})
