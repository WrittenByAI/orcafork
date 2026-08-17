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

test('clicking a folder name expands it instantly and double-click no longer starts a rename', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await openFileExplorer(orcaPage)

  const srcRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: /^src$/ })
  const srcName = srcRow.getByText('src', { exact: true })
  const indexRow = orcaPage.locator('[data-file-explorer-row]').filter({ hasText: /^index\.ts$/ })
  const explorerTextbox = orcaPage
    .locator('[data-native-file-drop-target="file-explorer"]')
    .getByRole('textbox')
  await expect(srcRow).toBeVisible({ timeout: 10_000 })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(false)

  // Why: the toggle must land in the same click dispatch — no double-click
  // window wait — so the store already reflects it once click() resolves.
  await srcName.click({ force: true })
  expect(await isDirExpanded(orcaPage, 'src')).toBe(true)
  await expect(indexRow).toBeVisible({ timeout: 10_000 })

  // Why: double-click on the name is just two toggles now (VS Code behavior),
  // so an expanded folder ends up expanded again; rename lives on Enter and
  // the context menu, so no input may appear.
  await srcName.dblclick({ force: true })
  await expect(explorerTextbox).toHaveCount(0)
  expect(await isDirExpanded(orcaPage, 'src')).toBe(true)
  await expect(indexRow).toBeVisible({ timeout: 10_000 })

  await srcRow.press('Enter')
  await expect(explorerTextbox).toBeVisible({ timeout: 5_000 })
  await expect(explorerTextbox).toHaveValue('src')
  await explorerTextbox.press('Escape')
  await expect(explorerTextbox).toHaveCount(0, { timeout: 5_000 })
})
