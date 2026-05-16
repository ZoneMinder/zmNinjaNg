/**
 * Tests for PageContainer component.
 */

import { describe, it, expect } from 'vitest';
import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { PageContainer } from '../PageContainer';

describe('PageContainer', () => {
  it('renders children', () => {
    render(
      <PageContainer>
        <span data-testid="child">Hello</span>
      </PageContainer>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('applies the default responsive padding classes', () => {
    const { container } = render(<PageContainer>child</PageContainer>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('p-3');
    expect(div.className).toContain('sm:p-4');
    expect(div.className).toContain('md:p-6');
  });

  it('uses space-y-4 for the default (normal) spacing', () => {
    const { container } = render(<PageContainer>child</PageContainer>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('space-y-4');
  });

  it('uses space-y-3 for tight spacing', () => {
    const { container } = render(<PageContainer spacing="tight">child</PageContainer>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('space-y-3');
    expect(div.className).not.toContain('space-y-4');
    expect(div.className).not.toContain('space-y-6');
  });

  it('uses space-y-6 for loose spacing', () => {
    const { container } = render(<PageContainer spacing="loose">child</PageContainer>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('space-y-6');
    expect(div.className).not.toContain('space-y-3');
  });

  it('omits space-y classes when spacing is "none"', () => {
    const { container } = render(<PageContainer spacing="none">child</PageContainer>);
    const div = container.firstChild as HTMLElement;
    expect(div.className).not.toContain('space-y-');
  });

  it('merges an additive className with the defaults', () => {
    const { container } = render(
      <PageContainer className="h-full overflow-auto">child</PageContainer>
    );
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('p-3');
    expect(div.className).toContain('h-full');
    expect(div.className).toContain('overflow-auto');
  });

  it('forwards a ref to the underlying div', () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <PageContainer ref={ref}>
        <span>x</span>
      </PageContainer>
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('forwards data-testid', () => {
    render(<PageContainer data-testid="my-page">child</PageContainer>);
    expect(screen.getByTestId('my-page')).toBeInTheDocument();
  });
});
