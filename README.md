# Food Delivery Simulation

A React-based simulation of a food delivery system with smart batching, pathfinding (Dijkstra/Greedy), and variable rider speeds.

## Features

- **Grid-based Map**: Place Homes, Hotels, Riders, and Walls.
- **Pathfinding**: Visualize Dijkstra and Greedy algorithms avoiding walls.
- **Smart Batching**: Riders can pick up multiple orders from the same hotel if efficient.
- **Variable Speeds**: Riders have different movement speeds, affecting delivery times.
- **Real-time Stats**: Track cooking times and estimated delivery arrival.

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1.  Clone the repository or download the source.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Running the App

1.  Start the development server:
    ```bash
    npm run dev
    ```
2.  Open your browser and navigate to the URL shown in the terminal (usually `http://localhost:5173`).

## Usage

1.  **Setup Grid**:
    - Use the buttons in the top right to place **Walls**, **Riders**, **Hotels**, or **Homes**.
    - Click on the grid to place entities.
2.  **Place Orders**:
    - Click the **Order** button.
    - Select a **Home** (Customer).
    - Select a **Hotel** (Restaurant).
    - The system will dispatch the nearest or most efficient rider.
3.  **Watch Simulation**:
    - Riders will move to the hotel, wait for food to cook (15s), and then deliver to the home.
    - Check the table at the bottom for status and estimated delivery time.

## Technologies

- React + Vite
- TypeScript
- Tailwind CSS
