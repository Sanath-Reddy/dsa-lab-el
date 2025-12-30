import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Position, Rider, Entity, GridMode, Algorithm, Order, RiderStatus, OrderStatus } from './types';
import { GRID_ROWS, GRID_COLS, COLORS, DELAY_MS, COOKING_TIME_MS } from './constants';
import { findPath, getManhattanDistance } from './utils/pathfinding';
import { solveAssignment, solveTSP } from './utils/algorithms';
import { compareAlgorithms, ComparisonResult } from './utils/comparison';
import AlgorithmRace from './components/AlgorithmRace';
import AlgorithmDocs from './components/AlgorithmDocs';
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

  // Comparison State
  const [showRace, setShowRace] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [raceParams, setRaceParams] = useState<{ start: Position, end: Position, intermediate?: Position } | null>(null);

  const [scenario, setScenario] = useState<'SANDBOX' | 'DEMO_ASTAR' | 'DEMO_HUNGARIAN' | 'DEMO_TSP'>('SANDBOX');

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
              calculatedPath = [...calculatedPath, ...legPath.path.slice(1)];
              currentPos = nextTarget.home.pos;
            }
          }

          // Mark pickup stats
          myOrders.forEach(o => {
            const idx = nextOrders.findIndex(no => no.id === o.id);
            if (idx !== -1) nextOrders[idx].pickupTime = Date.now();
          });

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

            // STATS
            if (nextOrders[orderIdx].pickupTime) {
              nextOrders[orderIdx].actualDeliveryTimeMs = Date.now() - nextOrders[orderIdx].pickupTime!;
            }
            const hotel = hotels.find(h => h.id === nextOrders[orderIdx].hotelId);
            const home = homes.find(h => h.id === nextOrders[orderIdx].homeId);
            if (hotel && home) {
              nextOrders[orderIdx].blocksCovered = getManhattanDistance(hotel.pos, home.pos);
            }

            setOrders(nextOrders); // Immediate update for UI responsiveness
          }
        }

        // If path ended but we still have orders (maybe pathfinding failed?), or all done
        if (rider.pathQueue.length === 0) {
          const stillHasOrders = nextOrders.some(o => rider.assignedOrderIds.includes(o.id) && o.status !== 'DELIVERED');

          if (!stillHasOrders) {
            // ALL DONE -> RETURN TO HOTEL
            // Find the hotel we came from (simplification: assume last order's hotel or find nearest)
            // We'll use the hotel from the last delivered rider's order
            const lastOrderId = rider.assignedOrderIds[rider.assignedOrderIds.length - 1];
            const lastOrder = nextOrders.find(o => o.id === lastOrderId);
            const hotelToReturnTo = hotels.find(h => h.id === lastOrder?.hotelId) || hotels[0]; // Fallback

            if (hotelToReturnTo) {
              const returnPath = findPath(rider.pos, hotelToReturnTo.pos, walls, algorithm);
              if (returnPath) {
                ridersChanged = true;
                return {
                  ...rider,
                  status: 'RETURNING',
                  encodedPathToHotel: null, // cleanup if needed
                  pathQueue: returnPath.path.slice(1),
                  targetEntityId: hotelToReturnTo.id,
                  color: COLORS.RIDER_IDLE // Or a specific returning color? Keep idle color for now or maybe yellow
                } as Rider;
              }
            }

            // If no path or no hotel, just IDLE
            ridersChanged = true;
            return { ...rider, status: 'IDLE', assignedOrderIds: [], color: COLORS.RIDER_IDLE } as Rider;
          }
        }
      }

      // RETURNING
      if (rider.status === 'RETURNING') {
        if (rider.pathQueue.length === 0) {
          ridersChanged = true;
          return {
            ...rider,
            status: 'IDLE',
            assignedOrderIds: [],
            targetEntityId: null,
            color: COLORS.RIDER_IDLE
          } as Rider;
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
    // 1. Check for Rider ALREADY ASSIGNED to this Hotel (Moving there or Waiting)
    const activeRidersForHotel = riders.filter(r =>
      (r.status === 'MOVING_TO_HOTEL' || r.status === 'WAITING_FOR_FOOD') &&
      r.targetEntityId === hotelId
    );

    let assignedRiderId = null;
    let bestRider = null;
    let minDetour = Infinity;

    // Smart Batching Heuristic:
    // Only batch if the new home is "close enough" to one of the intended destinations of the rider.
    // Threshold: e.g., 8 units Manhattan distance.
    const BATCH_DISTANCE_THRESHOLD = 8;

    for (const rider of activeRidersForHotel) {
      // distinct homes this rider is already visiting
      const riderOrderIds = rider.assignedOrderIds;
      const riderOrders = orders.filter(o => riderOrderIds.includes(o.id));

      // Find if any existing delivery destination is close to the NEW home
      for (const existingOrder of riderOrders) {
        const existingHome = homes.find(h => h.id === existingOrder.homeId);
        if (existingHome) {
          const dist = getManhattanDistance(existingHome.pos, home.pos);
          if (dist <= BATCH_DISTANCE_THRESHOLD) {
            // Found a good candidate!
            if (dist < minDetour) {
              minDetour = dist;
              bestRider = rider;
            }
          }
        }
      }
    }

    if (bestRider) {
      // EFFICIENT BATCH FOUND!
      assignedRiderId = bestRider.id;
      setStatusMessage(`Smart Batch: Assgn to ${bestRider.label} (Detour: ${minDetour})`);

      setRiders(prev => prev.map(r => {
        if (r.id === bestRider!.id) {
          return {
            ...r,
            assignedOrderIds: [...r.assignedOrderIds, newOrderId],
            color: COLORS.RIDER_BUSY
          };
        }
        return r;
      }));

    } else {
      // NO EFFICIENT BATCH -> DISPATCH NEW RIDER
      // Find nearest IDLE rider (or RETURNING rider could be re-routed, but let's stick to IDLE/RETURNING logic later if needed)
      // Actually, RETURNING riders are good candidates if they are close to Hotel!
      // For now, let's stick to IDLE riders as per standard request, or maybe check returning ones?
      // Let's stick to IDLE for simplicity and clarity of "new dispatch".

      const idleRiders = riders.filter(r => r.status === 'IDLE'); // Could also allow RETURNING riders to be re-tasked

      if (idleRiders.length === 0) {
        // FALLBACK: Forced Batching (if no idle riders, just give it to the first busy guy at the hotel, or ANY busy guy?)
        // Let's look for ANY rider moving to this hotel even if far, better than stalling.
        if (activeRidersForHotel.length > 0) {
          const fallbackRider = activeRidersForHotel[0];
          assignedRiderId = fallbackRider.id;
          setStatusMessage(`High Demand: Queued with ${fallbackRider.label}`);
          setRiders(prev => prev.map(r => {
            if (r.id === fallbackRider.id) {
              return { ...r, assignedOrderIds: [...r.assignedOrderIds, newOrderId] };
            }
            return r;
          }));
        } else {
          setStatusMessage("No riders available. Order queued.");
          setOrders(prev => [...prev, newOrder]);
          return;
        }
      } else {
        // NORMAL DISPATCH
        idleRiders.sort((a, b) => getManhattanDistance(a.pos, hotel.pos) - getManhattanDistance(b.pos, hotel.pos));
        const chosenRider = idleRiders[0];
        assignedRiderId = chosenRider.id;

        // Calculate path to Hotel
        const pathToHotel = findPath(chosenRider.pos, hotel.pos, walls, algorithm);

        if (!pathToHotel) {
          setStatusMessage(`Error: ${chosenRider.label} cannot reach ${hotel.label}`);
          return;
        }

        setStatusMessage(`Dispatching ${chosenRider.label} to ${hotel.label}.`);

        setRiders(prev => prev.map(r => {
          if (r.id === chosenRider.id) {
            return {
              ...r,
              status: 'MOVING_TO_HOTEL',
              targetEntityId: hotelId,
              assignedOrderIds: [newOrderId],
              pathQueue: pathToHotel.path.slice(1),
              color: COLORS.RIDER_BUSY
            };
          }
          return r;
        }));
      }
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

  const runDemo = (type: 'STANDARD_DIJKSTRA' | 'STANDARD_GREEDY' | 'STANDARD_ASTAR' | 'DEMO_BATCHING' | 'DEMO_ASSIGNMENT' | 'DEMO_TSP') => {
    // Handle Standard Modes which just set algo + standard map
    if (type.startsWith('STANDARD_')) {
      const algo = type.split('_')[1] as Algorithm;
      setAlgorithm(algo);
      setScenario('SANDBOX');
      setupStandardMap();
      setStatusMessage(`Standard Mode: ${algo}`);
      return;
    }

    clearAll();
    setScenario(type as any);

    if (type === 'DEMO_BATCHING') {
      // A* BATCHING DEMO
      // 1 Rider, 2 Hotels, 2 Homes
      // Show efficient path picking up from both
      setStatusMessage("DEMO: A* Smart Batching. 1 Rider, Multiple Orders.");
      const h1 = { id: 'h1', type: 'HOTEL', pos: { r: 5, c: 5 }, label: 'H1', color: COLORS.HOTEL };
      const h2 = { id: 'h2', type: 'HOTEL', pos: { r: 8, c: 8 }, label: 'H2', color: COLORS.HOTEL };
      setHotels([h1, h2]);

      const r1 = { id: 'r1', type: 'RIDER', pos: { r: 2, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R1', color: COLORS.RIDER_IDLE, speed: 1, movementAccumulator: 0 };
      setRiders([r1] as any); // cast for speed prop if needed, though updated types should be fine

      const d1 = { id: 'd1', type: 'HOME', pos: { r: 15, c: 15 }, label: 'D1', color: COLORS.HOME };
      const d2 = { id: 'd2', type: 'HOME', pos: { r: 16, c: 17 }, label: 'D2', color: COLORS.HOME };
      setHomes([d1, d2]);

      // Auto place orders after short delay
      setTimeout(() => {
        // We need to access stateRef or similar to place orders, but we can't inside here easily without re-render cycle.
        // We'll just define them.
        // For this demo, we can just let user place orders or use a "Start Demo" button. 
        // Let's just setup the board.
        setStatusMessage("Demo Loaded. Place two orders to see Batching!");
      }, 500);

    } else if (type === 'DEMO_ASSIGNMENT') {
      // MULTI AGENT
      setStatusMessage("DEMO: Multi-Agent Assignment. 3 Riders, 3 Homes. Click 'Auto Assign' (Coming Soon)!");
      // Setup 3 riders in a line
      setRiders([
        { id: 'r1', type: 'RIDER', pos: { r: 2, c: 5 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R1', color: COLORS.RIDER_IDLE, speed: 1, movementAccumulator: 0 },
        { id: 'r2', type: 'RIDER', pos: { r: 2, c: 10 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R2', color: COLORS.RIDER_IDLE, speed: 1, movementAccumulator: 0 },
        { id: 'r3', type: 'RIDER', pos: { r: 2, c: 15 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R3', color: COLORS.RIDER_IDLE, speed: 1, movementAccumulator: 0 }
      ]);
      setHotels([{ id: 'h1', type: 'HOTEL', pos: { r: 10, c: 10 }, label: 'HUB', color: COLORS.HOTEL }]);
      // No Homes yet, let user place them? Or preset?
      setHomes([
        { id: 'd1', type: 'HOME', pos: { r: 15, c: 5 }, label: 'D1', color: COLORS.HOME },
        { id: 'd2', type: 'HOME', pos: { r: 15, c: 10 }, label: 'D2', color: COLORS.HOME },
        { id: 'd3', type: 'HOME', pos: { r: 15, c: 15 }, label: 'D3', color: COLORS.HOME }
      ]);

    } else if (type === 'DEMO_TSP') {
      // TSP
      setStatusMessage("DEMO: Traveling Salesman. 1 Rider, 8 Homes. Click 'Solve TSP'!");
      setRiders([
        { id: 'r1', type: 'RIDER', pos: { r: 10, c: 10 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'TSP-R', color: COLORS.RIDER_IDLE, speed: 2, movementAccumulator: 0 }
      ]);
      setHotels([{ id: 'h1', type: 'HOTEL', pos: { r: 10, c: 10 }, label: 'HUB', color: COLORS.HOTEL }]); // Start/End

      // Random scatter 8 homes
      const demoHomes = [];
      for (let i = 0; i < 8; i++) {
        let r = Math.floor(Math.random() * (GRID_ROWS - 2)) + 1;
        let c = Math.floor(Math.random() * (GRID_COLS - 2)) + 1;
        demoHomes.push({ id: `d${i}`, type: 'HOME', pos: { r, c }, label: `${i + 1}`, color: COLORS.HOME });
      }
      setHomes(demoHomes as any);
    }
  };

  const setupStandardMap = () => {
    clearAll();
    setStatusMessage("Standard Map Loaded.");

    // Create a balanced city layout
    setHotels([
      { id: 'h1', type: 'HOTEL', pos: { r: 5, c: 5 }, label: 'H1', color: COLORS.HOTEL },
      { id: 'h2', type: 'HOTEL', pos: { r: 15, c: 15 }, label: 'H2', color: COLORS.HOTEL }
    ]);

    setRiders([
      { id: 'r1', type: 'RIDER', pos: { r: 2, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R1', color: COLORS.RIDER_IDLE, speed: 0.8, movementAccumulator: 0 },
      { id: 'r2', type: 'RIDER', pos: { r: 2, c: 18 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R2', color: COLORS.RIDER_IDLE, speed: 1.2, movementAccumulator: 0 },
      { id: 'r3', type: 'RIDER', pos: { r: 18, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R3', color: COLORS.RIDER_IDLE, speed: 1.0, movementAccumulator: 0 }
    ]);

    setHomes([
      { id: 'd1', type: 'HOME', pos: { r: 2, c: 10 }, label: 'D1', color: COLORS.HOME },
      { id: 'd2', type: 'HOME', pos: { r: 10, c: 2 }, label: 'D2', color: COLORS.HOME },
      { id: 'd3', type: 'HOME', pos: { r: 10, c: 18 }, label: 'D3', color: COLORS.HOME },
      { id: 'd4', type: 'HOME', pos: { r: 18, c: 10 }, label: 'D4', color: COLORS.HOME },
      { id: 'd5', type: 'HOME', pos: { r: 8, c: 8 }, label: 'D5', color: COLORS.HOME }
    ]);

    countsRef.current = { riders: 4, hotels: 3, homes: 6 };
  };

  // --- Initial Setup ---
  useEffect(() => {
    setupStandardMap();
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

  const handleAutoOrder = () => {
    if (homes.length === 0 || hotels.length === 0) {
      setStatusMessage("No Homes or Hotels to order from!");
      return;
    }
    const randomHome = homes[Math.floor(Math.random() * homes.length)];
    const randomHotel = hotels[Math.floor(Math.random() * hotels.length)];
    createOrder(randomHome.id, randomHotel.id);
    setStatusMessage(`Auto-Order: ${randomHotel.label} -> ${randomHome.label}`);
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
            {/* Consolidated Simulation Controller */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-800 rounded-lg p-1.5 border border-slate-200 dark:border-slate-600">
              <span className="text-xs font-bold text-slate-500 ml-2">Algorithm:</span>
              <select
                className="bg-transparent text-sm font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
                value={scenario === 'SANDBOX' ? `STANDARD_${algorithm}` : scenario}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val.startsWith('STANDARD_')) {
                    const algo = val.split('_')[1] as Algorithm;

                    if (scenario !== 'SANDBOX') {
                      // Switching from Demo to Standard -> Load Default Map
                      setScenario('SANDBOX');
                      setAlgorithm(algo);
                      setupStandardMap();
                      setStatusMessage(`Map Loaded: ${algo} Mode`);
                    } else {
                      setAlgorithm(algo);
                      setStatusMessage(`Algorithm switched to ${algo}`);
                    }
                  } else {
                    runDemo(val as any);
                  }
                }}
              >
                <optgroup label="Visualize Pathfinding">
                  <option value="STANDARD_DIJKSTRA">Dijkstra's Algorithm</option>
                  <option value="STANDARD_GREEDY">Greedy Best-First</option>
                  <option value="STANDARD_ASTAR">A* (A-Star) Search</option>
                </optgroup>

              </select>
            </div>

            <button
              onClick={() => setShowDocs(true)}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all bg-sky-500 text-white shadow-md hover:bg-sky-600 hover:scale-105 active:scale-95"
            >
              <span>📚 Learn Algos</span>
            </button>
            <div className="h-8 w-px bg-slate-300 dark:bg-slate-600 mx-2"></div>

            <button
              onClick={() => {
                if (homes.length < 1 || riders.length < 1) {
                  setStatusMessage("Place Rider & Home first!");
                  return;
                }
                // Run Benchmark on random pair or first available
                // Ideally, let's use the first rider and first home to keep it simple, or last order
                const r = riders[0];
                const h = homes[0];
                // Simple heuristic: Use the first hotel as intermediate if available
                const hotel = hotels[0];

                if (!r || !h) return;

                setRaceParams({ start: r.pos, end: h.pos, intermediate: hotel ? hotel.pos : undefined });
                setShowRace(true);
              }}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all bg-amber-500 text-white shadow-md hover:bg-amber-600 hover:scale-105 active:scale-95"
            >
              <span>⚖️ Compare Algorithms</span>
            </button>

            <button
              onClick={handleAutoOrder}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all bg-indigo-600 text-white shadow-md hover:bg-indigo-700 hover:scale-105 active:scale-95"
            >
              <span>🚀 Auto Assign Order</span>
            </button>

            {/* Manual Placement Tools */}
            <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700/50 rounded-lg p-1 mx-2">
              {(['WALL', 'RIDER', 'HOTEL', 'HOME'] as GridMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setOrderStep('NONE'); setStatusMessage(`Mode: Place ${m}`); }}
                  className={`p-2 rounded-md transition-all ${mode === m ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  title={`Place ${m}`}
                >
                  {m === 'WALL' && <WallIcon />}
                  {m === 'RIDER' && <RiderIcon />}
                  {m === 'HOTEL' && <HotelIcon />}
                  {m === 'HOME' && <HomeIcon />}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                if (homes.length === 0 || hotels.length === 0 || riders.length === 0) {
                  setStatusMessage("Need entities to order.");
                  return;
                }
                setMode('ORDER');
                setOrderStep('SELECT_HOME');
                setStatusMessage("Manual: Select a Home");
              }}
              className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-all ${mode === 'ORDER' ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'text-slate-500 border-transparent hover:bg-slate-200'}`}
            >
              <span>� Manual</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</button>
            <button onClick={setupStandardMap} className="px-4 py-2 rounded-lg text-sm font-semibold text-amber-600 border border-amber-200">Reset</button>
            <button onClick={clearAll} className="px-4 py-2 rounded-lg text-sm font-semibold text-red-600 border border-red-200">Clear</button>
          </div>
        </div>
      </header>

      {/* Race Modal */}
      {showRace && raceParams && (
        <AlgorithmRace
          start={raceParams.start}
          end={raceParams.end}
          intermediate={raceParams.intermediate}
          walls={walls}
          onClose={() => setShowRace(false)}
        />
      )}

      {showDocs && <AlgorithmDocs onClose={() => setShowDocs(false)} />}

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
                  <th className="px-6 py-3 text-right">Distance</th>
                  <th className="px-6 py-3 text-right">Time Taken</th>
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
                          {o.blocksCovered ? `${o.blocksCovered} blk` : '-'}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-purple-600 font-bold">
                          {o.actualDeliveryTimeMs ? `${(o.actualDeliveryTimeMs / 1000).toFixed(1)}s` : '-'}
                        </td>
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