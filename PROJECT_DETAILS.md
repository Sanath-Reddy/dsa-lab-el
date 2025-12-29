# LogiX Dispatch - Comprehensive Project Documentation

## 1. Overview
**LogiX Dispatch** is a city-scale food delivery simulation built with **React** and **TypeScript**. It visualizes complex logistics algorithms in a grid-based environment. The application demonstrates real-time pathfinding, intelligent order batching, and dynamic agent reassignment in a way that is both educational and interactive.

It is designed to help users understand how companies like Uber Eats or DoorDash might optimize their delivery routes. It compares different pathfinding algorithms (Dijkstra, Greedy, A*) and includes a race mode to visualize their efficiency differences.

---

## 2. Technology Stack

### Core Frameworks
- **React (v19)**: The UI library used for rendering the grid and managing application state.
- **Vite (v6)**: A fast build tool and development server.
- **TypeScript (~5.8)**: Ensures type safety for complex data structures like Grid, Rider, and Order entities.

### Styling
- **Tailwind CSS**: Utility-first CSS framework for rapid UI development. Used for the responsive grid, dark/light mode, and animations.

### Utilities
- **UUID**: For generating unique IDs for entities and orders.
- **Lucide React / SVG**: Custom SVG icons for Riders, Hotels, Homes, and UI elements.

---

## 3. Project Structure

```
/
├── components/          # React Components
│   ├── AlgorithmDocs.tsx    # Educational modal explaining algorithms
│   ├── AlgorithmRace.tsx    # Visualization tool comparing algorithms side-by-side
│   └── IconComponents.tsx   # SVG Icons for the map entities
├── utils/               # Logic & Algorithms
│   ├── algorithms.ts        # Advanced logic: Assignment (Hungarian-ish), TSP
│   ├── comparison.ts        # Helper to run multiple algorithms for benchmarking
│   └── pathfinding.ts       # Core pathfinding (Dijkstra, Greedy, A*)
├── App.tsx              # Main Application Entry & Simulation Loop
├── constants.ts         # Global constants (Grid size, colors, timings)
├── types.ts             # TypeScript interfaces for the domain model
├── main.tsx             # Vite entry point
└── package.json         # Dependencies
```

---

## 4. Features & Functionality

### A. Grid-Based Map
- **Interactive Grid**: A 20x20 grid where users can place:
  - **Walls**: Obstacles that riders cannot pass through.
  - **Riders**: Delivery agents with specific speeds and states.
  - **Hotels**: Restaurants where food is picked up.
  - **Homes**: Customer locations where food is delivered.
- **Click-to-Place**: Users select a tool (Wall, Rider, etc.) and click on grid cells.

### B. Simulation Engine
- **Tick-Based Loop**: A `setInterval` loop runs every 50ms (`DELAY_MS`).
- **State Machine**: Riders transition between states: `IDLE` -> `MOVING_TO_HOTEL` -> `WAITING_FOR_FOOD` -> `DELIVERING` -> `RETURNING`.
- **Real-Time Movement**: Riders move fractionally based on their speed attribute (e.g., speed 0.5 means 1 move every 2 ticks).

### C. Pathfinding Algorithms
The app implements three core algorithms to navigate the grid:
1.  **Dijkstra's Algorithm**: Guarantees the shortest path by exploring all directions uniformly.
2.  **Greedy Best-First Search**: Faster but not always optimal; prioritizes moving closer to the target distance-wise.
3.  **A* (A-Star) Search**: Combines Dijkstra's accuracy with Greedy's speed using a heuristic (Manhattan distance).

### D. Smart Batching
- **Logic**: When a new order is placed, the system checks if any rider is already at (or moving to) the target hotel.
- **Heuristic**: If the new delivery location is within a certain Manhattan distance (`BATCH_DISTANCE_THRESHOLD = 8`) of the rider's existing route, the order is "batched" to them.
- **Efficiency**: Reduces the need for new riders and optimizes total travel time.

### E. Algorithm Race
- A dedicated mode to compare algorithms.
- Users pick a Start and End point.
- The system runs Dijkstra, Greedy, and A* simultaneously and visualizes their search space and final paths side-by-side.

