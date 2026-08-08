export const logger = {
  log: (prefix: string, message: string, ...args: any[]) => {
    if (import.meta.env?.MODE === 'development' || !import.meta.env) {
      console.log(`[${prefix}] ${message}`, ...args);
    }
  },
  warn: (prefix: string, message: string, ...args: any[]) => {
    console.warn(`[${prefix}] ${message}`, ...args);
  },
  error: (prefix: string, message: string, ...args: any[]) => {
    console.error(`[${prefix}] ${message}`, ...args);
  }
};
