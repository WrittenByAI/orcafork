@AGENTS.md

# Контекст форка

Этот чекаут — **форк Orca**, а не сам апстрим. Всё, что написано в `AGENTS.md`
выше, — это правила апстрима, и они действуют без изменений. Ниже — только то,
что специфично для форка.

## Апстрим

- Репозиторий апстрима: `https://github.com/stablyai/orca` — подключён как ремоут
  `origin`. Отдельного ремоута для форка нет: `origin` **и есть** апстрим, поэтому
  никогда не пушь в него без явной просьбы.
- База форка: `v1.4.142-rc.1` (`792e11372`, 2026-07-14). Апстрим двигается быстро —
  выполни `git fetch && git status -sb`, прежде чем считать, что рабочее дерево
  совпадает с `main`.
- Своих коммитов поверх `main` форк пока не несёт, синхронизация — обычный
  fast-forward. Чаще всего конфликтуют файлы локалей
  (`src/renderer/src/i18n/locales/*.json`) и `pnpm-lock.yaml`.

## Что добавляет форк: tldraw-канвасы

Форк превращает `.tldr`-файлы в полноценный тип документа внутри панели
редактора Orca, который можно смотреть и ревьюить. Три слоя, и все они построены
на существующих подсистемах Orca, а не параллельно им:

**1. Просмотр канваса.** Расширение `.tldr` маппится на язык `tldraw` в
`src/renderer/src/lib/language-detect.ts`. `editor-panel-render-model.ts` отдаёт
флаг `isTldraw`, а `EditorContent.tsx` лениво подгружает `TldrawViewer.tsx`
вместо текстового редактора, когда включён rich-режим (в raw-режиме по-прежнему
виден исходный JSON). `tldraw` и `@tldraw/assets` зафиксированы на версии `5.2.4`.

**2. Заметки на канвасе.** Аннотации переиспользуют существующую систему
diff-комментариев: это `DiffComment` с `source: 'canvas'` (см.
`src/shared/diff-comments-format.ts`, `store/slices/diffComments.ts`). Номеров
строк у канваса нет, поэтому комментарий привязывается к выделению фигур tldraw и
вместо исходной строки несёт человекочитаемое описание в `selectedText` — например
`3 shapes: 2 geo ("Login", "DB"), 1 arrow`, — которое строит
`tldraw-canvas-notes.ts`. `TldrawSelectionOverlay.tsx` рисует кнопки
аннотации/issue в слоте tldraw `InFrontOfTheCanvas` и получает идентификаторы
Orca через `tldraw-viewer-context.ts`.

**3. Канвас → GitHub issue.** `TldrawIssueDialog.tsx` вместе с
`tldraw-issue-image.ts` снимают выделение в PNG; `src/main/github/issue-images.ts`
загружает картинку через Contents API в выделенную ветку
`orca/canvas-screenshots` и вставляет в тело issue ссылку на raw `download_url`
(тела GitHub-issue не рендерят `data:`-URL, а другого хостинга картинок у Orca
нет). Проводка идёт обычным путём main/preload/runtime для GitHub:
`src/main/ipc/github.ts`, `src/main/runtime/rpc/methods/github.ts`,
`src/preload/`, `src/shared/types.ts`.

## Грабли форка

- **Никогда не импортируй `tldraw` как рантайм-значение в модулях, которые
  покрываются юнит-тестами.** Любой рантайм-биндинг тянет за собой rich-text-модуль
  tldraw → `@tiptap/extension-highlight` → версию `@tiptap/core`, в которой нет
  экспорта `getStyleProperty`, и это падает под резолюцией Vitest/Node ESM
  (бандлер Vite достаточно снисходителен, поэтому на само приложение это не
  влияет). Используй только `import type`, а за простым текстом ходи напрямую по
  JSON-структуре `TLRichText`. Пример этого паттерна — `tldraw-canvas-notes.ts`.
- Правя `src/main/github/`, придерживайся соглашений апстрима: `issue-images.ts`
  намеренно повторяет форму acquire/release и разбора ошибок из `issues.ts`.
