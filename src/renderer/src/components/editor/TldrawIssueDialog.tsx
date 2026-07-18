import { useCallback, useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import { ImageOff, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  captureSelectionPng,
  uploadCanvasScreenshotAndCreateIssue,
  type CapturedCanvasScreenshot
} from './tldraw-issue-image'

type TldrawIssueDialogProps = {
  editor: Editor
  worktreeId: string
  relativePath: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function basename(relativePath: string): string {
  const trimmed = relativePath.replace(/[/\\]+$/, '')
  const segments = trimmed.split(/[/\\]/)
  return segments.at(-1) || trimmed
}

export function TldrawIssueDialog({
  editor,
  worktreeId,
  relativePath,
  open,
  onOpenChange
}: TldrawIssueDialogProps): React.JSX.Element {
  const [screenshot, setScreenshot] = useState<CapturedCanvasScreenshot | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<'upload' | 'create' | null>(null)

  // Why: capture is a one-shot snapshot taken when the dialog opens — the
  // canvas selection can change while the dialog stays open (e.g. the user
  // clicks the canvas behind it), but the screenshot attached to the issue
  // must not silently follow that.
  useEffect(() => {
    if (!open) {
      return
    }
    setTitle(
      translate('auto.components.editor.TldrawIssueDialog.f3a9c1d8e0', 'Canvas: {{value0}}', {
        value0: basename(relativePath)
      })
    )
    setBody('')
    setErrorMessage(null)
    setFailedStage(null)
    setSubmitting(false)
    setScreenshot(null)
    let cancelled = false
    void captureSelectionPng(editor).then((result) => {
      if (!cancelled) {
        setScreenshot(result)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture only on open, not on every editor/relativePath identity change
  }, [open])

  const submit = useCallback(
    async (options?: { withoutImage?: boolean }): Promise<void> => {
      const trimmedTitle = title.trim()
      if (!trimmedTitle || submitting) {
        return
      }
      setSubmitting(true)
      setErrorMessage(null)
      setFailedStage(null)
      try {
        const image =
          options?.withoutImage || !screenshot
            ? null
            : { base64: screenshot.base64, fileName: screenshot.fileName }
        const result = await uploadCanvasScreenshotAndCreateIssue({
          worktreeId,
          title: trimmedTitle,
          body,
          image
        })
        if (!result.ok) {
          setErrorMessage(result.error)
          setFailedStage(result.stage)
          return
        }
        const createdIssueToast = translate(
          'auto.components.editor.TldrawIssueDialog.b7e2f4a610',
          'Opened issue #{{value0}}',
          { value0: result.number }
        )
        const createdIssueToastOptions = {
          action: result.url
            ? {
                label: translate('auto.components.editor.TldrawIssueDialog.c14d8b9f22', 'View'),
                onClick: () => window.open(result.url, '_blank')
              }
            : undefined
        }
        if (result.bodySaveWarning) {
          toast.warning(createdIssueToast, {
            ...createdIssueToastOptions,
            description: result.bodySaveWarning
          })
        } else {
          toast.success(createdIssueToast, createdIssueToastOptions)
        }
        onOpenChange(false)
      } finally {
        setSubmitting(false)
      }
    },
    [title, body, screenshot, submitting, worktreeId, onOpenChange]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          onOpenChange(next)
        }
      }}
    >
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate(
              'auto.components.editor.TldrawIssueDialog.a45e0c7b31',
              'Create GitHub issue from selection'
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {translate(
              'auto.components.editor.TldrawIssueDialog.d92f1a6c43',
              'Files an issue with a screenshot of the selected shapes attached.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {screenshot ? (
            <img
              src={screenshot.dataUrl}
              alt=""
              className="max-h-40 w-full rounded-md border border-border object-contain"
            />
          ) : (
            <div className="flex h-20 items-center justify-center gap-2 rounded-md border border-dashed border-border text-xs text-muted-foreground">
              <ImageOff className="size-3.5" />
              {translate(
                'auto.components.editor.TldrawIssueDialog.e01b7d5f94',
                'No selection to capture'
              )}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {translate('auto.components.editor.TldrawIssueDialog.f68a2e4c05', 'Title')}
            </label>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void submit()
                }
              }}
              placeholder={translate(
                'auto.components.editor.TldrawIssueDialog.a3c9f0b716',
                'Short summary'
              )}
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              {translate(
                'auto.components.editor.TldrawIssueDialog.b0d4e6a827',
                'Description (optional)'
              )}
            </label>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={translate(
                'auto.components.editor.TldrawIssueDialog.c2f5a7b938',
                "What's going on?"
              )}
              disabled={submitting}
              className="box-border min-h-24 w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          {errorMessage ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <p>{errorMessage}</p>
              {failedStage === 'upload' && screenshot ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => void submit({ withoutImage: true })}
                >
                  {translate(
                    'auto.components.editor.TldrawIssueDialog.d3a6b8c049',
                    'Create without screenshot'
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {translate('auto.components.editor.TldrawIssueDialog.e4b7c9d150', 'Cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!title.trim() || submitting}>
            {submitting ? (
              <>
                <LoaderCircle className="size-4 animate-spin" />
                {translate('auto.components.editor.TldrawIssueDialog.f5c8d0e261', 'Creating…')}
              </>
            ) : (
              translate('auto.components.editor.TldrawIssueDialog.a6d9e1f372', 'Create issue')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
