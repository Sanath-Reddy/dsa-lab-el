import { Position, Algorithm } from '../types';
import { findPath, PathResult } from './pathfinding';

export interface ComparisonResult {
    algorithm: Algorithm;
    metrics: PathResult | null;
}

export const compareAlgorithms = (
    start: Position,
    end: Position,
    walls: Set<string>,
    intermediate?: Position
): ComparisonResult[] => {
    const results: ComparisonResult[] = [];
    const algorithms: Algorithm[] = ['DIJKSTRA', 'GREEDY', 'ASTAR'];

    algorithms.forEach(algo => {
        if (intermediate) {
            // Leg 1: Start -> Intermediate
            const leg1 = findPath(start, intermediate, walls, algo);
            // Leg 2: Intermediate -> End
            const leg2 = findPath(intermediate, end, walls, algo);

            if (leg1 && leg2) {
                // Merge Results
                results.push({
                    algorithm: algo,
                    metrics: {
                        path: [...leg1.path, ...leg2.path.slice(1)], // Join paths
                        visitedCount: leg1.visitedCount + leg2.visitedCount,
                        visitedOrder: [...leg1.visitedOrder, ...leg2.visitedOrder],
                        executionTime: leg1.executionTime + leg2.executionTime
                    }
                });
            } else {
                results.push({ algorithm: algo, metrics: null });
            }
        } else {
            // Direct Route
            const res = findPath(start, end, walls, algo);
            results.push({
                algorithm: algo,
                metrics: res
            });
        }
    });

    return results;
};
