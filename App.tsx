import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Position, Rider, Entity, GridMode, Algorithm, Order, RiderStatus, OrderStatus } from './types';
import { GRID_ROWS, GRID_COLS, COLORS, DELAY_MS, COOKING_TIME_MS } from './constants';
import { findPath, getManhattanDistance } from './utils/pathfinding';
import { HomeIcon, HotelIcon, RiderIcon, WallIcon, SunIcon, MoonIcon } from './components/IconComponents';

const App: React.FC = () => {
  // --- State ---
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [walls, setWalls] = useState<Set<string>>(new Set());

  // Entities
  const [riders, setRiders] = useState<Rider[]>([]);
  const [hotels, setHotels] = useState<Entity[]>([]);
  const [homes, setHomes] = useState<Entity[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  // UI State
  const [mode, setMode] = useState<GridMode>('WALL');
  const [algorithm, setAlgorithm] = useState<Algorithm>('DIJKSTRA');
  const [orderStep, setOrderStep] = useState<'NONE' | 'SELECT_HOME' | 'SELECT_HOTEL'>('NONE');
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);

  // Stats & Visuals
  const [pathTrace, setPathTrace] = useState<Set<string>>(new Set());
  const [distanceTraveled, setDistanceTraveled] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>("Welcome! Add entities or start ordering.");

  // Refs for logic that needs latest state inside intervals without triggering re-renders
  const stateRef = useRef({
    riders,
    orders,
    hotels,
    homes,
    walls,
    algorithm
  });

  // Sync refs
  useEffect(() => {
    stateRef.current = { riders, orders, hotels, homes, walls, algorithm };
  }, [riders, orders, hotels, homes, walls, algorithm]);

  const countsRef = useRef({ riders: 1, hotels: 1, homes: 1 });

  // --- Theme Effect ---
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark');

  // --- Helpers ---
  const posKey = (p: Position) => `${p.r},${p.c}`;
  const isWall = (r: number, c: number) => walls.has(`${r},${c}`);

  const getEntityAt = (r: number, c: number) => {
    const rider = riders.find(e => e.pos.r === r && e.pos.c === c);
    if (rider) return rider;
    const hotel = hotels.find(e => e.pos.r === r && e.pos.c === c);
    if (hotel) return hotel;
    const home = homes.find(e => e.pos.r === r && e.pos.c === c);
    if (home) return home;
    return null;
  };

  // --- CORE LOGIC: The Game Loop ---
  useEffect(() => {
    const interval = setInterval(() => {
      handleSimulationTick();
    }, DELAY_MS);
    return () => clearInterval(interval);
  }, []);

  const handleSimulationTick = () => {
    const { riders, orders, hotels, homes, walls, algorithm } = stateRef.current;

    // 1. Update Cooking Timers
    let ordersChanged = false;
    const nextOrders = orders.map(o => {
      if (o.status === 'COOKING') {
        const newTime = Math.max(0, o.cookingTimeRemainingMs - DELAY_MS);
        if (newTime !== o.cookingTimeRemainingMs) ordersChanged = true;
        return {
          ...o,
          cookingTimeRemainingMs: newTime,
          status: newTime === 0 ? 'READY' : 'COOKING'
        } as Order;
      }
      return o;
    });

    if (ordersChanged) setOrders(nextOrders);

    // 2. Update Riders
    let ridersChanged = false;
    let pathTraceChanged = false;
    const nextPathTrace = new Set(pathTrace);

    const nextRiders = riders.map(rider => {
      // -- MOVEMENT --
      if (rider.pathQueue.length > 0) {
        let newAccumulator = rider.movementAccumulator + rider.speed;
        let currentPos = rider.pos;
        let currentPath = rider.pathQueue;
        let stepsMoved = 0;

        // Move as many steps as speed allows (or accumulate)
        while (newAccumulator >= 1 && currentPath.length > 0) {
          newAccumulator -= 1;
          const nextPos = currentPath[0];
          currentPath = currentPath.slice(1);
          currentPos = nextPos;
          stepsMoved++;

          pathTraceChanged = true;
          nextPathTrace.add(posKey(nextPos));
        }

        if (stepsMoved > 0) {
          ridersChanged = true;
          if (rider.status === 'DELIVERING' || rider.status === 'MOVING_TO_HOTEL') {
            setDistanceTraveled(d => d + stepsMoved);
          }
          return { ...rider, pos: currentPos, pathQueue: currentPath, movementAccumulator: newAccumulator };
        } else {
          // Only accumulator changed (rider moving slowly)
          // We must update state so the accumulator persists to next tick
          ridersChanged = true;
          return { ...rider, movementAccumulator: newAccumulator };
        }
      }

      // -- STATE MACHINE LOGIC (When Stopped) --

      // ARRIVED AT HOTEL
      if (rider.status === 'MOVING_TO_HOTEL' && rider.pathQueue.length === 0) {
        ridersChanged = true;
        return { ...rider, status: 'WAITING_FOR_FOOD' } as Rider;
      }

      // WAITING AT HOTEL
      if (rider.status === 'WAITING_FOR_FOOD') {
        // Check if ALL assigned orders are ready
        const myOrders = nextOrders.filter(o => rider.assignedOrderIds.includes(o.id));
        const allReady = myOrders.every(o => o.status === 'READY');

        if (allReady && myOrders.length > 0) {
          // OPTIMIZATION: Calculate best route to all homes
          // 1. Identify all home locations
          const homeTargets = myOrders.map(o => ({
            orderId: o.id,
            home: homes.find(h => h.id === o.homeId)!
          }));

          // 2. Solve TSP (Simple version for small N)
          // Start from current pos (Hotel)
          let currentPos = rider.pos;
          let calculatedPath: Position[] = [];
          const remainingTargets = [...homeTargets];

          // Greedy Nearest Neighbor approach for simplicity (optimal enough for city scale < 5 stops)
          while (remainingTargets.length > 0) {
            remainingTargets.sort((a, b) =>
              getManhattanDistance(currentPos, a.home.pos) - getManhattanDistance(currentPos, b.home.pos)
            );

            const nextTarget = remainingTargets.shift()!;
            const legPath = findPath(currentPos, nextTarget.home.pos, walls, algorithm);

            if (legPath) {
              // Add path (excluding start node to avoid stutter)
              calculatedPath = [...calculatedPath, ...legPath.slice(1)];
              currentPos = nextTarget.home.pos;
            }
          }

          ridersChanged = true;
          return {
            ...rider,
            status: 'DELIVERING',
            pathQueue: calculatedPath,
            targetEntityId: null // Clear target as we now have a complex path
          } as Rider;
        }
      }

      // DELIVERING
      if (rider.status === 'DELIVERING') {
        // Check if we are at any delivery location
        const myActiveOrders = nextOrders.filter(o => rider.assignedOrderIds.includes(o.id) && o.status !== 'DELIVERED');

        // Are we at a home?
        const deliveredOrder = myActiveOrders.find(o => {
          const h = homes.find(home => home.id === o.homeId);
          return h && h.pos.r === rider.pos.r && h.pos.c === rider.pos.c;
        });

        if (deliveredOrder) {
          // Mark order as delivered!
          // Note: We need to update ORDERS state here too, but we can't do it inside the map easily.
          // We'll dispatch a separate state update or handle it in the next tick. 
          // Ideally, handle it here by modifying the `nextOrders` reference we created above.
          const orderIdx = nextOrders.findIndex(o => o.id === deliveredOrder.id);
          if (orderIdx !== -1) {
            nextOrders[orderIdx] = { ...nextOrders[orderIdx], status: 'DELIVERED' };
            setOrders(nextOrders); // Immediate update for UI responsiveness
          }
        }

        // If path ended but we still have orders (maybe pathfinding failed?), or all done
        if (rider.pathQueue.length === 0) {
          const stillHasOrders = nextOrders.some(o => rider.assignedOrderIds.includes(o.id) && o.status !== 'DELIVERED');

          if (!stillHasOrders) {
            // Return to parking or Idle
            ridersChanged = true;
            return { ...rider, status: 'IDLE', assignedOrderIds: [], color: COLORS.RIDER_IDLE } as Rider;
          }
        }
      }

      return rider;
    });

    if (ridersChanged) setRiders(nextRiders);
    if (pathTraceChanged) setPathTrace(nextPathTrace);
  };

  // --- Actions ---

  const handleCellClick = (r: number, c: number) => {
    if (mode === 'ORDER') {
      handleOrderClick(r, c);
      return;
    }

    const key = `${r},${c}`;
    const existing = getEntityAt(r, c);

    // Wall Mode
    if (mode === 'WALL') {
      if (existing) return;
      setWalls(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }

    // Entity Placement
    if (existing) {
      if (mode === 'RIDER' && existing.type === 'RIDER') {
        setRiders(prev => prev.filter(x => x.id !== existing.id));
      } else if (mode === 'HOTEL' && existing.type === 'HOTEL') {
        setHotels(prev => prev.filter(x => x.id !== existing.id));
      } else if (mode === 'HOME' && existing.type === 'HOME') {
        setHomes(prev => prev.filter(x => x.id !== existing.id));
      }
      return;
    }

    if (isWall(r, c)) return;

    const pos = { r, c };
    const id = crypto.randomUUID();

    if (mode === 'RIDER') {
      setRiders(prev => [...prev, {
        id, type: 'RIDER', pos,
        status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null,
        label: `R${countsRef.current.riders++}`,
        color: COLORS.RIDER_IDLE,
        speed: 0.5 + Math.random(), // Random speed between 0.5 and 1.5
        movementAccumulator: 0
      }]);
    } else if (mode === 'HOTEL') {
      setHotels(prev => [...prev, {
        id, type: 'HOTEL', pos, label: `H${countsRef.current.hotels++}`,
        color: COLORS.HOTEL
      }]);
    } else if (mode === 'HOME') {
      setHomes(prev => [...prev, {
        id, type: 'HOME', pos, label: `D${countsRef.current.homes++}`,
        color: COLORS.HOME
      }]);
    }
  };

  const handleOrderClick = (r: number, c: number) => {
    // When ordering, we want to click on Homes and Hotels specifically.
    // getEntityAt returns the top-most entity (Riders), which might block the Hotel if the Rider is waiting there.
    // So we search the specific arrays directly.

    if (orderStep === 'SELECT_HOME') {
      const home = homes.find(h => h.pos.r === r && h.pos.c === c);
      if (home) {
        setSelectedHomeId(home.id);
        setOrderStep('SELECT_HOTEL');
        setStatusMessage(`Selected ${home.label}. Now select a Hotel.`);
      } else {
        setStatusMessage("Please select a valid Home location.");
      }
    } else if (orderStep === 'SELECT_HOTEL') {
      const hotel = hotels.find(h => h.pos.r === r && h.pos.c === c);
      if (hotel) {
        createOrder(selectedHomeId!, hotel.id);
        setOrderStep('SELECT_HOME'); // Keep allowing orders
        setSelectedHomeId(null);
        setStatusMessage("Order Placed! Select another Home or exit mode.");
      } else {
        setStatusMessage("Please select a valid Hotel.");
      }
    }
  };

  const createOrder = (homeId: string, hotelId: string) => {
    const home = homes.find(h => h.id === homeId);
    const hotel = hotels.find(h => h.id === hotelId);
    if (!home || !hotel) return;

    const newOrderId = crypto.randomUUID();
    const newOrder: Order = {
      id: newOrderId,
      homeId,
      hotelId,
      riderId: null,
      status: 'COOKING',
      cookingTimeRemainingMs: COOKING_TIME_MS,
      timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
    };

    // --- BATCHING & ASSIGNMENT LOGIC ---
    // 1. Check for Rider already at this Hotel or moving to it
    const existingRider = riders.find(r =>
      (r.status === 'MOVING_TO_HOTEL' || r.status === 'WAITING_FOR_FOOD') &&
      r.targetEntityId === hotelId
    );

    let assignedRiderId = null;

    if (existingRider) {
      // BATCH IT!
      assignedRiderId = existingRider.id;
      setStatusMessage(`Efficiency Check: Order batched with ${existingRider.label}!`);

      setRiders(prev => prev.map(r => {
        if (r.id === existingRider.id) {
          return {
            ...r,
            assignedOrderIds: [...r.assignedOrderIds, newOrderId],
            color: COLORS.RIDER_BUSY // Ensure they look busy
          };
        }
        return r;
      }));

    } else {
      // DISPATCH NEW RIDER
      // Find nearest IDLE rider
      const idleRiders = riders.filter(r => r.status === 'IDLE');

      if (idleRiders.length === 0) {
        setStatusMessage("No idle riders available. Order queued (Wait for updates feature).");
        // For this demo, we just add the order but don't assign. 
        // In a fuller version, we'd have a global unassigned queue.
        // But let's just force assign to random busy one or fail gracefully for now.
        setOrders(prev => [...prev, newOrder]);
        return;
      }

      idleRiders.sort((a, b) => getManhattanDistance(a.pos, hotel.pos) - getManhattanDistance(b.pos, hotel.pos));
      const chosenRider = idleRiders[0];
      assignedRiderId = chosenRider.id;

      // Calculate path to Hotel
      const pathToHotel = findPath(chosenRider.pos, hotel.pos, walls, algorithm);

      if (!pathToHotel) {
        setStatusMessage(`Error: ${chosenRider.label} cannot reach ${hotel.label}`);
        return;
      }

      setStatusMessage(`Dispatching ${chosenRider.label} to ${hotel.label}. Cooking started (15s).`);

      setRiders(prev => prev.map(r => {
        if (r.id === chosenRider.id) {
          return {
            ...r,
            status: 'MOVING_TO_HOTEL',
            targetEntityId: hotelId,
            assignedOrderIds: [newOrderId],
            pathQueue: pathToHotel.slice(1), // Remove current pos
            color: COLORS.RIDER_BUSY
          };
        }
        return r;
      }));
    }

    setOrders(prev => [...prev, { ...newOrder, riderId: assignedRiderId }]);
  };

  // --- Render Helpers ---

  const getOrderStatusColor = (status: OrderStatus) => {
    switch (status) {
      case 'COOKING': return 'text-amber-500';
      case 'READY': return 'text-green-500 font-bold';
      case 'DELIVERED': return 'text-slate-400 decoration-line-through';
    }
  };

  const clearAll = () => {
    setWalls(new Set());
    setRiders([]);
    setHotels([]);
    setHomes([]);
    setOrders([]);
    setPathTrace(new Set());
    setDistanceTraveled(0);
    setOrderStep('NONE');
    countsRef.current = { riders: 1, hotels: 1, homes: 1 };
    setStatusMessage("Grid cleared.");
  };

  const resetSimulation = () => {
    setOrders([]);
    setPathTrace(new Set());
    setDistanceTraveled(0);
    setRiders(prev => prev.map(r => ({
      ...r,
      status: 'IDLE',
      pathQueue: [],
      assignedOrderIds: [],
      targetEntityId: null,
      color: COLORS.RIDER_IDLE
    })));
    setStatusMessage("Simulation reset.");
  };

  // --- Initial Setup ---
  useEffect(() => {
    // Add default entities
    setRiders([
      { id: 'r1', type: 'RIDER', pos: { r: 2, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R1', color: COLORS.RIDER_IDLE, speed: 0.8, movementAccumulator: 0 },
      { id: 'r2', type: 'RIDER', pos: { r: 2, c: 4 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R2', color: COLORS.RIDER_IDLE, speed: 1.5, movementAccumulator: 0 }
    ]);
    setHotels([{ id: 'h1', type: 'HOTEL', pos: { r: 10, c: 10 }, label: 'H1', color: COLORS.HOTEL }]);
    setHomes([
      { id: 'd1', type: 'HOME', pos: { r: 18, c: 18 }, label: 'D1', color: COLORS.HOME },
      { id: 'd2', type: 'HOME', pos: { r: 18, c: 2 }, label: 'D2', color: COLORS.HOME }
    ]);
    countsRef.current = { riders: 3, hotels: 2, homes: 3 };
  }, []);


  const calculateEstimatedDeliveryTime = (order: Order) => {
    const rider = riders.find(r => r.id === order.riderId);
    const home = homes.find(h => h.id === order.homeId);
    const hotel = hotels.find(h => h.id === order.hotelId);

    if (!home || !hotel) return null;
    if (order.status === 'DELIVERED') return 0;
    if (!rider) return null; // Pending assignment

    // Calculate distances remaining

    let totalTicks = 0;

    // 1. Current Leg (Moving to Hotel or Delivering)
    if (rider.pathQueue.length > 0) {
      totalTicks += rider.pathQueue.length / rider.speed;
    }

    // 2. Cooking Wait
    if (order.status === 'COOKING') {
      const timeToArriveMs = (rider.pathQueue.length / rider.speed) * DELAY_MS;
      const cookingRem = order.cookingTimeRemainingMs;

      if (timeToArriveMs < cookingRem) {
        const waitMs = cookingRem - timeToArriveMs;
        totalTicks += waitMs / DELAY_MS;
      }
    }

    // 3. Next Leg (Hotel -> Home)
    if (rider.status !== 'DELIVERING') {
      const distHotelToHome = getManhattanDistance(hotel.pos, home.pos);
      totalTicks += distHotelToHome / rider.speed;
    }

    return Math.ceil((totalTicks * DELAY_MS) / 1000); // Seconds
  };

  return (
    <div className="min-h-screen transition-colors duration-300 bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100 flex flex-col items-center">

      {/* Header */}
      <header className="w-full bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 p-4 sticky top-0 z-50 shadow-lg transition-colors duration-300">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500 rounded-lg shadow-indigo-500/20 shadow-lg text-white">
              <RiderIcon />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400">
                LogiX Dispatch
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Smart Batching & Routing</p>
            </div>
          </div>

          <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-900/50 p-1.5 rounded-xl border border-slate-200 dark:border-slate-700/50">
            <div className="flex bg-white dark:bg-slate-800 rounded-lg p-1 mr-2 border border-slate-200 dark:border-slate-600">
              <button onClick={() => setAlgorithm('DIJKSTRA')} className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${algorithm === 'DIJKSTRA' ? 'bg-indigo-600 text-white' : 'text-slate-500'}`}>Dijkstra</button>
              <button onClick={() => setAlgorithm('GREEDY')} className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${algorithm === 'GREEDY' ? 'bg-pink-600 text-white' : 'text-slate-500'}`}>Greedy</button>
            </div>

            {(['WALL', 'RIDER', 'HOTEL', 'HOME'] as GridMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setOrderStep('NONE'); setStatusMessage(`Mode: Place ${m}`); }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${mode === m ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
              >
                {m.charAt(0) + m.slice(1).toLowerCase()}
              </button>
            ))}
            <button
              onClick={() => {
                if (homes.length === 0 || hotels.length === 0 || riders.length === 0) {
                  setStatusMessage("Need 1 Home, 1 Hotel, 1 Rider.");
                  return;
                }
                setMode('ORDER');
                setOrderStep('SELECT_HOME');
                setStatusMessage("Select a Home to deliver to.");
              }}
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${mode === 'ORDER' ? 'bg-emerald-600 text-white' : 'text-emerald-600 border border-emerald-200'}`}
            >
              <span>🛍️ Order</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
            <button onClick={resetSimulation} className="px-4 py-2 rounded-lg text-sm font-semibold text-amber-600 border border-amber-200">Reset</button>
            <button onClick={clearAll} className="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 border border-red-200">Clear</button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-6xl mx-auto p-6 flex flex-col items-center justify-start gap-6">

        {/* HUD */}
        <div className="flex flex-wrap gap-4 items-center justify-center w-full">
          <div className="bg-white dark:bg-slate-800 px-6 py-3 rounded-full flex items-center gap-3 shadow-lg border border-slate-200 dark:border-slate-700">
            <span className={`w-2 h-2 rounded-full animate-pulse ${mode === 'ORDER' ? 'bg-emerald-500' : 'bg-indigo-500'}`}></span>
            <span className="font-mono text-indigo-600 dark:text-indigo-200 font-medium">{statusMessage}</span>
          </div>
        </div>

        {/* Grid */}
        <div className="relative p-3 bg-slate-200 dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 overflow-hidden">
          <div
            className="grid gap-px bg-slate-300 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-700"
            style={{
              gridTemplateColumns: `repeat(${GRID_COLS}, 2rem)`,
              gridTemplateRows: `repeat(${GRID_ROWS}, 2rem)`
            }}
          >
            {Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, i) => {
              const r = Math.floor(i / GRID_COLS);
              const c = i % GRID_COLS;
              const key = `${r},${c}`;
              const entity = getEntityAt(r, c);
              const isW = isWall(r, c);
              const isPath = pathTrace.has(key);

              const isSelectedHome = entity?.id === selectedHomeId;

              // Dynamic Classes
              let cellClass = `w-8 h-8 flex items-center justify-center text-[10px] relative transition-all duration-300 cursor-pointer select-none `;

              if (isW) cellClass += COLORS.WALL;
              else if (isPath) cellClass += ` ${COLORS.PATH} z-10`;
              else cellClass += ` ${COLORS.EMPTY} hover:bg-slate-200 dark:hover:bg-slate-700`;

              if (isSelectedHome) cellClass += ` ${COLORS.HIGHLIGHT_HOME}`;

              return (
                <div
                  key={key}
                  className={cellClass}
                  onMouseDown={() => handleCellClick(r, c)}
                  onMouseEnter={(e) => { if (e.buttons === 1 && mode === 'WALL') handleCellClick(r, c); }}
                >
                  {isW && <WallIcon />}

                  {entity && (
                    <div className={`
                      w-7 h-7 rounded-md flex flex-col items-center justify-center shadow-lg transform transition-transform duration-300
                      ${entity.type === 'RIDER' ?
                        (entity as Rider).status === 'IDLE' ? COLORS.RIDER_IDLE :
                          (entity as Rider).status === 'WAITING_FOR_FOOD' ? COLORS.RIDER_WAITING : COLORS.RIDER_BUSY
                        : entity.color}
                      ${entity.type === 'RIDER' && !isPath ? 'scale-90 hover:scale-110' : ''}
                      ${entity.type === 'RIDER' ? 'rounded-full' : ''}
                    `}>
                      <span className="opacity-90 scale-75">
                        {entity.type === 'HOME' && <HomeIcon />}
                        {entity.type === 'HOTEL' && <HotelIcon />}
                        {entity.type === 'RIDER' && <RiderIcon />}
                      </span>
                      {entity.type === 'RIDER' && (entity as Rider).assignedOrderIds.length > 0 && (
                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] w-3 h-3 flex items-center justify-center rounded-full border border-white">
                          {(entity as Rider).assignedOrderIds.length}
                        </span>
                      )}
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] font-bold text-slate-100 bg-slate-900/90 px-1 rounded border border-slate-600/50 whitespace-nowrap z-20 pointer-events-none shadow-md">
                        {entity.label}
                      </span>
                    </div>
                  )}

                  {isPath && !entity && <div className="w-1.5 h-1.5 bg-pink-500/50 rounded-full"></div>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Order Log */}
        <div className="w-full bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-lg mt-2">
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
            <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <span>📋</span> Active Orders
            </h3>
          </div>
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-sm text-left text-slate-500 dark:text-slate-400">
              <thead className="text-xs text-slate-700 dark:text-slate-300 uppercase bg-slate-100 dark:bg-slate-700/50 sticky top-0">
                <tr>
                  <th className="px-6 py-3">Time</th>
                  <th className="px-6 py-3">Rider</th>
                  <th className="px-6 py-3">From</th>
                  <th className="px-6 py-3">To</th>
                  <th className="px-6 py-3 text-right">Cooking Time</th>
                  <th className="px-6 py-3 text-right">Est. Delivery</th>
                  <th className="px-6 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-8 text-center italic">No orders yet.</td></tr>
                ) : (
                  orders.slice().reverse().map((o) => {
                    const rider = riders.find(r => r.id === o.riderId);
                    const hotel = hotels.find(h => h.id === o.hotelId);
                    const home = homes.find(h => h.id === o.homeId);
                    return (
                      <tr key={o.id} className="bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                        <td className="px-6 py-4 font-mono">{o.timestamp}</td>
                        <td className="px-6 py-4 font-bold">{rider?.label || 'Pending'}</td>
                        <td className="px-6 py-4 text-amber-600">{hotel?.label}</td>
                        <td className="px-6 py-4 text-emerald-600">{home?.label}</td>
                        <td className="px-6 py-4 text-right font-mono">
                          {o.status === 'COOKING' ? (o.cookingTimeRemainingMs / 1000).toFixed(1) + 's' : '-'}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-indigo-600">
                          {calculateEstimatedDeliveryTime(o) !== null ? calculateEstimatedDeliveryTime(o) + 's' : '...'}
                        </td>
                        <td className={`px-6 py-4 text-right ${getOrderStatusColor(o.status)}`}>{o.status}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
};

export default App;