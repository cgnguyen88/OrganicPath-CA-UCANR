// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal.jsx';

afterEach(cleanup);

function Harness({ onClose = () => {}, dismissible }) {
  return (
    <div>
      <button>behind</button>
      <Modal title="Dialog" onClose={onClose} dismissible={dismissible}>
        <input aria-label="first" />
        <button>middle</button>
        <button>last</button>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('has the dialog role and name', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog', { name: 'Dialog' }).getAttribute('aria-modal')).toBe('true');
  });

  it('moves focus into the dialog when it opens', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
  });

  it('keeps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.tab();
    expect(document.activeElement.textContent).toBe('last');
    await user.tab(); // past the last control: wraps to the first, never to the page behind
    expect(document.activeElement).toBe(screen.getByLabelText('first'));
    await user.tab({ shift: true });
    expect(document.activeElement.textContent).toBe('last');
    expect(document.activeElement).not.toBe(screen.getByText('behind'));
  });

  it('gives focus back to what opened it when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Harness />);
    expect(document.activeElement).not.toBe(opener);
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('closes on Escape and on a backdrop click', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('does not close from a click inside the dialog', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await user.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores Escape and backdrop clicks when it is not dismissible', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} dismissible={false} />);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('dialog').parentElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});
