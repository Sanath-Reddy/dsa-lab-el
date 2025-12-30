import React, { useState } from 'react';
import { Rider, Entity, Position } from '../types';
import { XIcon, PlayIcon, RiderIcon, HotelIcon, HomeIcon } from './IconComponents';

interface RouteBuilderProps {
    onClose: () => void;
    onStartRace: (start: Position, waypoints: Position[], end: Position) => void;
    riders: Rider[];
    hotels: Entity[];
    homes: Entity[];
}

const RouteBuilder: React.FC<RouteBuilderProps> = ({ onClose, onStartRace, riders, hotels, homes }) => {
    const [selectedRiderId, setSelectedRiderId] = useState<string>('');
    const [stops, setStops] = useState<{ hotelId: string; homeId: string }[]>([]);

    // Temporary selection state for adding a new stop
    const [tempHotelId, setTempHotelId] = useState<string>('');
    const [tempHomeId, setTempHomeId] = useState<string>('');

    const handleAddStop = () => {
        if (tempHotelId && tempHomeId) {
            setStops([...stops, { hotelId: tempHotelId, homeId: tempHomeId }]);
            setTempHotelId('');
            setTempHomeId('');
        }
    };

    const handleRemoveStop = (index: number) => {
        setStops(stops.filter((_, i) => i !== index));
    };

    const handleStart = () => {
        const rider = riders.find(r => r.id === selectedRiderId);
        if (!rider || stops.length === 0) return;

        // Construct Waypoints
        const waypoints: Position[] = [];

        // Add Hotel of first stop
        // If we support multiple stops, we add Hotel -> Home -> Hotel -> Home...
        // The LAST Home is the 'end'.
        // The 'waypoints' are everything BETWEEN Start(Rider) and End(Final Home).

        // Sequence: Rider -> Hotel1 -> Home1 -> Hotel2 -> Home2
        // Start: Rider
        // Waypoints: Hotel1, Home1, Hotel2 ...
        // End: Home2

        stops.forEach((stop, index) => {
            const hotel = hotels.find(h => h.id === stop.hotelId);
            const home = homes.find(h => h.id === stop.homeId);

            if (hotel && home) {
                waypoints.push(hotel.pos); // Always visit hotel first

                // If this is NOT the last stop, we must also visit the Home as a waypoint
                if (index < stops.length - 1) {
                    waypoints.push(home.pos);
                }
            }
        });

        const lastStop = stops[stops.length - 1];
        const lastHome = homes.find(h => h.id === lastStop.homeId);

        if (lastHome) {
            onStartRace(rider.pos, waypoints, lastHome.pos);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-800 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="p-4 bg-indigo-600 text-white flex justify-between items-center">
                    <h2 className="text-lg font-bold flex items-center gap-2">
                        <span>🗺️</span> Build Race Route
                    </h2>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 overflow-y-auto space-y-6">

                    {/* Step 1: Select Rider */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">1. Start Point (Rider)</label>
                        <div className="relative">
                            <select
                                value={selectedRiderId}
                                onChange={(e) => setSelectedRiderId(e.target.value)}
                                className="w-full p-3 bg-slate-50 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl appearance-none font-bold text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option value="">Select a Rider...</option>
                                {riders.map(r => (
                                    <option key={r.id} value={r.id}>{r.label} ({r.status})</option>
                                ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <RiderIcon />
                            </div>
                        </div>
                    </div>

                    {/* Step 2: Add Stops */}
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">2. Delivery Stops (Hotel ➔ Home)</label>

                        {/* Stops List */}
                        <div className="space-y-2 mb-4">
                            {stops.map((stop, i) => {
                                const h = hotels.find(x => x.id === stop.hotelId);
                                const d = homes.find(x => x.id === stop.homeId);
                                return (
                                    <div key={i} className="flex items-center gap-2 p-2 bg-slate-100 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600">
                                        <span className="w-6 h-6 flex items-center justify-center bg-slate-200 dark:bg-slate-600 rounded-full text-xs font-bold text-slate-500">{i + 1}</span>
                                        <div className="flex-1 flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                                            <span className="text-amber-500 flex items-center gap-1"><HotelIcon />{h?.label}</span>
                                            <span className="text-slate-400">➔</span>
                                            <span className="text-emerald-500 flex items-center gap-1"><HomeIcon />{d?.label}</span>
                                        </div>
                                        <button onClick={() => handleRemoveStop(i)} className="text-slate-400 hover:text-red-500 p-1">
                                            <XIcon className="w-4 h-4" />
                                        </button>
                                    </div>
                                );
                            })}
                            {stops.length === 0 && (
                                <div className="text-center p-4 border border-dashed border-slate-300 dark:border-slate-600 rounded-lg text-slate-400 text-sm">
                                    No stops added. Add a Delivery Leg below.
                                </div>
                            )}
                        </div>

                        {/* Add New Stop Form */}
                        <div className="p-3 bg-slate-50 dark:bg-slate-700/30 rounded-xl border border-slate-200 dark:border-slate-600">
                            <div className="flex gap-2 mb-2">
                                <div className="flex-1">
                                    <select
                                        value={tempHotelId}
                                        onChange={(e) => setTempHotelId(e.target.value)}
                                        className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700"
                                    >
                                        <option value="">Pickup (Hotel)...</option>
                                        {hotels.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                                    </select>
                                </div>
                                <div className="flex-1">
                                    <select
                                        value={tempHomeId}
                                        onChange={(e) => setTempHomeId(e.target.value)}
                                        className="w-full p-2 text-sm rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700"
                                    >
                                        <option value="">Dropoff (Home)...</option>
                                        {homes.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
                                    </select>
                                </div>
                            </div>
                            <button
                                onClick={handleAddStop}
                                disabled={!tempHotelId || !tempHomeId}
                                className="w-full py-2 bg-slate-200 dark:bg-slate-600 text-slate-700 dark:text-slate-200 font-bold rounded-lg hover:bg-indigo-100 hover:text-indigo-600 dark:hover:bg-indigo-900/50 dark:hover:text-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                            >
                                + Add Stop
                            </button>
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={handleStart}
                        disabled={!selectedRiderId || stops.length === 0}
                        className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                        <PlayIcon className="w-5 h-5" />
                        Start Race
                    </button>
                </div>

            </div>
        </div>
    );
};

export default RouteBuilder;
