import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from '../js/utils/deliver-output';

describe('downloadFile', () => {
  const realTop = Object.getOwnPropertyDescriptor(window, 'top');
  afterEach(() => {
    if (realTop) Object.defineProperty(window, 'top', realTop);
    vi.restoreAllMocks();
  });

  it('hands the file to the Studio when embedded in the app', async () => {
    const deliverOutput = vi.fn();
    Object.defineProperty(window, 'top', {
      configurable: true,
      value: { unsold: { deliverOutput, fetch: vi.fn() } },
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    downloadFile(new Blob([new Uint8Array([37, 80, 68, 70])]), 'out.pdf');
    await vi.waitFor(() => expect(deliverOutput).toHaveBeenCalled());

    const [output, source] = deliverOutput.mock.calls[0];
    expect(output.name).toBe('out.pdf');
    expect(Array.from(output.data)).toEqual([37, 80, 68, 70]);
    expect(source).toBe(window);
    expect(click).not.toHaveBeenCalled();
  });

  it('falls back to a browser download on a standalone page', () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    downloadFile(new Blob(['x']), 'notes.txt');
    expect(click).toHaveBeenCalledOnce();
  });
});
