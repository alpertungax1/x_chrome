import { XUser } from './user';

export type MessageType = 
  | "PING"
  | "GET_LOGGED_IN_USER"
  | "SCAN_STARTED"
  | "SCAN_STOP"
  | "SCAN_PROGRESS"
  | "SCAN_USER_FOUND"
  | "SCAN_COMPLETED"
  | "SCAN_ERROR"
  | "ACTION_ENQUEUE"
  | "ACTION_PROGRESS"
  | "ACTION_ERROR"
  | "ACTION_COMPLETED"
  | "UNFOLLOW_FROM_PROFILE"
  | "FOLLOW_FROM_PROFILE"
  | "BULK_ACTION_PROGRESS";

export interface AppMessage<T = any> {
  type: MessageType;
  payload?: T;
}

export interface ScanProgressPayload {
  foundUsersCount: number;
  lastUsername?: string;
}

export interface ScanUserFoundPayload {
  user: Partial<XUser>;
}

export interface BulkActionProgressPayload {
  current: number;
  total: number;
  username: string;
  success: boolean;
}