### F. Educational Mode ("Algo Academy")
- An in-app documentation modal that explains how each algorithm works using analogies (Water Spreading vs. Heat-Seeking Missile).

---

## 5. Core Logic & Algorithms Breakdown

### Simulation Loop (`App.tsx`)
The `handleSimulationTick` function is the heartbeat of the app:
1.  **Update Orders**: Decrements cooking timers for `COOKING` orders. Marks them `READY` when done.
2.  **Update Riders**:
    - **Movement**: If `pathQueue` has steps, move the rider. Uses a `movementAccumulator` to handle variable speeds (e.g., speed 1.5 moves 1 step, then 2 steps).
    - **State Transitions**:
        - Reached Hotel -> `WAITING_FOR_FOOD`
        - Food Ready -> Calculate Path to Home (TSP if multiple orders) -> `DELIVERING`
        - Reached Home -> Mark Order `DELIVERED`
        - All Done -> Return to Hotel or `IDLE`.

### Pathfinding (`utils/pathfinding.ts`)
- **Grid Representation**: Implicit graph where each cell connects to 4 neighbors (Up, Down, Left, Right).
- **Function**: `findPath(start, end, walls, algorithm)`
- **Data Structures**:
    - Priority Queue: Sorted based on `distance` (Dijkstra) or `heuristic` (Greedy/A*).
    - `visited`: Set of strings (`"r,c"`) to avoid cycles.
- **Output**: Returns the path (array of coordinates), visited node count (for efficiency stats), and execution time.

### Assignment & TSP (`utils/algorithms.ts`)
- **Assignment**: While currently simple greedy assignment is used in `App.tsx`, the `solveAssignment` function contains a recursive backtracking solver (simulating Hungarian Algorithm) for optimal matching when `N <= 5`.
- **TSP (Traveling Salesman)**: Used when a rider has multiple orders.
    - **Implementation**: For small N (batch size < 5), it uses a recursive permutation solver to find the absolute shortest route to visit all homes.
    - **Fallback**: Uses Nearest Neighbor (Greedy) for larger sets.

---

## 6. Data Models (`types.ts`)

### `Entity`
Base interface for map objects.
```typescript
interface Entity {
  id: string;
  type: 'RIDER' | 'HOTEL' | 'HOME' | 'WALL';
  pos: { r: number, c: number };
  label: string;
  color: string;
}
```

### `Rider` (extends Entity)
Tracks the complex state of a delivery agent.
```typescript
interface Rider extends Entity {
  status: 'IDLE' | 'MOVING_TO_HOTEL' | 'WAITING_FOR_FOOD' | 'DELIVERING' | 'RETURNING';
  pathQueue: Position[];       // Steps remaining in current path
  assignedOrderIds: string[];  // List of orders they are carrying
  speed: number;               // Movement speed (cells per tick)
  movementAccumulator: number; // For fractional movement logic
}
```

### `Order`
Represents a delivery request.
```typescript
interface Order {
  id: string;
  homeId: string;
  hotelId: string;
  riderId: string | null;      // Assigned rider
  status: 'COOKING' | 'READY' | 'DELIVERED';
  cookingTimeRemainingMs: number;
}
```

---

## 7. Usage Guide

### Getting Started
1.  **Install**: `npm install`
2.  **Run**: `npm run dev`
3.  **Open**: `http://localhost:5173`

### Manual Mode (Sandbox)
1.  **Place Entities**: Use the toolbar to select Walls, Riders, Hotels, or Homes. Click on the grid to place them.
2.  **Place Order**:
    - Click "Manual" -> "Manual Order".
    - Click a **Home** (Destination).
    - Click a **Hotel** (Source).
3.  **Watch**: The nearest rider will be dispatched.

### Auto Modes
- **Auto Assign**: Automatically picks a random Home and Hotel and creates an order.
- **Demos**: Use the dropdown menu to load preset scenarios:
    - **Batching Demo**: Shows one rider picking up two orders efficiently.
    - **TSP Demo**: One rider visiting 8 homes.

### Analysis Tools
- **Compare Algorithms**: Click this button (after placing a Rider and Home) to see the "Race" visualization.
- **Stats Panel**: Use the "Active Orders" table at the bottom to see detailed timing (Cooking time, Estimate Delivery).
