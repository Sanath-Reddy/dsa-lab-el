export type Position = {
  r: number;
  c: number;
};

export type EntityType = 'RIDER' | 'HOTEL' | 'HOME' | 'WALL';

export interface Entity {
  id: string;
  type: EntityType;
  pos: Position;
  label: string;
  color: string;
}

export type RiderStatus = 'IDLE' | 'MOVING_TO_HOTEL' | 'WAITING_FOR_FOOD' | 'DELIVERING' | 'RETURNING';

export interface Rider extends Entity {
  status: RiderStatus;
  pathQueue: Position[]; // The current movement path
  assignedOrderIds: string[]; // Orders currently assigned to this rider
  targetEntityId: string | null; // The ID of where they are going (Hotel or Home)
  speed: number; // Cells per tick (e.g., 0.5 to 2.0)
  movementAccumulator: number; // To track fractional movement
}

export type OrderStatus = 'COOKING' | 'READY' | 'DELIVERED';

export interface Order {
  id: string;
  homeId: string;
  hotelId: string;
  riderId: string | null;
  status: OrderStatus;
  cookingTimeRemainingMs: number;
  timestamp: string;
}

export type GridMode = 'WALL' | 'RIDER' | 'HOTEL' | 'HOME' | 'ORDER';

export type Algorithm = 'DIJKSTRA' | 'GREEDY';

export interface PathNode {
  pos: Position;
  distance: number;
  parent: PathNode | null;
}