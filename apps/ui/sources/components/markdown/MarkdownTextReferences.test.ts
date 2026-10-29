import { describe, expect, it } from 'vitest';
import { linkifyMarkdownTextReferences } from './MarkdownTextReferences';

describe('display-time Markdown session references', () => {
    it('links prose and possessives without changing code, existing links, or destinations', () => {
        const references = { 'happier-6e': { text: 'Release [prep]', url: '/session/actual' } };
        const prose = "Ask **happier-6e** about happier-6e's change; happier-eb stays unknown.";
        expect(linkifyMarkdownTextReferences(prose, references)).toBe("Ask **[Release \\[prep\\]](/session/actual)** about [Release \\[prep\\]](/session/actual)'s change; happier-eb stays unknown.");
        const protectedSource = ['`happier-6e`', '```txt\nhappier-6e\n```', '[happier-6e](/existing)', '[label](/happier-6e)', 'src/happier-6e/file', 'happier-6e-extra'].join('\n\n');
        expect(linkifyMarkdownTextReferences(protectedSource, references)).toBe(protectedSource);
    });
});
