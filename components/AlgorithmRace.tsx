import React, { useState, useEffect, useRef } from 'react';
import { Position, Algorithm } from '../types';
import { PathResult } from '../utils/pathfinding';
import { compareAlgorithms, ComparisonResult } from '../utils/comparison';
import { XIcon, PlayIcon } from './IconComponents';
import { COLORS } from '../constants';

interface AlgorithmRaceProps {
    onClose: () => void;
    start: Position;
    end: Position;
    waypoints?: Position[];
    walls: Set<string>;
}

const GRID_SIZE = 20; // 20x20 grid for local rendering

const AlgorithmRace: React.FC<AlgorithmRaceProps> = ({ onClose, start, end, walls, waypoints = [] }) => {
    const [results, setResults] = useState<ComparisonResult[] | null>(null);
    const [animationSteps, setAnimationSteps] = useState<number>(0);
    const [isFinished, setIsFinished] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const animationRef = useRef<number>();

    // Prepare Data
    useEffect(() => {
        // Run comparison immediately to get data
        const res = compareAlgorithms(start, end, walls, waypoints);
        setResults(res);
        // Find max steps needed
        const max = Math.max(...res.map(r => r.metrics?.visitedOrder.length || 0));
        setAnimationSteps(0);
        setIsPlaying(true);
    }, [start, end, walls, waypoints]);

    // Animation Loop
    useEffect(() => {
        if (!isPlaying || !results) return;

        const maxSteps = Math.max(...results.map(r => r.metrics?.visitedOrder.length || 0));
        // Target: ~10 seconds @ 60fps = 600 frames
        const durationFrames = 60 * 10;
        const speed = Math.max(0.05, maxSteps / durationFrames);

        const animate = () => {
            setAnimationSteps(prev => {
                const next = prev + speed;
                if (next >= maxSteps + 20) { // +20 for pause at end
                    setIsFinished(true);
                    setIsPlaying(false);
                    return maxSteps + 20;
                }
                return next;
            });
            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(animationRef.current!);
    }, [isPlaying, results]);

    // Render Canvases
    useEffect(() => {
        if (!results) return;

        results.forEach((res, index) => {
            const canvas = canvasRefs.current[index];
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            const W = canvas.width;
            const H = canvas.height;
            const rows = 20; // Assumption or pass in? Let's use 20 for now. 
            // Actually we need global grid size? 
            // Let's assume passed in Walls fit in 20x20 or scale it?
            // For now, let's use fixed 20x20 since App uses 20x20.
            const CELL_SIZE = W / rows;

            // Clear
            ctx.clearRect(0, 0, W, H);

            // Draw Grid
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 0.5;
            for (let i = 0; i <= rows; i++) {
                ctx.beginPath(); ctx.moveTo(0, i * CELL_SIZE); ctx.lineTo(W, i * CELL_SIZE); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(i * CELL_SIZE, 0); ctx.lineTo(i * CELL_SIZE, H); ctx.stroke();
            }

            // Draw Walls
            ctx.fillStyle = '#334155';
            walls.forEach(w => {
                const [r, c] = w.split(',').map(Number);
                ctx.fillRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE);
            });

            // Draw Start/Intermediate/End
            const drawPoint = (p: Position, color: string) => {
                ctx.fillStyle = color;
                ctx.beginPath(); ctx.arc(p.c * CELL_SIZE + CELL_SIZE / 2, p.r * CELL_SIZE + CELL_SIZE / 2, CELL_SIZE / 3, 0, Math.PI * 2); ctx.fill();
            };

            drawPoint(start, COLORS.RIDER_IDLE);
            drawPoint(end, COLORS.HOME);
            waypoints.forEach(wp => {
                ctx.fillStyle = COLORS.HOTEL;
                ctx.fillRect(wp.c * CELL_SIZE + 2, wp.r * CELL_SIZE + 2, CELL_SIZE - 4, CELL_SIZE - 4);
            });

            if (!res.metrics) return;

            // Draw Visited Nodes based on animationSteps
            const visitedToShow = res.metrics.visitedOrder.slice(0, animationSteps);

            visitedToShow.forEach((pos, idx) => {
                if (idx === 0) return; // Skip start
                ctx.fillStyle = idx === visitedToShow.length - 1 ? '#bfdbfe' : '#dbeafe'; // Head darker
                ctx.fillRect(pos.c * CELL_SIZE + 1, pos.r * CELL_SIZE + 1, CELL_SIZE - 2, CELL_SIZE - 2);
            });

            // Draw Final Path if finished scanning or found
            // Check if this algorithm has finished searching (visitedCount <= animationSteps)
            if (res.metrics.visitedOrder.length <= animationSteps) {
                ctx.strokeStyle = '#22c55e'; // Green
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                res.metrics.path.forEach((p, idx) => {
                    const x = p.c * CELL_SIZE + CELL_SIZE / 2;
                    const y = p.r * CELL_SIZE + CELL_SIZE / 2;
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.stroke();
            }
        });

    }, [results, animationSteps, walls, start, end]);

    return (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-start bg-slate-900/95 backdrop-blur-md p-6 overflow-y-auto animate-in fade-in duration-300 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">

            <div className="w-full max-w-6xl flex justify-between items-center mb-6 text-white">
                <div>
                    <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500">
                        ALGORITHM RACE
                    </h1>
                    <p className="text-slate-400 text-sm font-medium">
                        {waypoints.length > 0 ? "Multi-Stop Delivery Route" : "Direct Path: Point A ➔ Point B"}
                    </p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <XIcon className="w-8 h-8" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-6xl">
                {results?.map((res, idx) => (
                    <div key={res.algorithm} className={`relative flex flex-col bg-slate-800 rounded-2xl overflow-hidden shadow-2xl border-2 ${isFinished && res.metrics ? 'border-emerald-500/50' : 'border-slate-700'}`}>
                        {/* Header */}
                        <div className="p-3 bg-slate-900/50 border-b border-slate-700 flex justify-between items-center">
                            <span className="font-bold text-white tracking-wide">{res.algorithm}</span>
                            {res.metrics && animationSteps >= res.metrics.visitedOrder.length && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">DONE</span>
                            )}
                        </div>

                        {/* Canvas Container */}
                        <div className="relative aspect-square w-full bg-slate-900">
                            <canvas
                                ref={el => canvasRefs.current[idx] = el}
                                width={400}
                                height={400}
                                className="w-full h-full"
                            />

                            {/* Floating Stats Card (Only shows when finished) */}
                            {isFinished && (
                                <div className="absolute bottom-4 left-4 right-4 bg-slate-800/90 backdrop-blur border border-slate-600 p-3 rounded-xl shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-500">
                                    <div className="grid grid-cols-2 gap-4 text-center">
                                        <div>
                                            <div className="text-[10px] uppercase text-slate-400 font-bold mb-0.5">Visits</div>
                                            <div className="text-xl font-bold text-white">{res.metrics?.visitedCount}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px] uppercase text-slate-400 font-bold mb-0.5">Path</div>
                                            <div className="text-xl font-bold text-emerald-400">{res.metrics?.path.length}</div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Final Stats Section (Inline) */}
            {isFinished && results && (
                <div className="w-full max-w-6xl mt-8 animate-in slide-in-from-bottom-8 duration-500 pb-12">
                    <div className="bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-700 p-8 w-full">
                        <h2 className="text-2xl font-black text-slate-800 dark:text-white mb-6 flex items-center gap-3">
                            🏆 Race Results
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {results.map((res, i) => {
                                const isFastest = res.metrics && results.every(r => (r.metrics?.visitedCount || Infinity) >= res.metrics!.visitedCount);
                                const isShortest = res.metrics && results.every(r => (r.metrics?.path.length || Infinity) >= res.metrics!.path.length);

                                return (
                                    <div key={i} className={`p-4 rounded-xl border ${isFastest || isShortest ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-500/30' : 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600'}`}>
                                        <div className="flex justify-between items-start mb-2">
                                            <h3 className="font-bold text-lg text-slate-700 dark:text-slate-200">{res.algorithm}</h3>
                                            <div className="flex flex-col gap-1 items-end">
                                                {isFastest && <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Most Efficient</span>}
                                                {isShortest && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Optimal Path</span>}
                                            </div>
                                        </div>

                                        <div className="space-y-2 mt-4">
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-500 dark:text-slate-400">Nodes Explored:</span>
                                                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{res.metrics?.visitedCount}</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-500 dark:text-slate-400">Total Path:</span>
                                                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{res.metrics?.path.length} blocks</span>
                                            </div>
                                            <div className="flex justify-between text-sm">
                                                <span className="text-slate-500 dark:text-slate-400">Time:</span>
                                                <span className="font-mono font-bold text-slate-700 dark:text-slate-200">{res.metrics?.executionTime.toFixed(2)}ms</span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="mt-8 flex justify-center gap-4">
                            <button
                                onClick={() => { setAnimationSteps(0); setIsPlaying(true); setIsFinished(false); }}
                                className="px-6 py-3 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white font-bold rounded-xl hover:bg-slate-300 dark:hover:bg-slate-600 transition-all flex items-center gap-2"
                            >
                                <PlayIcon className="w-5 h-5" /> Replay Race
                            </button>
                            <button
                                onClick={onClose}
                                className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 transition-all"
                            >
                                Close Results
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default AlgorithmRace;
