# Codex PDP Maker

Local-only PDP generation and redesign app.

## Prerequisites

```bash
npx @openai/codex login
pnpm install
```

The app reads Codex OAuth credentials from `~/.codex/auth.json` or compatible Codex/OpenClaw auth paths on the server only. Browser clients never receive OAuth tokens, and there is no API-key input UI.

## Run

```bash
pnpm dev
```

Open `http://localhost:3000`.

## Main Features

- New PDP creation from product images.
- Existing PDP redesign from image or PDF uploads.
- Shared PDP editor with section regeneration, text and shape overlays, draft save, section download, and ZIP export.
- Local lexical knowledge search stored under `.data/knowledge`.
- OpenAI image generation through the Codex OAuth route using `openai/gpt-image-2`.

## APIs

- `GET /api/config`: Codex OAuth, model, and local knowledge status.
- `POST /api/oauth/verify-image`: OAuth image-generation smoke test.
- `POST /api/pdp/analyze`: Product-image based PDP section planning.
- `POST /api/pdp/images`: Section image generation or regeneration.
- `POST /api/redesign/generate`: Existing PDP redesign from images.
- `POST /api/redesign/edit-section`: Reference-image based section edit.
- `GET/POST/DELETE /api/knowledge`: Local knowledge file management.

## Verify

```bash
pnpm typecheck
pnpm build
```

If `/api/config` reports missing auth, run `npx @openai/codex login` again. If image generation returns 403, treat it as a Codex OAuth profile, workspace, or model-access issue rather than a prompt issue.

For internal deployment notes, review `docs/PRODUCTION_READINESS.md`. `GET /api/ops/status` shows recent generation requests, limit hits, and failures for quick troubleshooting.

## OpenClaw Reference

The Codex OAuth image transport was implemented by referencing OpenClaw's OpenAI image-generation provider behavior. OpenClaw is MIT licensed:

```text
MIT License
Copyright (c) 2026 OpenClaw Foundation
```
