# @unsold/site: the Unsold PDF website

A static landing page with no framework.

    npm run dev -w @unsold/site     # http://localhost:5190
    npm run build -w @unsold/site   # static files in apps/site/dist, deployable from any folder

- `index.html`: the page. Download and source links live in the `LINKS` object at the bottom; empty links show as "soon".
- `maze.js`: the Paywall Maze, an isometric SVG model drawn from code. It covers the maze (generated from a fixed seed), the red wall signs, "you", the Zero Signal and Zero stepping in once the walls start to sink, and the scroll camera (keyframes in `mountMaze`).
- `tour.js`: the feature tour, a pinned section scrubbed by scroll. One app window rises out of a 3D tilt and plays edit text, fill & sign, arrange pages and OCR exactly as far as you've scrolled, with the other tools drifting past at different depths.
- `styles.css`: everything else, including the comic-noir brand layer (film grain, halftone, lime tape, flat hard shadows). Honours `prefers-reduced-motion` (the story becomes one still frame of the full maze).
- `assets/`: copies of files from `brand/` and `brand/mascot/` (the `zero-*.svg` poses). Re-copy them if the logo or mascot changes.

Why the page is built this way is recorded in the Unsold design doc (`Utility Apps/unsold/DESIGN.md`, §10).
