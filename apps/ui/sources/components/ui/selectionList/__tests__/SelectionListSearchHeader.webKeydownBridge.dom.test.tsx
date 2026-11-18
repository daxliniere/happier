/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function flattenStyle(style: unknown): React.CSSProperties | undefined {
    if (style == null) return undefined;
    if (Array.isArray(style)) {
        return style.reduce<React.CSSProperties>((acc, entry) => ({ ...acc, ...(flattenStyle(entry) ?? {}) }), {});
    }
    if (typeof style === 'object') return style as React.CSSProperties;
    return undefined;
}

function domProps(props: Record<string, unknown>): Record<string, unknown> {
    const {
        accessibilityLabel: _accessibilityLabel,
        accessibilityRole: _accessibilityRole,
        accessibilityHint: _accessibilityHint,
        accessible: _accessible,
        autoCapitalize: _autoCapitalize,
        autoCorrect: _autoCorrect,
        hitSlop: _hitSlop,
        nativeID,
        pointerEvents,
        selectable: _selectable,
        testID,
        ...rest
    } = props;
    return {
        ...rest,
        ...(typeof nativeID === 'string' ? { id: nativeID } : {}),
        ...(typeof pointerEvents === 'string' ? { 'data-pointer-events': pointerEvents } : {}),
        ...(typeof testID === 'string' ? { 'data-testid': testID } : {}),
    };
}

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('span', domProps(props)),
}));

vi.mock('react-native-reanimated', () => {
    const View = React.forwardRef<HTMLDivElement, Record<string, unknown>>(function ReanimatedView(props, ref) {
        const { children, style, ...rest } = props;
        return React.createElement('div', {
            ...domProps(rest),
            ref,
            style: flattenStyle(style),
        }, children as React.ReactNode);
    });
    return {
        default: { View },
        useAnimatedStyle: (factory: () => unknown) => factory(),
        useSharedValue: (value: unknown) => ({ value }),
        withTiming: (value: unknown) => value,
    };
});

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    const View = React.forwardRef<HTMLDivElement, Record<string, unknown>>(function View(props, ref) {
        const {
            children,
            style,
            onKeyDown: _onKeyDown,
            onLayout: _onLayout,
            ...rest
        } = props;
        return React.createElement(
            'div',
            {
                ...domProps(rest),
                ref,
                style: flattenStyle(style),
            },
            children as React.ReactNode,
        );
    });
    const Text = React.forwardRef<HTMLSpanElement, Record<string, unknown>>(function Text(props, ref) {
        const { children, style, ...rest } = props;
        return React.createElement(
            'span',
            {
                ...domProps(rest),
                ref,
                style: flattenStyle(style),
            },
            children as React.ReactNode,
        );
    });
    const Pressable = React.forwardRef<HTMLButtonElement, Record<string, unknown>>(function Pressable(props, ref) {
        const { children, style, onPress, ...rest } = props;
        return React.createElement('button', {
            ...domProps(rest),
            ref,
            type: 'button',
            style: flattenStyle(style),
            onClick: typeof onPress === 'function' ? () => onPress({}) : undefined,
        }, children as React.ReactNode);
    });
    const TextInput = React.forwardRef<HTMLInputElement, Record<string, unknown>>(function TextInput(props, ref) {
        const {
            style,
            value,
            onChangeText,
            onKeyDown: _onKeyDown,
            onKeyPress: _onKeyPress,
            onSelectionChange: _onSelectionChange,
            placeholderTextColor: _placeholderTextColor,
            ...rest
        } = props;
        return React.createElement('input', {
            ...domProps(rest),
            ref,
            value: typeof value === 'string' ? value : '',
            style: flattenStyle(style),
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                if (typeof onChangeText === 'function') onChangeText(event.currentTarget.value);
            },
        });
    });

    return createReactNativeWebMock({
        View,
        Text,
        TextInput,
        Pressable,
        Animated: { View },
        Platform: {
            OS: 'web',
            select: <T,>(values: { web?: T; ios?: T; default?: T }) =>
                values.web ?? values.default ?? values.ios,
        },
        StyleSheet: {
            absoluteFillObject: {},
            flatten: flattenStyle,
            create: (styles: unknown) => styles,
        },
    });
});

describe('SelectionListSearchHeader web keydown bridge', () => {
    it('captures dialog typing without focusing on open or consuming the first character', async () => {
        const { SelectionListSearchHeader } = await import('../SelectionListSearchHeader');
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        const close = document.createElement('button');
        const otherInput = document.createElement('input');
        const container = document.createElement('div');
        dialog.append(close, otherInput, container);
        document.body.append(dialog);
        close.focus();
        const root = createRoot(container);
        try {
            const props = { value: '', onChangeText: () => {}, placeholder: 'Search projects',
                canPop: false, testID: 'hdr', captureDialogTypingOnWeb: true };
            await act(async () => { root.render(<SelectionListSearchHeader {...props} />); });
            const input = container.querySelector('input');
            expect(document.activeElement).toBe(close);
            for (const init of [{ key: 'a', ctrlKey: true }, { key: 'a', isComposing: true }, { key: 'ArrowDown' }, { key: 'Enter' }]) {
                close.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
                expect(document.activeElement).toBe(close);
            }
            const typing = new KeyboardEvent('keydown', { key: 'H', shiftKey: true, bubbles: true, cancelable: true });
            close.dispatchEvent(typing);
            expect(document.activeElement).toBe(input);
            expect(typing.defaultPrevented).toBe(false);
            otherInput.focus();
            otherInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
            expect(document.activeElement).toBe(otherInput);
            const nestedDialog = document.createElement('div');
            nestedDialog.setAttribute('role', 'dialog');
            const nestedButton = document.createElement('button');
            nestedDialog.append(nestedButton);
            dialog.append(nestedDialog);
            nestedButton.focus();
            nestedButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
            expect(document.activeElement).toBe(nestedButton);
            await act(async () => { root.unmount(); });
            close.focus();
            close.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
            expect(document.activeElement).toBe(close);
        } finally {
            await act(async () => { root.unmount(); });
            dialog.remove();
        }
    });

    it('dispatches Tab keydown through a DOM ref bridge when React Native Web filters keyboard props', async () => {
        const { SelectionListSearchHeader } = await import('../SelectionListSearchHeader');
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);
        const onKeyPress = vi.fn((event: { preventDefault?: () => void }) => {
            event.preventDefault?.();
        });

        try {
            await act(async () => {
                root.render(
                    <SelectionListSearchHeader
                        value=""
                        onChangeText={() => {}}
                        placeholder="Search branches"
                        canPop
                        backLabel="Worktrees"
                        onKeyPress={onKeyPress}
                        testID="hdr"
                    />,
                );
            });

            const input = container.querySelector('[data-testid="hdr:input"]');
            expect(input).toBeInstanceOf(HTMLInputElement);

            const event = new KeyboardEvent('keydown', {
                key: 'Tab',
                code: 'Tab',
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            });
            input!.dispatchEvent(event);

            expect(onKeyPress).toHaveBeenCalledTimes(1);
            expect(onKeyPress).toHaveBeenCalledWith(expect.objectContaining({
                key: 'Tab',
                shiftKey: true,
            }));
            expect(event.defaultPrevented).toBe(true);
        } finally {
            await act(async () => {
                root.unmount();
            });
            container.remove();
        }
    });
});
