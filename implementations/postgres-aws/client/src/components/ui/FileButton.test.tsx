// @vitest-environment jsdom
import '../../test/renderPage';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileButton } from './FileButton';

afterEach(cleanup);

function Field() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <label htmlFor="cv">CV</label>
      <FileButton id="cv" accept=".pdf" fileName={file?.name} onChoose={setFile} onRemove={() => setFile(null)} />
    </>
  );
}

describe('file button', () => {
  it('shows the chosen file, and removes it only once asked', () => {
    render(<Field />);
    fireEvent.change(screen.getByLabelText('CV', { exact: false }), { target: { files: [new File(['x'], 'cv.pdf')] } });
    expect(screen.getByText('cv.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove cv.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByText('cv.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove cv.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    expect(screen.queryByText('cv.pdf')).toBeNull();
  });
});
