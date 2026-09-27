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

test('double-clicking a folder name never starts a rename; Enter still does', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const srcRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: /^src$/ })
  const srcName = srcRow.getByText('src', { exact: true })
  const explorerTextbox = orcaPage
    .locator('[data-native-file-drop-target="file-explorer"]')
    .getByRole('textbox')
  await expect(srcRow).toBeVisible({ timeout: 10_000 })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(false)

  await srcName.click({ force: true })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(true)

  // Why: the first click toggles and the second is dropped by the hotspot rule,
  // so a double click lands on one toggle — and opens no rename input.
  await srcName.dblclick({ force: true })
  await expect(explorerTextbox).toHaveCount(0)
  expect(await isDirExpanded(orcaPage, 'src')).toBe(false)

  await srcRow.press('Enter')
  await expect(explorerTextbox).toBeVisible({ timeout: 5_000 })
  await expect(explorerTextbox).toHaveValue('src')
  await explorerTextbox.press('Escape')
  await expect(explorerTextbox).toHaveCount(0, { timeout: 5_000 })
})
