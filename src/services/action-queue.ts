import { logger } from '../utils/logger';

export interface ActionTask {
  id: string;
  userId: string;
  username: string;
  type: "UNFOLLOW";
  status: "queued" | "processing" | "success" | "failed";
}

export class ActionQueue {
  private queue: ActionTask[] = [];
  private isProcessing = false;
  private isPaused = false;
  private delayMs = 3000; // Delay between actions to prevent rate limiting

  public enqueue(tasks: ActionTask[]) {
    this.queue.push(...tasks);
    logger.log('ActionQueue', `Enqueued ${tasks.length} tasks. Total in queue: ${this.queue.length}`);
    this.processQueue();
  }

  public pause() {
    this.isPaused = true;
    logger.log('ActionQueue', 'Processing paused.');
  }

  public resume() {
    if (this.isPaused) {
      this.isPaused = false;
      logger.log('ActionQueue', 'Processing resumed.');
      this.processQueue();
    }
  }

  public clear() {
    this.queue = [];
    this.isProcessing = false;
    logger.log('ActionQueue', 'Queue cleared.');
  }

  public getStatus() {
    return {
      total: this.queue.length,
      pending: this.queue.filter(t => t.status === 'queued').length,
      isProcessing: this.isProcessing,
      isPaused: this.isPaused
    };
  }

  private async processQueue() {
    if (this.isProcessing || this.isPaused) return;

    this.isProcessing = true;

    while (this.queue.length > 0 && !this.isPaused) {
      const taskIndex = this.queue.findIndex(t => t.status === 'queued');
      if (taskIndex === -1) break; // No more queued tasks

      const task = this.queue[taskIndex];
      task.status = 'processing';
      
      logger.log('ActionQueue', `Processing task ${task.id} for ${task.username}`);
      
      // Execute task
      try {
        const success = await this.executeAction(task);
        task.status = success ? 'success' : 'failed';
        if (!success) {
          logger.warn('ActionQueue', `Task ${task.id} failed.`);
        }
      } catch (err) {
        task.status = 'failed';
        logger.error('ActionQueue', `Task ${task.id} threw error`, err);
      }

      // Variable delay
      const waitTime = this.delayMs + Math.random() * 2000; 
      await this.wait(waitTime);
    }

    this.isProcessing = false;
  }

  private async executeAction(task: ActionTask): Promise<boolean> {
    return new Promise(resolve => {
      chrome.tabs.query({ url: "*://*.x.com/*" }, (tabs) => {
        const twitterTabs = tabs;
        chrome.tabs.query({ url: "*://*.twitter.com/*" }, (tTabs) => {
          const allTabs = [...twitterTabs, ...tTabs];
          
          if (allTabs.length === 0) {
            resolve(false);
            return;
          }

          chrome.tabs.sendMessage(allTabs[0].id!, { 
            type: 'ACTION_ENQUEUE', 
            payload: { username: task.username, actionType: task.type }
          }, (response) => {
            if (chrome.runtime.lastError || !response) {
              resolve(false);
            } else {
              resolve(response.success);
            }
          });
        });
      });
    });
  }

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global instance
export const actionQueue = new ActionQueue();
