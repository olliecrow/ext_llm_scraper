import { TaskState } from './taskState.js';

export class TaskManager {
  constructor() {
    this.tasks = new Map();
    this.subscribers = new Map();
  }

  createTask(tabId, startingUrl, settings) {
    if (this.tasks.has(tabId)) {
      throw new Error('A task already exists for this tab');
    }

    const task = new TaskState(tabId, startingUrl, settings);
    this.tasks.set(tabId, task);
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) ?? null;
  }

  removeTask(taskId) {
    this.tasks.delete(taskId);
    this.subscribers.delete(taskId);
  }

  cleanupTask(taskId) {
    const task = this.tasks.get(taskId);
    task?.forceSave();
    this.removeTask(taskId);
  }

  subscribe(taskId, port) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, new Set());
    }
    this.subscribers.get(taskId).add(port);
  }

  unsubscribe(port) {
    for (const ports of this.subscribers.values()) {
      ports.delete(port);
    }
  }

  sendStatus(taskId, data) {
    if (!this.subscribers.has(taskId)) {
      return;
    }

    const ports = this.subscribers.get(taskId);
    const inactive = [];

    for (const port of ports) {
      try {
        port.postMessage(data);
      } catch (error) {
        inactive.push(port);
      }
    }

    if (inactive.length > 0) {
      for (const port of inactive) {
        ports.delete(port);
      }
      if (ports.size === 0) {
        this.subscribers.delete(taskId);
      }
    }
  }
}
