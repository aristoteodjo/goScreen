# Contributing to goScreen

Thanks for helping! goScreen is MIT-licensed; by contributing you agree your work is released under the same license.

## Setup

See the [Quick start](README.md#quick-start): Node ≥ 22, pnpm 10, Rust stable, FFmpeg.

```bash
pnpm install
pnpm dev:desktop
```

## Before opening a pull request

- Read [`GOSCREEN.md`](GOSCREEN.md) (architecture, in French) and follow its rules:
  business logic in pure, tested functions; Tauri commands and React components stay thin; no hard-coded device.
- Don't hand-edit the generated shadcn components in `apps/desktop/src/components/ui/`.
- Run the checks:

  ```bash
  pnpm check-types && pnpm test && pnpm lint
  cd apps/desktop/src-tauri && cargo test
  ```

- Keep commits focused, with messages in English.

## Releases

Maintainers bump `version` in `apps/desktop/src-tauri/tauri.conf.json`, `Cargo.toml` and `apps/desktop/package.json`,
then push a tag `vX.Y.Z`. The `Release` workflow builds macOS (arm64, x64), Windows and Linux installers and
attaches them to a draft GitHub release, published after a manual check.

## Security

Please report vulnerabilities privately (see [Security](README.md#security)), not in a public issue.
