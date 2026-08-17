// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { useFileExplorerHandlers } from './useFileExplorerHandlers'
import type { TreeNode } from './file-explorer-types'

vi.mock('./file-explorer-operation-owner', () => ({
  getFileExplorerOwnerUnresolvedMessage: () => 'unresolved',
  requireMatchingFileExplorerOperationRoute: () => ({ settings: {} })
}))

const directoryNode: TreeNode = {
  name: 'components',
  path: '/repo/src/components',
  relativePath: 'src/components',
  isDirectory: true,
  depth: 1
}

const fileNode: TreeNode = {
  name: 'index.ts',
  path: '/repo/src/index.ts',
  relativePath: 'src/index.ts',
  isDirectory: false,
  depth: 1
}

function renderHandlers(toggleDir: (worktreeId: string, dirPath: string) => void) {
  const openFile = vi.fn()
  const setSelectedPath = vi.fn()
  const hook = renderHook(() =>
    useFileExplorerHandlers({
      activeWorktreeId: 'wt-1',
      openFile,
      makePreviewFilePermanent: vi.fn(),
      toggleDir,
      loadDir: vi.fn().mockResolvedValue(true),
      statPath: vi.fn().mockResolvedValue({ isDirectory: true }),
      authorizeExternalPath: vi.fn(),
      markPathAsDirectory: vi.fn(),
      setSelectedPath,
      scrollRef: createRef<HTMLDivElement>()
    })
  )
  return { ...hook, openFile, setSelectedPath }
}

describe('file explorer click activation', () => {
  afterEach(() => cleanup())

  it('toggles a directory synchronously on click, with no double-click window timer', () => {
    vi.useFakeTimers()
    try {
      const toggleDir = vi.fn()
      const { result, setSelectedPath } = renderHandlers(toggleDir)

      act(() => result.current.handleClick(directoryNode))

      // Why: any delay here is what read as lag on the folder name vs. the chevron.
      expect(toggleDir).toHaveBeenCalledWith('wt-1', directoryNode.path)
      expect(setSelectedPath).toHaveBeenCalledWith(directoryNode.path)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens a file as a preview on click', async () => {
    const toggleDir = vi.fn()
    const { result, openFile } = renderHandlers(toggleDir)

    await act(async () => {
      result.current.handleClick(fileNode)
      await Promise.resolve()
    })

    expect(toggleDir).not.toHaveBeenCalled()
    expect(openFile).toHaveBeenCalledTimes(1)
    expect(openFile.mock.calls[0]?.[1]).toMatchObject({ preview: true })
  })
})
