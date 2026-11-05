import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TaskManager } from '../src/background/taskManager.js';

describe('TaskManager', () => {
  test('creates, gets, and removes tasks by tab id', () => {
    const manager = new TaskManager();
    const task = manager.createTask(10, 'https://example.com', {});

    assert.equal(manager.getTask(10), task);
    assert.throws(
      () => manager.createTask(10, 'https://example.com/again', {}),
      /A task already exists/
    );

    manager.removeTask(10);
    assert.equal(manager.getTask(10), null);
  });

  test('sends status to subscribers and removes inactive ports', () => {
    const manager = new TaskManager();
    const activePort = { postMessage: mock.fn() };
    const inactivePort = {
      postMessage: mock.fn(() => {
        throw new Error('Port closed');
      }),
    };

    manager.subscribe(1, activePort);
    manager.subscribe(1, inactivePort);
    manager.sendStatus(1, { status: 'Working' });
    manager.sendStatus(1, { status: 'Still working' });

    assert.equal(activePort.postMessage.mock.callCount(), 2);
    assert.equal(inactivePort.postMessage.mock.callCount(), 1);
  });

  test('unsubscribes a port from every task', () => {
    const manager = new TaskManager();
    const port = { postMessage: mock.fn() };

    manager.subscribe(1, port);
    manager.subscribe(2, port);
    manager.unsubscribe(port);
    manager.sendStatus(1, { status: 'One' });
    manager.sendStatus(2, { status: 'Two' });

    assert.equal(port.postMessage.mock.callCount(), 0);
  });

  test('cleanup removes the task', () => {
    const manager = new TaskManager();
    manager.createTask(1, 'https://example.com', {});

    manager.cleanupTask(1);

    assert.equal(manager.getTask(1), null);
  });

  test('rejects unsupported starting URLs', () => {
    const manager = new TaskManager();

    assert.throws(
      () => manager.createTask(1, 'chrome://extensions', {}),
      /Starting URL must use HTTP or HTTPS/
    );
  });
});
