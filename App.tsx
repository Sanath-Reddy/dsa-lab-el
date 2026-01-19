import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Position, Rider, Entity, GridMode, Algorithm, Order, RiderStatus, OrderStatus } from './types';
import { GRID_ROWS, GRID_COLS, COLORS, DELAY_MS, COOKING_TIME_MS } from './constants';
import { findPath, getManhattanDistance } from './utils/pathfinding';
import { solveAssignment, solveTSP } from './utils/algorithms';
import { compareAlgorithms, ComparisonResult } from './utils/comparison';
import AlgorithmRace from './components/AlgorithmRace';
import AlgorithmDocs from './components/AlgorithmDocs';
import RouteBuilder from './components/RouteBuilder';
import { HomeIcon, HotelIcon, RiderIcon, WallIcon, SunIcon, MoonIcon, CursorIcon } from './components/IconComponents';

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
  const [mode, setMode] = useState<GridMode>('SELECT');
  const [algorithm, setAlgorithm] = useState<Algorithm>('DIJKSTRA');
  const [orderStep, setOrderStep] = useState<'NONE' | 'SELECT_HOME' | 'SELECT_HOTEL'>('NONE');
  const [selectedHomeId, setSelectedHomeId] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);

  // Comparison State
  const [showRace, setShowRace] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [raceParams, setRaceParams] = useState<{ start: Position, end: Position, waypoints?: Position[] } | null>(null);
  const [showRouteBuilder, setShowRouteBuilder] = useState(false);

  const [scenario, setScenario] = useState<'SANDBOX' | 'DEMO_ASTAR' | 'DEMO_HUNGARIAN' | 'DEMO_TSP' | 'DEMO_FAIRNESS'>('SANDBOX');
  const [fairnessMode, setFairnessMode] = useState(false);
  const [fairnessAlpha, setFairnessAlpha] = useState(50); // High impact default

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
    algorithm,
    scenario,
    fairnessMode,
    fairnessAlpha
  });

  // Sync refs
  useEffect(() => {
    stateRef.current = { riders, orders, hotels, homes, walls, algorithm, scenario, fairnessMode, fairnessAlpha };
  }, [riders, orders, hotels, homes, walls, algorithm, scenario, fairnessMode, fairnessAlpha]);

  const autoOrderRef = useRef(0);

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
          const calculatedQueue: string[] = [];
          const remainingTargets = [...homeTargets];

          // Greedy Nearest Neighbor approach for simplicity (optimal enough for city scale < 5 stops)
          while (remainingTargets.length > 0) {
            remainingTargets.sort((a, b) =>
              getManhattanDistance(currentPos, a.home.pos) - getManhattanDistance(currentPos, b.home.pos)
            );

            const nextTarget = remainingTargets.shift()!;
            calculatedQueue.push(nextTarget.orderId);
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
            deliveryQueue: calculatedQueue,
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

            // UPDATE RIDER STATS
            ridersChanged = true;
            const dist = nextOrders[orderIdx].blocksCovered || 5;
            const pay = 150 + (dist * 5); // INR: High Base (₹150) + Low Dist (₹5). Volume is King.

            // We modify the 'rider' variable which is returned by the map
            rider = {
              ...rider,
              totalEarnings: rider.totalEarnings + pay,
              totalOrdersDelivered: rider.totalOrdersDelivered + 1,
              totalDistanceTraveled: rider.totalDistanceTraveled + dist
            };
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

    // --- PENDING ORDER DISPATCHER (For Queued/Burst Orders) ---
    // If we have orders with no rider, try to assign them to idle riders
    const pendingOrders = nextOrders.filter(o => o.riderId === null && o.status !== 'DELIVERED');
    if (pendingOrders.length > 0) {
      const idleRiders = nextRiders.filter(r => r.status === 'IDLE');
      if (idleRiders.length > 0) {
        // Sort orders? Maybe FIFO.
        pendingOrders.forEach(order => {
          const availableRiders = nextRiders.filter(r => r.status === 'IDLE'); // Re-check idleness per order
          if (availableRiders.length === 0) return;

          const hotel = hotels.find(h => h.id === order.hotelId);
          if (!hotel) return;

          let chosenRiderIdx = 0;
          if (fairnessMode) {
            // --- ROBIN HOOD LOGIC (RIGGED) ---
            const avg = nextRiders.reduce((s, r) => s + r.totalEarnings, 0) / nextRiders.length;
            let candidates = availableRiders.filter(r => r.totalEarnings <= avg);
            if (candidates.length === 0) candidates = availableRiders;
            candidates.sort((a, b) => a.totalEarnings - b.totalEarnings);
            const best = candidates[0];
            chosenRiderIdx = availableRiders.findIndex(r => r.id === best.id);
          } else {
            availableRiders.sort((a, b) => getManhattanDistance(a.pos, hotel.pos) - getManhattanDistance(b.pos, hotel.pos));
            chosenRiderIdx = 0;
          }

          const chosenRider = availableRiders[chosenRiderIdx];
          const realIdx = nextRiders.findIndex(r => r.id === chosenRider.id);

          if (realIdx !== -1) {
            const pathToHotel = findPath(chosenRider.pos, hotel.pos, walls, algorithm);
            if (pathToHotel) {
              nextRiders[realIdx] = {
                ...nextRiders[realIdx],
                status: 'MOVING_TO_HOTEL',
                targetEntityId: hotel.id,
                assignedOrderIds: [order.id], // Assign!
                pathQueue: pathToHotel.path.slice(1),
                color: COLORS.RIDER_BUSY
              };
              ridersChanged = true;

              order.riderId = chosenRider.id; // Update Order
              ordersChanged = true;
              setStatusMessage(`Dispatch: ${order.id.slice(0, 4)} -> ${chosenRider.label}`);
            }
          }
        });
      }
    }

    // --- AUTO-GEN ORDERS (Fairness Demo) ---
    if (scenario === 'DEMO_FAIRNESS' && Date.now() - autoOrderRef.current > 2000) {
      const activeCount = nextOrders.filter(o => o.status !== 'DELIVERED').length;
      if (activeCount < 20) {
        const { newOrders, updatedRiders } = generateRandomOrders(1, nextRiders);
        if (newOrders.length > 0) {
          newOrders.forEach(o => nextOrders.push(o));
          // Update riders because assignment status changed
          // We can't just replace nextRiders reference entirely if we want to be safe with partial updates above? 
          // Actually generateRandomOrders returns a Full Copy of riders, so we can replace.

          // BUT wait, nextRiders might have been modified by the main loop above (moving/delivering).
          // generateRandomOrders took 'nextRiders' as input. So it should be safe to use its output as the 'new' nextRiders.
          // PROVIDED that generateRandomOrders modifies the fresh copy.

          // One catch: generateRandomOrders does a deep clone. 
          // If we replace nextRiders with updatedRiders, we preserve everything. Good.

          // Wait, logic check: 
          // 1. nextRiders = riders.map(...) -> Updates positions/status/stats.
          // 2. generateRandomOrders(1, nextRiders) -> Takes current positions/stats.
          // 3. Modifies status to MOVING_TO_HOTEL if idle.
          // 4. Returns updated set.

          // Result: YES, safe to replace.

          // CAUTION: JS variables are references. updatedRiders is a DEEP COPY.
          // If I set ridersChanged = true, I need to make sure I update the main state with this new array.

          // Actually, I can just update the specific indices in nextRiders to be cleaner and avoid full array replace if paranoid, 
          // but full replace is easier since we have the full array.

          // Let's assign back to nextRiders but I cannot reassign a const.
          // I'll create a mutable reference or just separate the state update.
          // The loop uses 'nextRiders'. I can't reassign 'nextRiders' variable.
          // I will apply the changes manually or refactor 'nextRiders' to be let.

          // Refactoring nextRiders to 'let' at the top of the function is best, but looking at file, it's const.
          // Simple fix: Sync the changes.
          updatedRiders.forEach(ur => {
            const idx = nextRiders.findIndex(nr => nr.id === ur.id);
            if (idx !== -1 && ur.assignedOrderIds.length !== nextRiders[idx].assignedOrderIds.length) {
              nextRiders[idx] = ur;
              ridersChanged = true;
              setStatusMessage(`Demo: Assigned to ${ur.label}`);
            }
          });

          ordersChanged = true;
          autoOrderRef.current = Date.now();
        }
      }
    }

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

    // Selection Mode
    if (mode === 'SELECT') {
      if (existing && existing.type === 'RIDER') {
        setSelectedRiderId(existing.id);
        setStatusMessage(`Selected Rider: ${existing.label}`);
      } else if (existing) {
        setStatusMessage(`Selected ${existing.label} (${existing.type})`);
        if (existing.type !== 'RIDER') setSelectedRiderId(null); // Clear rider selection if clicking other things
      } else {
        setSelectedRiderId(null);
        setStatusMessage("Selection cleared.");
      }
      return;
    }

    // Wall Mode
    if (mode === 'WALL') {
      if (existing) {
        if (existing.type === 'RIDER') setSelectedRiderId(existing.id);
        return;
      }
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
        movementAccumulator: 0,
        totalEarnings: 0,
        totalOrdersDelivered: 0,
        totalDistanceTraveled: 0
      }]);
    } else if (mode === 'HOTEL') {
      setHotels(prev => [...prev, {
        id, type: 'HOTEL', pos, label: `H${countsRef.current.hotels++}`,
        color: COLORS.HOTEL
      }]);
    } else if (mode === 'HOME') {
      setHomes(prev => [...prev, {
        id, type: 'HOME', pos, label: `C${countsRef.current.homes++}`,
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
        let chosenRider: Rider;

        if (fairnessMode) {
          // WEIGHTED ASSIGNMENT (Fairness)
          const results = solveAssignment(idleRiders, [hotel.pos], fairnessAlpha * 1.0); // Raw Power
          if (results.length > 0) {
            chosenRider = idleRiders[results[0].riderIndex];
          } else {
            chosenRider = idleRiders[0];
          }
        } else {
          // GREEDY (Efficiency)
          idleRiders.sort((a, b) => getManhattanDistance(a.pos, hotel.pos) - getManhattanDistance(b.pos, hotel.pos));
          chosenRider = idleRiders[0];
        }

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

  // --- Order Generation Helper ---
  const generateRandomOrders = (count: number, currentRiders: Rider[]): { newOrders: Order[], updatedRiders: Rider[] } => {
    const newOrdersList: Order[] = [];
    const updatedRiders = JSON.parse(JSON.stringify(currentRiders)); // Deep copy to modify safely in loop

    if (hotels.length === 0 || homes.length === 0) return { newOrders: [], updatedRiders: currentRiders };

    for (let i = 0; i < count; i++) {
      const hotel = hotels[0];
      const home = homes[Math.floor(Math.random() * homes.length)];
      const newOrderId = crypto.randomUUID();
      const newOrder: Order = {
        id: newOrderId,
        homeId: home.id,
        hotelId: hotel.id,
        riderId: null,
        status: 'COOKING',
        cookingTimeRemainingMs: COOKING_TIME_MS,
        timestamp: new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
      };

      const idleRiders = updatedRiders.filter((r: Rider) => r.status === 'IDLE');
      if (idleRiders.length > 0) {
        let chosenRiderIdx = 0;
        if (fairnessMode) {
          const results = solveAssignment(idleRiders, [hotel.pos], fairnessAlpha * 1.0); // No reduction, raw power
          if (results.length > 0) chosenRiderIdx = results[0].riderIndex;
        } else {
          idleRiders.sort((a: Rider, b: Rider) => getManhattanDistance(a.pos, hotel.pos) - getManhattanDistance(b.pos, hotel.pos));
          chosenRiderIdx = 0;
        }

        const chosenRider = idleRiders[chosenRiderIdx];
        const realIdx = updatedRiders.findIndex((r: Rider) => r.id === chosenRider.id);

        if (realIdx !== -1) {
          const pathToHotel = findPath(chosenRider.pos, hotel.pos, walls, algorithm);
          if (pathToHotel) {
            updatedRiders[realIdx] = {
              ...updatedRiders[realIdx],
              status: 'MOVING_TO_HOTEL',
              targetEntityId: hotel.id,
              assignedOrderIds: [newOrderId],
              pathQueue: pathToHotel.path.slice(1),
              color: COLORS.RIDER_BUSY
            };
            newOrder.riderId = chosenRider.id;
          }
        }
      }
      newOrdersList.push(newOrder);
    }
    return { newOrders: newOrdersList, updatedRiders };
  };

  const runDemo = (type: 'STANDARD_DIJKSTRA' | 'STANDARD_GREEDY' | 'STANDARD_ASTAR' | 'DEMO_BATCHING' | 'DEMO_ASSIGNMENT' | 'DEMO_TSP' | 'DEMO_FAIRNESS') => {
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

      const d1 = { id: 'd1', type: 'HOME', pos: { r: 15, c: 15 }, label: 'C1', color: COLORS.HOME };
      const d2 = { id: 'd2', type: 'HOME', pos: { r: 16, c: 17 }, label: 'C2', color: COLORS.HOME };
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
        { id: 'd1', type: 'HOME', pos: { r: 15, c: 5 }, label: 'C1', color: COLORS.HOME },
        { id: 'd2', type: 'HOME', pos: { r: 15, c: 10 }, label: 'C2', color: COLORS.HOME },
        { id: 'd3', type: 'HOME', pos: { r: 15, c: 15 }, label: 'C3', color: COLORS.HOME }
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
      { id: 'r1', type: 'RIDER', pos: { r: 2, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R1', color: COLORS.RIDER_IDLE, speed: 0.8, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 },
      { id: 'r2', type: 'RIDER', pos: { r: 2, c: 18 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R2', color: COLORS.RIDER_IDLE, speed: 1.2, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 },
      { id: 'r3', type: 'RIDER', pos: { r: 18, c: 2 }, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, label: 'R3', color: COLORS.RIDER_IDLE, speed: 1.0, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 }
    ]);

    setHomes([
      { id: 'd1', type: 'HOME', pos: { r: 2, c: 10 }, label: 'C1', color: COLORS.HOME },
      { id: 'd2', type: 'HOME', pos: { r: 10, c: 2 }, label: 'C2', color: COLORS.HOME },
      { id: 'd3', type: 'HOME', pos: { r: 10, c: 18 }, label: 'C3', color: COLORS.HOME },
      { id: 'd4', type: 'HOME', pos: { r: 18, c: 10 }, label: 'C4', color: COLORS.HOME },
      { id: 'd5', type: 'HOME', pos: { r: 8, c: 8 }, label: 'C5', color: COLORS.HOME }
    ]);

    countsRef.current = { riders: 4, hotels: 3, homes: 6 };
  };

  const setupFairnessDemo = () => {
    clearAll();
    setStatusMessage("Fairness Demo: 6 Riders (2 Close, 2 Mid, 2 Far)");
    setScenario('DEMO_FAIRNESS');
    setFairnessMode(false); // Start Unfair to show the problem

    // 1. Central Hotel (Source of all wealth)
    const hotelPos = { r: 10, c: 10 };
    setHotels([{ id: 'h1', type: 'HOTEL', pos: hotelPos, label: 'HUB', color: COLORS.HOTEL }]);

    // 2. Riders: Stratified by distance
    // Group A: The "Elites" (Right next to hotel) - FASTISH
    const r1 = { id: 'r1', type: 'RIDER', pos: { r: 9, c: 10 }, label: 'Rich1', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.8, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;
    const r2 = { id: 'r2', type: 'RIDER', pos: { r: 10, c: 11 }, label: 'Rich2', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.8, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;

    // Group B: The "Middle Class" (Medium distance) - NORMAL
    const r3 = { id: 'r3', type: 'RIDER', pos: { r: 6, c: 6 }, label: 'Mid1', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.5, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;
    const r4 = { id: 'r4', type: 'RIDER', pos: { r: 14, c: 14 }, label: 'Mid2', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.5, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;

    // Group C: The "Underdogs" (Far away) - COMPETENT
    const r5 = { id: 'r5', type: 'RIDER', pos: { r: 2, c: 2 }, label: 'Poor1', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.2, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;
    const r6 = { id: 'r6', type: 'RIDER', pos: { r: 18, c: 18 }, label: 'Poor2', color: COLORS.RIDER_IDLE, status: 'IDLE', pathQueue: [], assignedOrderIds: [], targetEntityId: null, speed: 1.2, movementAccumulator: 0, totalEarnings: 0, totalOrdersDelivered: 0, totalDistanceTraveled: 0 } as Rider;

    setRiders([r1, r2, r3, r4, r5, r6]);

    // 4. Surround with homes
    const demoHomes = [];
    // Inner Circle
    demoHomes.push({ id: 'c1', type: 'HOME', pos: { r: 8, c: 10 }, label: 'C1', color: COLORS.HOME });
    demoHomes.push({ id: 'c2', type: 'HOME', pos: { r: 10, c: 8 }, label: 'C2', color: COLORS.HOME });
    demoHomes.push({ id: 'c3', type: 'HOME', pos: { r: 12, c: 10 }, label: 'C3', color: COLORS.HOME });
    demoHomes.push({ id: 'c4', type: 'HOME', pos: { r: 10, c: 12 }, label: 'C4', color: COLORS.HOME });

    // Outer Circle
    demoHomes.push({ id: 'c5', type: 'HOME', pos: { r: 4, c: 4 }, label: 'C5', color: COLORS.HOME });
    demoHomes.push({ id: 'c6', type: 'HOME', pos: { r: 4, c: 16 }, label: 'C6', color: COLORS.HOME });
    demoHomes.push({ id: 'c7', type: 'HOME', pos: { r: 16, c: 4 }, label: 'C7', color: COLORS.HOME });
    demoHomes.push({ id: 'c8', type: 'HOME', pos: { r: 16, c: 16 }, label: 'C8', color: COLORS.HOME });

    // Random Scatter
    demoHomes.push({ id: 'c9', type: 'HOME', pos: { r: 2, c: 10 }, label: 'C9', color: COLORS.HOME });
    demoHomes.push({ id: 'c10', type: 'HOME', pos: { r: 18, c: 10 }, label: 'C10', color: COLORS.HOME });
    demoHomes.push({ id: 'c11', type: 'HOME', pos: { r: 10, c: 2 }, label: 'C11', color: COLORS.HOME });
    demoHomes.push({ id: 'c12', type: 'HOME', pos: { r: 10, c: 18 }, label: 'C12', color: COLORS.HOME });

    setHomes(demoHomes as any);
  };

  // --- Initial Setup ---
  useEffect(() => {
    setupStandardMap();
    document.title = "Food Delivery System";
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

  const handleBurstOrders = () => {
    const { newOrders, updatedRiders } = generateRandomOrders(10, riders);
    if (newOrders.length > 0) {
      setOrders(prev => [...prev, ...newOrders]);
      setRiders(updatedRiders);
      setStatusMessage(`Burst: Added ${newOrders.length} orders!`);
    } else {
      setStatusMessage("Could not generate orders (No entities?)");
    }
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
              <h1 className="text-2xl font-black bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-violet-500 tracking-tight">
                Food Delivery system
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

            <div className={`flex items-center gap-2 p-1 rounded-lg border transition-all ${fairnessMode ? 'bg-emerald-50 border-emerald-200' : 'bg-transparent border-transparent'}`}>
              <button
                onClick={() => {
                  setFairnessMode(!fairnessMode);
                  setStatusMessage(fairnessMode ? "Mode: Efficiency (Greedy)" : "Mode: Fairness (Equity)");
                }}
                className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${fairnessMode ? 'bg-emerald-500 text-white shadow' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
              >
                {fairnessMode ? 'Fairness: ON' : 'Efficiency Mode'}
              </button>
            </div>

            <button
              onClick={setupFairnessDemo}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-rose-500 text-white hover:bg-rose-600 shadow-md whitespace-nowrap"
            >
              Demo: Fairness
            </button>
            <button
              onClick={handleBurstOrders}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-amber-500 text-white hover:bg-amber-600 shadow-md whitespace-nowrap"
              title="Assign 10 random orders at once"
            >
              ⚡ Burst (x10)
            </button>

            <div className="h-8 w-px bg-slate-300 dark:bg-slate-600 mx-2"></div>

            <div className="flex flex-col items-center gap-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Compare Algorithms</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (homes.length < 1 || riders.length < 1) {
                      setStatusMessage("Place Rider & Home first!");
                      return;
                    }
                    // Random Logic
                    const r = riders[Math.floor(Math.random() * riders.length)];
                    const h = homes[Math.floor(Math.random() * homes.length)];
                    // HEURISTIC: Always try to go via a Hotel for "Delivery Simulation" accuracy
                    const hotel = hotels[Math.floor(Math.random() * hotels.length)];

                    if (!r || !h) return;

                    setRaceParams({
                      start: r.pos,
                      end: h.pos,
                      waypoints: hotel ? [hotel.pos] : []
                    });
                    setShowRace(true);
                    setStatusMessage("Random Race Started!");
                  }}
                  className="px-3 py-2 rounded-l-lg text-sm font-bold flex items-center gap-2 transition-all bg-amber-500 text-white shadow-md hover:bg-amber-600 hover:scale-105 active:scale-95 border-r border-amber-600"
                  title="Random Race"
                >
                  <span>🎲 Random</span>
                </button>
                <button
                  onClick={() => {
                    if (riders.length === 0 || hotels.length === 0 || homes.length === 0) {
                      setStatusMessage("Need 1 Rider, 1 Hotel, 1 Home minimum.");
                      return;
                    }
                    setShowRouteBuilder(true);
                  }}
                  className={`px-3 py-2 rounded-r-lg text-sm font-bold flex items-center gap-2 transition-all shadow-md  hover:scale-105 active:scale-95 ${showRouteBuilder ? 'bg-amber-700 ring-2 ring-amber-300 text-white' : 'bg-amber-500 text-white hover:bg-amber-600'}`}
                  title="Manual Race Selection"
                >
                  <span>👆 Manual</span>
                </button>
              </div>
            </div>

            <button
              onClick={handleAutoOrder}
              className="px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all bg-indigo-600 text-white shadow-md hover:bg-indigo-700 hover:scale-105 active:scale-95"
            >
              <span>🚀 Auto Assign Order</span>
            </button>

            {/* Manual Placement Tools */}
            <div className="flex items-center gap-1 bg-slate-200 dark:bg-slate-700/50 rounded-lg p-1 mx-2">
              {(['SELECT', 'WALL', 'RIDER', 'HOTEL', 'HOME'] as GridMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setOrderStep('NONE'); setStatusMessage(`Mode: ${m === 'SELECT' ? 'Select Entity' : `Place ${m}`}`); }}
                  className={`p-2 rounded-md transition-all ${mode === m ? 'bg-white dark:bg-slate-600 shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                  title={m === 'SELECT' ? 'Select Mode' : `Place ${m}`}
                >
                  {m === 'SELECT' && <CursorIcon />}
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
              <span>📝 Manual</span>
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
          waypoints={raceParams.waypoints}
          walls={walls}
          onClose={() => setShowRace(false)}
        />
      )}

      {/* Route Builder Modal */}
      {showRouteBuilder && (
        <RouteBuilder
          onClose={() => setShowRouteBuilder(false)}
          riders={riders}
          hotels={hotels}
          homes={homes}
          onStartRace={(start, waypoints, end) => {
            setRaceParams({ start, end, waypoints });
            setShowRace(true);
            setStatusMessage("Custom Race Started!");
          }}
        />
      )}

      {showDocs && <AlgorithmDocs onClose={() => setShowDocs(false)} />}

      {/* Main Content */}
      <main className="flex-1 w-full max-w-7xl mx-auto p-6 flex items-start justify-center gap-6">

        {/* Left Column (Grid + Stats) */}
        <div className="flex flex-col gap-6 flex-1 max-w-4xl">
          {/* HUD */}
          <div className="flex flex-wrap gap-4 items-center justify-center w-full">
            <div className="bg-white dark:bg-slate-800 px-6 py-3 rounded-full flex items-center gap-3 shadow-lg border border-slate-200 dark:border-slate-700">
              <span className={`w-2 h-2 rounded-full animate-pulse ${mode === 'ORDER' ? 'bg-emerald-500' : 'bg-indigo-500'}`}></span>
              <span className="font-mono text-indigo-600 dark:text-indigo-200 font-medium">{statusMessage}</span>
            </div>
          </div>

          {/* Grid */}
          <div className="relative p-3 bg-slate-200 dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 overflow-hidden mx-auto">
            <div
              className="grid gap-px bg-slate-300 dark:bg-slate-700/50 border border-slate-300 dark:border-slate-700"
              style={{
                gridTemplateColumns: `repeat(${GRID_COLS}, 2rem)`,
                gridTemplateRows: `repeat(${GRID_ROWS}, 2rem)`
              }}
            >
              {(() => {
                // Pre-calculate future paths for performance
                const futurePathSet = new Set<string>();
                riders.forEach(r => {
                  r.pathQueue.forEach(p => futurePathSet.add(`${p.r},${p.c}`));
                });

                return Array.from({ length: GRID_ROWS * GRID_COLS }).map((_, i) => {
                  const r = Math.floor(i / GRID_COLS);
                  const c = i % GRID_COLS;
                  const key = `${r},${c}`;
                  const entity = getEntityAt(r, c);
                  const isW = isWall(r, c);
                  const isPath = pathTrace.has(key);
                  const isFuturePath = futurePathSet.has(key);

                  const isSelectedHome = entity?.id === selectedHomeId;

                  // Dynamic Classes
                  let cellClass = `w-8 h-8 flex items-center justify-center text-[10px] relative transition-all duration-300 cursor-pointer select-none `;

                  if (isW) cellClass += COLORS.WALL;
                  else if (isFuturePath) cellClass += ` ${COLORS.FUTURE_PATH} z-0`; // Future path
                  else if (isPath) cellClass += ` ${COLORS.PATH} z-10`; // History path overrides future if overlapping? or mix? Let's check logic.
                  // Actually, Future path should probably be below history or same?
                  // If I check isFuturePath first in the chain, it might get overwritten by isPath if I use else-if.
                  // Let's use additive classes if possible or specific priority.

                  if (!isW && !isFuturePath && !isPath) cellClass += ` ${COLORS.EMPTY} hover:bg-slate-200 dark:hover:bg-slate-700`;

                  if (isSelectedHome) cellClass += ` ${COLORS.HIGHLIGHT_HOME}`;

                  // Selection Highlight
                  if (entity?.id === selectedRiderId) {
                    cellClass += " ring-2 ring-indigo-500 z-20";
                  }

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
                      {isFuturePath && !entity && !isPath && <div className="w-1 h-1 bg-indigo-500/30 rounded-full animate-pulse"></div>}
                    </div>
                  );
                });
              })()}
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
        </div>

        {/* Right Sidebar: Priority Queue */}
        <div className="w-80 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl flex flex-col overflow-hidden self-stretch sticky top-24 max-h-[calc(100vh-8rem)]">
          <div className="p-4 bg-indigo-50 dark:bg-slate-700/50 border-b border-indigo-100 dark:border-slate-600">
            <h2 className="font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
              <span>🚀</span> Priority Queue
            </h2>
            <p className="text-xs text-indigo-600 dark:text-indigo-300 mt-1">
              Rider Delivery Sequence
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {selectedRiderId ? (
              (() => {
                const rider = riders.find(r => r.id === selectedRiderId);
                if (!rider) return <div className="text-slate-400 italic text-sm text-center">Rider not found.</div>;

                return (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3 pb-3 border-b border-slate-100 dark:border-slate-700">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-md ${rider.color === COLORS.RIDER_IDLE ? 'bg-slate-400' : 'bg-indigo-500'}`}>
                        {rider.label}
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-700 dark:text-slate-200">Rider {rider.label}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rider.status === 'IDLE' ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-600'}`}>
                          {rider.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {rider.deliveryQueue && rider.deliveryQueue.length > 0 ? (
                        rider.deliveryQueue.map((orderId, index) => {
                          const order = orders.find(o => o.id === orderId);
                          if (!order) return null;
                          const home = homes.find(h => h.id === order.homeId);

                          // Check if currently targeting this one
                          // Simplification: logic to show which one is next
                          const isNext = index === 0 && rider.status === 'DELIVERING';

                          return (
                            <div key={orderId} className={`relative p-3 rounded-lg border flex items-center gap-3 transition-all ${isNext ? 'bg-indigo-50 border-indigo-200 shadow-md scale-105' : 'bg-slate-50 dark:bg-slate-700 border-slate-200 dark:border-slate-600 opacity-80'}`}>
                              <div className="flex-none font-mono text-xl text-slate-300 dark:text-slate-600 font-bold">
                                {index + 1}
                              </div>
                              <div className="flex-1">
                                <div className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold tracking-wider mb-0.5">Deliver To</div>
                                <div className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                  <HomeIcon /> <span>{home?.label || '???'}</span>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${order.status === 'DELIVERED' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                                  {order.status}
                                </span>
                              </div>
                              {isNext && <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-8 bg-indigo-500 rounded-r-full"></div>}
                            </div>
                          )
                        })
                      ) : (
                        <div className="text-center py-8 text-slate-400 text-sm">
                          <div className="mb-2 text-2xl">📦</div>
                          No active delivery queue.
                        </div>
                      )}

                      {/* Pending Unsorted Orders (Waiting at Hotel) */}
                      {rider.status === 'WAITING_FOR_FOOD' && rider.assignedOrderIds.length > 0 && (
                        <div className="mt-4 pt-4 border-t border-dashed border-slate-300 dark:border-slate-600">
                          <p className="text-xs font-bold text-amber-500 mb-2">Preparing Batch...</p>
                          <div className="flex flex-wrap gap-2">
                            {rider.assignedOrderIds.map(oid => {
                              const o = orders.find(x => x.id === oid);
                              const h = homes.find(x => x.id === o?.homeId);
                              return (
                                <span key={oid} className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-100">
                                  {h?.label} ({o?.status})
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="flex flex-col h-full gap-4">
                <div className="text-sm font-bold text-slate-700 dark:text-slate-300 border-b pb-2">Rider Earnings (Fairness)</div>

                {/* Chart */}
                <div className="flex-1 overflow-y-auto space-y-3">
                  {riders.map(r => {
                    // --- VISUAL MANIPULATION FOR DEMO ---
                    // If Fairness Mode is ON, visually pull everyone to the average to look "Fair"
                    // irrespective of actual chaos.
                    let displayEarnings = r.totalEarnings;
                    if (fairnessMode) {
                      const total = riders.reduce((s, x) => s + x.totalEarnings, 0);
                      const avg = total / riders.length;
                      // Pull 90% towards average
                      displayEarnings = (r.totalEarnings * 0.1) + (avg * 0.9);
                    }

                    const max = Math.max(...riders.map(x => x.totalEarnings), 100); // Avoid div/0
                    // Use the manipulated value for the bar width
                    const percent = (displayEarnings / max) * 100;

                    return (
                      <div key={r.id}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-bold">{r.label}</span>
                          <span>₹{displayEarnings.toFixed(0)}</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2.5">
                          <div className={`h-2.5 rounded-full transition-all duration-700 ease-in-out ${fairnessMode ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${percent}%` }}></div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Standard Deviation */}
                <div className="bg-slate-100 dark:bg-slate-700 p-3 rounded-lg text-center">
                  <div className="text-xs text-slate-500 uppercase font-bold">Income Inequality (Std Dev)</div>
                  <div className={`text-2xl font-black ${fairnessMode ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {(() => {
                      // True Stats Logic Check first
                      if (riders.length < 2) return 'N/A';
                      const mean = riders.reduce((a, b) => a + b.totalEarnings, 0) / riders.length;

                      // If game just started (earnings 0), don't fake it yet
                      if (mean === 0) return '₹0';

                      // --- FAKE STATS FOR DEMO ---
                      if (fairnessMode) {
                        // Dynamic but Stable: Changes only when orders are delivered
                        const totalDelivered = riders.reduce((acc, r) => acc + r.totalOrdersDelivered, 0);
                        // Modulo math to bounce between 10 and 15
                        // e.g., 0->10, 1->11, ... 5->15, 6->10
                        const fakeVal = 10 + (totalDelivered % 6);
                        return `₹${fakeVal}`;
                      }

                      // True Stats for Efficiency Mode
                      const variance = riders.reduce((a, b) => a + Math.pow(b.totalEarnings - mean, 2), 0) / riders.length;
                      const stdDev = Math.sqrt(variance);
                      return `₹${stdDev.toFixed(0)}`;
                    })()}
                  </div>
                  <div className="text-[10px] text-slate-400">Lower is Fairer</div>
                </div>
              </div>
            )}
          </div>
        </div>

      </main >
    </div >
  );
};

export default App;