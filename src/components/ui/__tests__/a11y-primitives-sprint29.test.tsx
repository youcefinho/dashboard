// @vitest-environment jsdom
// Sprint 29 — a11y AAA + design convergence
// Vérifs primitives : Icon aria-hidden default, Badge AAA tokens (--*-text),
// SkipToContent (href/className/i18n).
// NON exécuté en VM (build/tests délégués Antigravity).
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Search, X } from 'lucide-react';
import { Icon } from '../Icon';
import { Badge } from '../Badge';
import { SkipToContent } from '../SkipToContent';

// Mock i18n (helper retourne la clé telle quelle pour assertion)
vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

afterEach(cleanup);

describe('Sprint 29 a11y primitives', () => {
  describe('Icon aria-hidden default behavior', () => {
    it('renders with aria-hidden="true" by default (decorative)', () => {
      const { container } = render(<Icon as={Search} />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });

    it('renders with aria-hidden="false" when aria-label provided (semantic)', () => {
      const { container } = render(<Icon as={X} aria-label="Close" />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('false');
      expect(svg?.getAttribute('aria-label')).toBe('Close');
    });

    it('honors explicit aria-hidden override', () => {
      const { container } = render(<Icon as={Search} aria-hidden={false} />);
      const svg = container.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('false');
    });
  });

  describe('Badge AAA text tokens (soft variant)', () => {
    it('success.soft uses --success-text token (AAA 7.18:1)', () => {
      const { container } = render(<Badge intent="success" fill="soft">OK</Badge>);
      const badge = container.firstChild as HTMLElement;
      const cls = badge?.className ?? '';
      expect(cls).toContain('--success-text');
    });

    it('warning.soft uses --warning-text token', () => {
      const { container } = render(<Badge intent="warning" fill="soft">Warn</Badge>);
      const cls = (container.firstChild as HTMLElement)?.className ?? '';
      expect(cls).toContain('--warning-text');
    });

    it('danger.soft uses --danger-text token', () => {
      const { container } = render(<Badge intent="danger" fill="soft">Err</Badge>);
      const cls = (container.firstChild as HTMLElement)?.className ?? '';
      expect(cls).toContain('--danger-text');
    });

    it('info.soft uses --info-text token', () => {
      const { container } = render(<Badge intent="info" fill="soft">Info</Badge>);
      const cls = (container.firstChild as HTMLElement)?.className ?? '';
      expect(cls).toContain('--info-text');
    });
  });

  describe('SkipToContent', () => {
    it('renders default link to #main-content with i18n label', () => {
      render(<SkipToContent />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('#main-content');
      expect(link.textContent).toBe('a11y.skip_content');
    });

    it('honors custom targetId and label', () => {
      render(<SkipToContent targetId="form" label="Custom skip" />);
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('#form');
      expect(link.textContent).toBe('Custom skip');
    });

    it('uses .skip-link class for CSS visibility on focus', () => {
      render(<SkipToContent />);
      const link = screen.getByRole('link');
      expect(link.className).toContain('skip-link');
    });
  });
});
