# LCE Save Editor

a browser-based save editor for **minecraft legacy console edition** (TU68 / 1.12 era).
load a `.ms` save file or a plain player `.dat`, edit your inventory, player stats, and world settings, then download the modified save straight back to your machine — no install needed.

**→ [lce.str1k3r.xyz](https://lce.str1k3r.xyz)**

---

## What was Updated?

I Updated this to support versions above TU19 so it now supports all the way upto TU68!
Why TU68? You may ask this is because publicly we only have the Block & Item ID's up to TU68 / 1.12
If you know the Block & Item ID's for TU69+ Please contact me on discord: strk1k3r87

---

## What it can do

- **inventory** — add, remove, or edit items; change stack count, damage, and enchantments; drag-and-drop slots; bulk repair or max stacks
- **player stats** — health, food, saturation, xp level, game mode, position, spawn point
- **world settings** — level name, seed, time of day, weather, difficulty, game rules
- supports `.ms` container saves (the native console format) and plain player `.dat` files

---

## How the .ms format works

the `.ms` file is a zlib-compressed container holding multiple embedded files (player dat, level.dat, etc.). see [`src/lib/containers.ts`](src/lib/containers.ts) for the full format breakdown and step-by-step read/write logic.

---

## Source Files

| file | purpose |
|------|---------|
| [`src/lib/containers.ts`](src/lib/containers.ts) | `.ms` container parser and rebuilder |
| [`src/lib/nbt.ts`](src/lib/nbt.ts) | binary nbt reader and writer |
| [`src/lib/items.ts`](src/lib/items.ts) | item id → name map and category helpers |
| [`src/lib/enchants.ts`](src/lib/enchants.ts) | enchantment definitions and labels |
| [`src/lib/texturePaths.ts`](src/lib/texturePaths.ts) | item/block id → CDN texture path map |
| [`src/components/InventoryTab.tsx`](src/components/InventoryTab.tsx) | inventory editor (canvas + list view) |
| [`src/components/InventoryCanvas.tsx`](src/components/InventoryCanvas.tsx) | canvas-based inventory renderer with drag-and-drop and enchant glint |
| [`src/components/PlayerStatsTab.tsx`](src/components/PlayerStatsTab.tsx) | player stats editor |
| [`src/components/WorldTab.tsx`](src/components/WorldTab.tsx) | world settings editor |
| [`src/components/FileDropZone.tsx`](src/components/FileDropZone.tsx) | drag-and-drop file loader |
| [`src/App.tsx`](src/App.tsx) | root app, file loading, tab layout |

---

## Running locally

```bash
npm install
npm run dev
```

requires node 18+.

---

## Notes

- all editing happens in-browser — nothing is sent to a server
- always back up your saves before editing
- tested against TU19 saves; other TU versions may work but aren't guaranteed
- game assets (textures, icons) are sourced from the [minecraft LCE source release](https://archive.org/details/minecraft-legacy-console-edition-source-code) via the internet archive
- minecraft is the property of mojang studios / microsoft — this is an unofficial fan tool
