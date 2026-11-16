// @vitest-environment jsdom
import '../../test/renderPage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddDocument } from './ProviderOnFile';

afterEach(cleanup);

const choose = (name: string) => fireEvent.change(screen.getByLabelText(/Choose file/), { target: { files: [new File(['x'], name)] } });

describe('adding a file', () => {
  it('sends nothing until Add file, and drops a file removed before then', async () => {
    const onAdd = vi.fn(() => Promise.resolve());
    render(<AddDocument defaultPurpose="cv" onAdd={onAdd} />);
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull();

    choose('wrong.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Remove wrong.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(screen.queryByText('wrong.pdf')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add file' })).toBeNull();

    choose('cv.pdf');
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'cv.pdf' }), 'cv');
    await waitFor(() => expect(screen.queryByText('cv.pdf')).toBeNull());
  });

  it('keeps the file to try again when adding fails', async () => {
    render(<AddDocument defaultPurpose="cv" onAdd={() => Promise.reject(new Error('offline'))} />);
    choose('cv.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Add file' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be added');
    expect(screen.getByText('cv.pdf')).toBeTruthy();
  });
});
