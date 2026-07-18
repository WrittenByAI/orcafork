@AGENTS.md

# Контекст форка

Этот чекаут — **форк Orca**, а не сам апстрим. Всё, что написано в `AGENTS.md`
выше, — это правила апстрима, и они действуют без изменений. Ниже — только то,
что специфично для форка.

## Апстрим

- Репозиторий апстрима: `https://github.com/stablyai/orca` — подключён как ремоут
  `origin`. Это **апстрим**, а не форк: никогда не пушь в него без явной просьбы.
- Форк — `https://github.com/WrittenByAI/orca`, ремоут `fork`, ветка `main`.
  Работа форка живёт там; локальная ветка — `tldraw-fork`.
- База форка: `v1.4.142-rc.1` (`792e11372`, 2026-07-14). Апстрим двигается быстро —
  выполни `git fetch && git status -sb`, прежде чем считать, что рабочее дерево
  совпадает с `main`.
- Форк несёт свои коммиты поверх базы, поэтому синхронизация — это **мердж**, а не
  fast-forward. Чаще всего конфликтуют файлы локалей
  (`src/renderer/src/i18n/locales/*.json`) и `pnpm-lock.yaml`.
- Синхронизация автоматизирована: ежедневный systemd-таймер гоняет
  `.fork-sync/sync.mjs`, который сам мержит апстрим и открывает PR. Подробности —
  в [`.fork-sync/README.md`](./.fork-sync/README.md). Этот раздел CLAUDE.md —
  то, по чему агент судит о намерениях форка при резолве конфликтов, поэтому
  **держи его актуальным**.

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

## Как разрабатывать

Проверено эмпирически на этой машине (Linux, 2026-07-18) — запуском `pnpm dev` и
осмотром окна через CDP-порт.

**Пересобирать приложение вручную НЕ нужно.** `pnpm dev` поднимает vite-дев-сервер
на `http://localhost:5173`, и окно Electron грузит именно его (`loadMainWindow` в
`src/main/window/createMainWindow.ts` уходит в ветку `loadURL`, потому что
`is.dev` истинно). Правки рендерера прилетают через HMR — в логе видно
`[vite] (client) hmr update /src/components/editor/TldrawViewer.tsx`.
`pnpm run build:electron-vite` нужен только для проверки продовой сборки, в
обычном цикле разработки он не требуется.

**Рендерер vs main/preload — разное поведение:**

| Что правишь | Что происходит |
| --- | --- |
| `src/renderer/**` | HMR применяет правку сразу, перезапуск не нужен |
| `src/main/**`, `src/preload/**` | По умолчанию **ничего** — `pnpm dev` не следит за ними |

Чтобы main/preload тоже подхватывались, запускай с флагом watch:

```bash
pnpm dev --watch      # или -w
```

Тогда правка в main вызывает пересборку и `restarting electron app...`. Учти,
что пересборка main — это полный бандл и занимает ~50 с, так что для точечной
работы по main иногда быстрее просто перезапустить `pnpm dev`.

**Ускорение старта.** Обычный `pnpm dev` тратит ~110 с, потому что сначала
собирает web-клиент для pairing («Building web client for pairing...»). Если
браузерный pairing сейчас не нужен, пропусти этот шаг:

```bash
ORCA_SKIP_DEV_WEB_PREPARE=1 pnpm dev    # старт ~40 с вместо ~110 с
```

**Инспекция запущенного окна.** Раннер сам подбирает детерминированный по
worktree CDP-порт и печатает его строкой `[orca-dev] Remote debugging on
http://127.0.0.1:<порт>` (в этом worktree — 9334). Список таргетов —
`GET /json/list`; дальше можно цепляться к `webSocketDebuggerUrl` для
`Runtime.evaluate` / `Page.captureScreenshot`. Полезно, чтобы проверить правку в
живом приложении, не гоняя e2e.

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
