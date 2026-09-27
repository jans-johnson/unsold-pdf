# @unsold/site: the Unsold PDF website

A static landing page with no framework.

    npm run dev -w @unsold/site     # http://localhost:5190
    npm run build -w @unsold/site   # static files in apps/site/dist, deployable from any folder

- `index.html`: the page. Download and source links live in the `LINKS` object at the bottom; empty links show as "soon".
- `maze.js`: the Paywall Maze, an isometric SVG model drawn from code. It covers the maze (generated from a fixed seed), wall signs, "you", and the scroll camera (keyframes in `mountMaze`).
- `features.js`: the feature demos, small looping animations of the app (edit text, fill & sign, reorder pages, OCR) drawn in the app's interface style. Each loop runs only while its card is on screen.
- `styles.css`: everything else. Honours `prefers-reduced-motion` (the story becomes one still frame of the full maze).
- `assets/`: copies of files from `brand/`. Re-copy them if the logo changes.

Why the page is built this way is recorded in the Unsold design doc (`Utility Apps/unsold/DESIGN.md`, §10).
