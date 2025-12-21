import React, { useState } from 'react';
import { Algorithm } from '../types';
import { XIcon } from './IconComponents';

interface AlgorithmDocsProps {
    onClose: () => void;
}

type Tab = Algorithm | 'INTRO';

const AlgorithmDocs: React.FC<AlgorithmDocsProps> = ({ onClose }) => {
    const [activeTab, setActiveTab] = useState<Tab>('INTRO');

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/90 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-800 w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl border border-slate-700 overflow-hidden flex flex-col md:flex-row">

                {/* Sidebar Navigation */}
                <div className="w-full md:w-64 bg-slate-50 dark:bg-slate-900/50 border-r border-slate-200 dark:border-slate-700 p-4 flex flex-col gap-2 overflow-y-auto">
                    <div className="mb-6 px-2">
                        <h2 className="text-xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-600">
                            Algo Academy
                        </h2>
                        <p className="text-xs text-slate-500 font-medium">Interactive Guide</p>
                    </div>

                    <NavButton
                        active={activeTab === 'INTRO'}
                        onClick={() => setActiveTab('INTRO')}
                        icon="🎓"
                        label="Introduction"
                    />
                    <div className="h-px bg-slate-200 dark:bg-slate-700 my-2 mx-2"></div>
                    <NavButton
                        active={activeTab === 'DIJKSTRA'}
                        onClick={() => setActiveTab('DIJKSTRA')}
                        icon="🌊"
                        label="Dijkstra's Algo"
                        color="text-blue-500"
                    />
                    <NavButton
                        active={activeTab === 'GREEDY'}
                        onClick={() => setActiveTab('GREEDY')}
                        icon="🚀"
                        label="Greedy Best-First"
                        color="text-amber-500"
                    />
                    <NavButton
                        active={activeTab === 'ASTAR'}
                        onClick={() => setActiveTab('ASTAR')}
                        icon="⭐"
                        label="A* (A-Star)"
                        color="text-emerald-500"
                    />

                    <div className="mt-auto pt-4">
                        <button
                            onClick={onClose}
                            className="w-full py-3 px-4 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-bold hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors flex items-center gap-2 justify-center"
                        >
                            <XIcon className="w-5 h-5" /> Close
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-8 relative">
                    {activeTab === 'INTRO' && <IntroView setTab={setActiveTab} />}
                    {activeTab === 'DIJKSTRA' && <DijkstraView />}
                    {activeTab === 'GREEDY' && <GreedyView />}
                    {activeTab === 'ASTAR' && <AStarView />}
                </div>

            </div>
        </div>
    );
};

// --- Sub Components ---

