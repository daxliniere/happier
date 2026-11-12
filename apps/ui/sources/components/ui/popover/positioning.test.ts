import { describe, expect, it } from 'vitest';

import { resolvePlacement } from './positioning';

describe('resolvePlacement', () => {
    it('keeps auto-vertical placement below when there is enough bottom space', () => {
        expect(resolvePlacement({
            placement: 'auto-vertical',
            preferredMinAvailable: 320,
            available: {
                top: 520,
                bottom: 320,
                left: 320,
                right: 480,
            },
        })).toBe('bottom');
    });

    it('limits auto-vertical placement to the side with more vertical space', () => {
        expect(resolvePlacement({
            placement: 'auto-vertical',
            preferredMinAvailable: 320,
            available: {
                top: 240,
                bottom: 24,
                left: 320,
                right: 480,
            },
        })).toBe('top');
    });

    it('keeps auto-horizontal placement to the right when there is enough right space', () => {
        expect(resolvePlacement({
            placement: 'auto-horizontal',
            preferredMinAvailable: 220,
            available: {
                top: 480,
                bottom: 520,
                left: 320,
                right: 220,
            },
        })).toBe('right');
    });

    it('flips auto-horizontal placement to the left when right space is too narrow', () => {
        expect(resolvePlacement({
            placement: 'auto-horizontal',
            preferredMinAvailable: 220,
            available: {
                top: 480,
                bottom: 520,
                left: 320,
                right: 96,
            },
        })).toBe('left');
    });

    it.each([
        { top: 650, bottom: 110, placement: 'top' },
        { top: 100, bottom: 660, placement: 'bottom' },
    ])('opens a submenu $placement when neither horizontal side fits', ({ top, bottom, placement }) => {
        expect(resolvePlacement({
            placement: 'auto-horizontal',
            preferredMinAvailable: 320,
            available: { top, bottom, left: 96, right: 26 },
        })).toBe(placement);
    });
});
