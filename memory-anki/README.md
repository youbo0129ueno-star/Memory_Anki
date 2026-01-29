# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Web usage (for mobile browsers)

- Dev server: `npm run dev`
- Build for static hosting: `npm run build`
- Preview build locally: `npm run preview`

When running in the browser, data is stored in `localStorage` instead of Tauri appData.

## GitHub Pages (auto deploy)

This repo is set up to deploy the `memory-anki` web build to GitHub Pages on every push to `main`.
The site URL will be:

`https://youbo0129ueno-star.github.io/Memory_Anki/`

If you rename the repository, update `base` in `memory-anki/vite.config.ts`.

### Required GitHub Secrets for Pages build

Set these repository secrets (Settings → Secrets and variables → Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