const NavButton = ({ active, onClick, icon, label, color = "text-slate-700 dark:text-slate-200" }: any) => (
    <button
        onClick={onClick}
        className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 font-bold ${active
                ? 'bg-white dark:bg-slate-800 shadow-md ring-1 ring-slate-200 dark:ring-slate-700 scale-[1.02]'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800/50 opacity-70 hover:opacity-100'
            }`}
    >
        <span className="text-xl">{icon}</span>
        <span className={`text-sm ${active ? color : 'text-slate-500 dark:text-slate-400'}`}>{label}</span>
    </button>
);

const IntroView = ({ setTab }: { setTab: (t: Tab) => void }) => (
    <div className="max-w-3xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
        <div className="text-center space-y-4">
            <div className="text-6xl mb-4">🗺️</div>
            <h1 className="text-4xl font-black text-slate-800 dark:text-white">Pathfinding Visualized</h1>
            <p className="text-lg text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
                Welcome to the Algo Academy. Here we visualize how different algorithms solve the problem of finding the shortest path between two points so you can build better intuition.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card
                emoji="🌊"
                title="Dijkstra"
                desc="The meticulous explorer. Guarantees the shortest path but takes its time."
                onClick={() => setTab('DIJKSTRA')}
                color="bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
            />
            <Card
                emoji="🚀"
                title="Greedy"
                desc="The speed demon. Runs straight for the goal, but might get tricked."
                onClick={() => setTab('GREEDY')}
                color="bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
            />
            <Card
                emoji="⭐"
                title="A* Star"
                desc="The smart navigator. Combines speed and accuracy for the best result."
                onClick={() => setTab('ASTAR')}
                color="bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800"
            />
        </div>
    </div>
);

const Card = ({ emoji, title, desc, onClick, color }: any) => (
    <button onClick={onClick} className={`p-6 rounded-2xl border text-left transition-all hover:scale-105 active:scale-95 ${color}`}>
        <div className="text-4xl mb-3">{emoji}</div>
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{desc}</p>
    </button>
);

// --- Visual & Content Views ---

const DijkstraView = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
        <Header
            icon="🌊"
            title="Dijkstra's Algorithm"
            subtitle="The Guaranteed Shortest Path"
            color="text-blue-500"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-lg">
                <p>
                    Imagine you spill a bucket of water on the floor. The water spreads out <strong className="text-blue-500">uniformly in all directions</strong>.
                    This is exactly how Dijkstra works.
                </p>
                <p>
                    It explores the map layer by layer, checking every single neighbor before moving further out. Because it checks <em>everything</em> evenly, it is mathematically guaranteed to find the absolute shortest path.
                </p>

                <StatsBox
                    speed="Slow (Checks everything)"
                    optimality="Guaranteed Optimal"
                    analogy="Water Spreading"
                />
            </div>

            <div className="bg-slate-100 dark:bg-slate-900 rounded-2xl p-8 flex items-center justify-center aspect-square shadow-inner border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                {/* Abstract Animation: Expanding Circle */}
                <div className="absolute w-4 h-4 bg-blue-500 rounded-full z-10 animate-pulse"></div>
                <div className="absolute w-full h-full border-4 border-blue-500/30 rounded-full animate-[ping_4s_ease-out_infinite]"></div>
                <div className="absolute w-3/4 h-3/4 border-4 border-blue-500/40 rounded-full animate-[ping_4s_ease-out_infinite_1s]"></div>
                <div className="absolute w-1/2 h-1/2 border-4 border-blue-500/50 rounded-full animate-[ping_4s_ease-out_infinite_2s]"></div>
                <p className="absolute bottom-4 font-mono text-xs text-blue-500 font-bold uppercase tracking-widest">Uniform Expansion</p>
            </div>
        </div>
    </div>
);

const GreedyView = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
        <Header
            icon="🚀"
            title="Greedy Best-First"
            subtitle="The Fastest Route (Usually)"
            color="text-amber-500"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-lg">
                <p>
                    Greedy is like a <strong className="text-amber-500">heat-seeking missile</strong>. It only cares about one thing: "How close am I to the target?"
                </p>
                <p>
                    It always picks the neighbor that is physically closest to the destination, ignoring walls or obstacles until it hits them. It explores very few nodes (making it super fast), but it can easily get stuck in "U-shaped" traps or find a path that isn't actually the shortest.
                </p>

                <StatsBox
                    speed="Very Fast"
                    optimality="Not Guaranteed"
                    analogy="Heat-Seeking Missile"
                />
            </div>

            <div className="bg-slate-100 dark:bg-slate-900 rounded-2xl p-8 flex items-center justify-center aspect-square shadow-inner border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                {/* Abstract Animation: Focused Beam */}
                <div className="absolute w-4 h-4 bg-amber-500 rounded-full z-10 left-10"></div>
                <div className="absolute w-4 h-4 bg-red-500 rounded-full z-10 right-10"></div>

                {/* Arrows moving right */}
                <div className="flex gap-2 items-center absolute inset-0 justify-center">
                    <div className="w-40 h-2 bg-gradient-to-r from-amber-500/0 via-amber-500 to-amber-500/0 animate-[pulse_1s_infinite]"></div>
                    <div className="absolute right-1/4 text-4xl animate-[bounce_1s_infinite]">👉</div>
                </div>

                <p className="absolute bottom-4 font-mono text-xs text-amber-500 font-bold uppercase tracking-widest">Goal Oriented</p>
            </div>
        </div>
    </div>
);

const AStarView = () => (
    <div className="space-y-8 animate-in fade-in duration-500">
        <Header
            icon="⭐"
            title="A* (A-Star)"
            subtitle="The Smartest Choice"
            color="text-emerald-500"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            <div className="space-y-6 text-slate-700 dark:text-slate-300 leading-relaxed text-lg">
                <p>
                    A* is the <strong className="text-emerald-500">best of both worlds</strong>. It combines the water-like safety of Dijkstra with the missile-like focus of Greedy.
                </p>
                <p>
                    It considers TWO things: "How far have I walked?" (Dijkstra) AND "How far is the target?" (Greedy). This creates a smart search that feels like a focused beam or an ellipse stretching towards the goal. It is efficient and still guarantees the shortest path.
                </p>

                <StatsBox
                    speed="Fast (Efficient)"
                    optimality="Guaranteed Optimal"
                    analogy="Focused Beam / Ellipse"
                />
            </div>

            <div className="bg-slate-100 dark:bg-slate-900 rounded-2xl p-8 flex items-center justify-center aspect-square shadow-inner border border-slate-200 dark:border-slate-800 relative overflow-hidden">
                {/* Abstract Animation: Ellipse */}
                <div className="relative w-full h-full flex items-center justify-center">
                    <div className="absolute w-4 h-4 bg-emerald-500 rounded-full z-10"></div>
                    {/* An ellipses stretching towards right */}
                    <div className="absolute w-32 h-64 border-4 border-emerald-500/30 rounded-[100%] rotate-90 animate-[ping_3s_ease-out_infinite]"></div>
                    <div className="absolute w-24 h-48 border-4 border-emerald-500/50 rounded-[100%] rotate-90 animate-[ping_3s_ease-out_infinite_1s]"></div>
                </div>
                <p className="absolute bottom-4 font-mono text-xs text-emerald-500 font-bold uppercase tracking-widest">Directional + Safe</p>
            </div>
        </div>
    </div>
);

const Header = ({ icon, title, subtitle, color }: any) => (
    <div>
        <div className="flex items-center gap-4 mb-2">
            <span className="text-4xl">{icon}</span>
            <h2 className={`text-4xl font-black ${color}`}>{title}</h2>
        </div>
        <p className="text-xl text-slate-500 dark:text-slate-400 font-medium">{subtitle}</p>
    </div>
);

const StatsBox = ({ speed, optimality, analogy }: any) => (
    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl p-6 grid grid-cols-1 gap-4 mt-6">
        <div>
            <div className="text-xs uppercase font-bold text-slate-400 mb-1">Speed</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">{speed}</div>
        </div>
        <div>
            <div className="text-xs uppercase font-bold text-slate-400 mb-1">Optimality</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">{optimality}</div>
        </div>
        <div>
            <div className="text-xs uppercase font-bold text-slate-400 mb-1">Analogy</div>
            <div className="font-bold text-slate-800 dark:text-slate-200">{analogy}</div>
        </div>
    </div>
);

export default AlgorithmDocs;
