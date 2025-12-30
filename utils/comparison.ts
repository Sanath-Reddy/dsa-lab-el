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
    waypoints: Position[] = []
): ComparisonResult[] => {
    const results: ComparisonResult[] = [];
    const algorithms: Algorithm[] = ['DIJKSTRA', 'GREEDY', 'ASTAR'];

    algorithms.forEach(algo => {
        let fullPath: Position[] = [];
        let totalVisited = 0;
        let totalExecutionTime = 0;
        let allVisitedOrder: Position[] = [];
        let success = true;

        const points = [start, ...waypoints, end];

        for (let i = 0; i < points.length - 1; i++) {
            const p1 = points[i];
            const p2 = points[i + 1];
            const leg = findPath(p1, p2, walls, algo);

            if (leg) {
                // If not first leg, remove the first point to avoid duplicate in path
                fullPath = [...fullPath, ...(i === 0 ? leg.path : leg.path.slice(1))];
                totalVisited += leg.visitedCount;
                allVisitedOrder = [...allVisitedOrder, ...leg.visitedOrder];
                totalExecutionTime += leg.executionTime;
            } else {
                success = false;
                break;
            }
        }

        if (success) {
            results.push({
                algorithm: algo,
                metrics: {
                    path: fullPath,
                    visitedCount: totalVisited,
                    visitedOrder: allVisitedOrder,
                    executionTime: totalExecutionTime
                }
            });
        } else {
            results.push({ algorithm: algo, metrics: null });
        }
    });

    return results;
};
