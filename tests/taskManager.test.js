import { TaskManager } from '../src/background/taskManager.js';

describe('TaskManager', () => {
  test('creates, gets, and removes tasks by tab id', () => {
    const manager = new TaskManager();
    const task = manager.createTask(10, 'https://example.com', {});

    expect(manager.getTask(10)).toBe(task);
    expect(() => manager.createTask(10, 'https://example.com/again', {})).toThrow(
      'A task already exists'
    );

    manager.removeTask(10);
    expect(manager.getTask(10)).toBeNull();
  });

  test('sends status to subscribers and removes inactive ports', () => {
    const manager = new TaskManager();
    const activePort = { postMessage: jest.fn() };
    const inactivePort = {
      postMessage: jest.fn(() => {
        throw new Error('Port closed');
      }),
    };

    manager.subscribe(1, activePort);
    manager.subscribe(1, inactivePort);
    manager.sendStatus(1, { status: 'Working' });
    manager.sendStatus(1, { status: 'Still working' });

    expect(activePort.postMessage).toHaveBeenCalledTimes(2);
    expect(inactivePort.postMessage).toHaveBeenCalledTimes(1);
  });

  test('unsubscribes a port from every task', () => {
    const manager = new TaskManager();
    const port = { postMessage: jest.fn() };

    manager.subscribe(1, port);
    manager.subscribe(2, port);
    manager.unsubscribe(port);
    manager.sendStatus(1, { status: 'One' });
    manager.sendStatus(2, { status: 'Two' });

    expect(port.postMessage).not.toHaveBeenCalled();
  });

  test('cleanup saves pending changes before removing task', () => {
    const manager = new TaskManager();
    const task = manager.createTask(1, 'https://example.com', {});
    const saveCallback = jest.fn();

    task.setSaveCallback(saveCallback);
    task.addContent('https://example.com', {
      title: 'Example',
      textContent: 'Example content',
    });

    manager.cleanupTask(1);

    expect(saveCallback).toHaveBeenCalledWith(task);
    expect(manager.getTask(1)).toBeNull();
  });
});
