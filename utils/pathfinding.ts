import { GRID_ROWS, GRID_COLS } from '../constants';
import { Position, PathNode, Algorithm } from '../types';

const getNeighbors = (pos: Position): Position[] => {
  const neighbors: Position[] = [];
  const dirs = [
    { r: -1, c: 0 }, // Up
    { r: 1, c: 0 },  // Down
    { r: 0, c: -1 }, // Left
    { r: 0, c: 1 },  // Right
  ];

  for (const d of dirs) {
    const nr = pos.r + d.r;
    const nc = pos.c + d.c;
    if (nr >= 0 && nr < GRID_ROWS && nc >= 0 && nc < GRID_COLS) {
      neighbors.push({ r: nr, c: nc });
    }
  }
  return neighbors;
};

export const getManhattanDistance = (a: Position, b: Position) => {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
};

export const findPath = (
  start: Position,
  end: Position,
  walls: Set<string>,
  algorithm: Algorithm = 'DIJKSTRA'
): Position[] | null => {
  const queue: PathNode[] = [{ pos: start, distance: 0, parent: null }];
  const visited = new Set<string>();
  const startKey = `${start.r},${start.c}`;
  
  visited.add(startKey);

  while (queue.length > 0) {
    // Priority Queue Logic
    if (algorithm === 'GREEDY') {
      // Greedy Best-First Search: Sort by estimated distance to goal (heuristic)
      // It doesn't care about distance traveled so far.
      queue.sort((a, b) => {
        const hA = getManhattanDistance(a.pos, end);
        const hB = getManhattanDistance(b.pos, end);
        return hA - hB;
      });
    } else {
      // Dijkstra / BFS: Sort by actual distance traveled from start.
      // Guarantees shortest path for unweighted grids.
      queue.sort((a, b) => a.distance - b.distance);
    }

    const current = queue.shift()!;

    if (current.pos.r === end.r && current.pos.c === end.c) {
      const path: Position[] = [];
      let curr: PathNode | null = current;
      while (curr) {
        path.push(curr.pos);
        curr = curr.parent;
      }
      return path.reverse();
    }

    const neighbors = getNeighbors(current.pos);
    for (const neighbor of neighbors) {
      const key = `${neighbor.r},${neighbor.c}`;
      if (!visited.has(key) && !walls.has(key)) {
        visited.add(key);
        queue.push({
          pos: neighbor,
          distance: current.distance + 1,
          parent: current,
        });
      }
    }
  }
  return null;
};