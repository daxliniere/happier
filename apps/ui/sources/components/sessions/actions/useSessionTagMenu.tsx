import * as React from 'react';

import type { DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Icon } from '@/components/ui/icons/Icon';
import { Modal } from '@/modal';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';

export function useSessionTagMenu(params: Readonly<{
    activeTags: readonly string[];
    knownTags: readonly string[];
    iconColor: string;
    onSetTags?: ((tags: string[]) => void | Promise<void>) | null;
}>) {
    const { activeTags, knownTags, iconColor, onSetTags } = params;
    const tagMenuItems = React.useMemo((): DropdownMenuItem[] => knownTags.map((tag) => ({
        id: tag,
        title: tag,
        rightElement: activeTags.includes(tag) ? <Icon name="check" size={16} color={iconColor} /> : undefined,
    })), [activeTags, knownTags, iconColor]);
    const writeTags = React.useCallback((tags: string[]) => {
        fireAndForget(Promise.resolve().then(() => onSetTags?.(tags)), {
            tag: 'SessionTagMenu.setTags',
            onError: (error) => Modal.alert(t('common.error'), error instanceof Error ? error.message : t('errors.unknownError')),
        });
    }, [onSetTags]);
    const handleTagMenuSelect = React.useCallback((tag: string) => {
        writeTags(activeTags.includes(tag) ? activeTags.filter((value) => value !== tag) : [...activeTags, tag]);
    }, [activeTags, writeTags]);
    const handleTagMenuCreate = React.useCallback((query: string) => {
        const tag = query.trim();
        if (!tag || activeTags.includes(tag)) return;
        writeTags([...activeTags, tag]);
    }, [activeTags, writeTags]);
    return { tagMenuItems, handleTagMenuSelect, handleTagMenuCreate };
}
