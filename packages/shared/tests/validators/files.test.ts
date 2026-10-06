import { describe, expect, test } from 'bun:test';
import { previewMimeForFile } from '../../src/validators/files.ts';

describe('file preview types', () => {
  test('recognizes safe formats when a native upload has no MIME information', () => {
    expect(previewMimeForFile('Report.PDF', 'application/octet-stream')).toBe('application/pdf');
    expect(previewMimeForFile('Photo.jpeg', null)).toBe('image/jpeg');
    expect(previewMimeForFile('Data.csv', 'application/octet-stream')).toBe('text/csv');
    expect(previewMimeForFile('Page.html', 'application/octet-stream')).toBeUndefined();
    expect(previewMimeForFile('Vector.svg', 'application/octet-stream')).toBeUndefined();
  });

  test('preserves specific MIME information rather than trusting a conflicting extension', () => {
    expect(previewMimeForFile('Notes.pdf', 'text/plain')).toBe('text/plain');
    expect(previewMimeForFile('Script.pdf', 'text/html')).toBeUndefined();
    expect(previewMimeForFile('Image', 'image/png')).toBe('image/png');
  });
});
