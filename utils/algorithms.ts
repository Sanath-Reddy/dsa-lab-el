import { Position } from '../types';
import { getManhattanDistance } from './pathfinding';

// --- HUNGARIAN ALGORITHM SIMULATION (Greedy closest-first fallback for simplicity/demo if N is small) ---
// For a true O(n^3) implementation, we would need a substantial amount of code (augmenting paths, potential updates).
// Given the constraint of a React demo and complexity, we might implement a "Greedy Best Match" or a recursive Min-Cost matching which is optimal for small N (N<=4).
// Let's go with a Recursive Permutation Solver for N <= 5, which is definitively Optimal (like Hungarian) but simpler to code.
// For N > 5, we can fallback to Greedy.

export interface AssignmentResult {
    riderIndex: number;
    orderIndex: number;
    cost: number;
}

export const solveAssignment = (
    riderPositions: Position[],
    orderPositions: Position[]
): AssignmentResult[] => {
    const n = riderPositions.length;
    const m = orderPositions.length;

    // Calculate Cost Matrix
    const costMatrix: number[][] = [];
    for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let j = 0; j < m; j++) {
            row.push(getManhattanDistance(riderPositions[i], orderPositions[j]));
        }
        costMatrix.push(row);
    }

    // Solve for Min Cost (Optimal)
    // Using simple recursion for small N (Demo usually has 3-4 riders)

    let minTotalCost = Infinity;
    let bestAssignment: number[] = []; // index is rider, value is order

    const usedOrders = new Set<number>();

    const backtrack = (riderIdx: number, currentCost: number, currentAssignment: number[]) => {
        if (currentCost >= minTotalCost) return; // Pruning

        if (riderIdx === n) {
            if (currentCost < minTotalCost) {
                minTotalCost = currentCost;
                bestAssignment = [...currentAssignment];
            }
            return;
        }

        // Try assigning each available order to this rider
        let foundOption = false;
        for (let j = 0; j < m; j++) {
            if (!usedOrders.has(j)) {
                foundOption = true;
                usedOrders.add(j);
                currentAssignment[riderIdx] = j;
                backtrack(riderIdx + 1, currentCost + costMatrix[riderIdx][j], currentAssignment);
                usedOrders.delete(j);
            }
        }

        // If more riders than orders, this rider gets nothing (conceptually -1)
        if (!foundOption && n > m) {
            currentAssignment[riderIdx] = -1;
            backtrack(riderIdx + 1, currentCost, currentAssignment);
        }
    };

    backtrack(0, 0, new Array(n).fill(-1));

    // Convert to result format
    const results: AssignmentResult[] = [];
    for (let i = 0; i < n; i++) {
        const orderIdx = bestAssignment[i];
        if (orderIdx !== -1 && orderIdx !== undefined) {
            results.push({
                riderIndex: i,
                orderIndex: orderIdx,
                cost: costMatrix[i][orderIdx]
            });
        }
    }

    return results;
};


// --- TSP SOLVER ---

export const solveTSP = (
    start: Position,
    points: Position[],
    method: 'NAIVE' | 'GREEDY' | 'OPTIMAL'
): Position[] => {
    const allPoints = [start, ...points];
    // We want the path strictly visiting all 'points' starting from 'start'.

    if (method === 'NAIVE') {
        // Just return as is (random assumption)
        return points;
    }

    if (method === 'GREEDY') {
        const result: Position[] = [];
        const unvisited = [...points];
        let current = start;

        while (unvisited.length > 0) {
            unvisited.sort((a, b) => getManhattanDistance(current, a) - getManhattanDistance(current, b));
            const next = unvisited.shift()!;
            result.push(next);
            current = next;
        }
        return result;
    }

    if (method === 'OPTIMAL') {
        // Permutations for small N
        let minDist = Infinity;
        let bestPath: Position[] = [];

        const permute = (arr: Position[], m: Position[] = []) => {
            if (arr.length === 0) {
                // Calculate dist
                let d = 0;
                let curr = start;
                for (const p of m) {
                    d += getManhattanDistance(curr, p);
                    curr = p;
                }
                if (d < minDist) {
                    minDist = d;
                    bestPath = m;
                }
            } else {
                for (let i = 0; i < arr.length; i++) {
                    const curr = arr.slice();
                    const next = curr.splice(i, 1);
                    permute(curr.slice(), m.concat(next));
                }
            }
        };

        permute(points);
        return bestPath;
    }

    return points;
};
