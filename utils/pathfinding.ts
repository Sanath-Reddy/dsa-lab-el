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

export interface PathResult {
  path: Position[];
  visitedCount: number;
  visitedOrder: Position[];
  executionTime: number;
}

export const findPath = (
  start: Position,
  end: Position,
  walls: Set<string>,
  algorithm: Algorithm = 'DIJKSTRA'
): PathResult | null => {
  const startTime = performance.now();
  const queue: PathNode[] = [{ pos: start, distance: 0, parent: null }];
  const visited = new Set<string>();
  const visitedOrder: Position[] = [];
  const startKey = `${start.r},${start.c}`;
  let visitedCount = 0;

  visited.add(startKey);
  visitedOrder.push(start);

  while (queue.length > 0) {
    // Priority Queue Logic
    if (algorithm === 'GREEDY') {
      queue.sort((a, b) => {
        const hA = getManhattanDistance(a.pos, end);
        const hB = getManhattanDistance(b.pos, end);
        return hA - hB;
      });
    } else if (algorithm === 'ASTAR') {
      queue.sort((a, b) => {
        const fA = a.distance + getManhattanDistance(a.pos, end);
        const fB = b.distance + getManhattanDistance(b.pos, end);
        return fA - fB;
      });
    } else {
      // Dijkstra / BFS
      queue.sort((a, b) => a.distance - b.distance);
    }

    const current = queue.shift()!;
    visitedCount++;

    if (current.pos.r === end.r && current.pos.c === end.c) {
      const path: Position[] = [];
      let curr: PathNode | null = current;
      while (curr) {
        path.push(curr.pos);
        curr = curr.parent;
      }
      const endTime = performance.now();
      return {
        path: path.reverse(),
        visitedCount,
        visitedOrder,
        executionTime: endTime - startTime
      };
    }

    const neighbors = getNeighbors(current.pos);
    for (const neighbor of neighbors) {
      const key = `${neighbor.r},${neighbor.c}`;
      if (!visited.has(key) && !walls.has(key)) {
        visited.add(key);
        visitedOrder.push(neighbor);
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